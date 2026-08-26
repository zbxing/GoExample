import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, '..', '..');

function runScript(relativePath, args = [], environment = {}) {
  return spawnSync(process.execPath, [path.join(repositoryRoot, relativePath), ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
  });
}

test('Go project runner rejects unsafe project selectors', () => {
  const result = runScript('scripts/go-project.mjs', ['test'], { GO_PROJECT: '../Framework' });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GO_PROJECT must contain only/);
});

test('MSFront runner rejects unknown tasks before spawning Yarn', () => {
  const result = runScript('scripts/msfront.mjs', ['unknown-task']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown MSFront task: unknown-task/);
});

test('GitHub workflows pin actions and service images to immutable digests', async () => {
  const workflowsDirectory = path.join(repositoryRoot, '.github', 'workflows');
  const workflowFiles = (await readdir(workflowsDirectory)).filter((fileName) =>
    /\.ya?ml$/i.test(fileName),
  );

  for (const fileName of workflowFiles) {
    const content = await readFile(path.join(workflowsDirectory, fileName), 'utf8');
    const actionReferences = [...content.matchAll(/^\s*uses:\s*[^\s@]+@([^\s#]+)/gm)];
    for (const match of actionReferences) {
      assert.match(match[1], /^[a-f0-9]{40}$/, `${fileName} contains an unpinned action`);
    }

    const serviceImages = [...content.matchAll(/^\s*image:\s*([^\s#]+)/gm)];
    for (const match of serviceImages) {
      assert.match(
        match[1],
        /@sha256:[a-f0-9]{64}$/,
        `${fileName} contains an unpinned service image`,
      );
    }
  }
});

test('OpenAPI compatibility gate compares pull requests with their base commit', async () => {
  const [workflow, script, policy, migration, routes, app, routeTests, openapiContract, openapiDocument, packageDocument] = await Promise.all([
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'openapi-compat.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'compatibility-policy.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'health-endpoint-migration.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_health.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'openapi_contract_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'openapi.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ]);

  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /yarn openapi:compat --base-ref/);
  assert.match(script, /spawnSync\('git', \['show'/);
  assert.match(script, /shell:\s*false/);
  assert.match(policy, /90 天兼容窗口/);
  assert.match(policy, /184 天迁移窗口/);
  assert.match(migration, /184-day migration window/);
  assert.match(routes, /healthDeprecation\s*=\s*"@1787184000"/);
  assert.match(routes, /healthSunset\s*=\s*"Sat, 20 Feb 2027 00:00:00 GMT"/);
  assert.match(routes, /rel=\\"successor-version\\"/);
  assert.match(app, /deprecationHeader[\s\S]*sunsetHeader[\s\S]*linkHeader/);
  assert.match(routeTests, /TestCompatibilityHealthRoutesAdvertiseDeprecation/);
  assert.match(routeTests, /TestCompatibilityReadinessKeepsDeprecationHeadersWhenUnavailable/);
  assert.match(openapiContract, /assertDeprecatedResponses/);
  const openapi = JSON.parse(openapiDocument);
  for (const pathName of ['/api/health', '/api/health/ready', '/api/health/startup']) {
    const operation = openapi.paths[pathName].get;
    assert.equal(operation.deprecated, true, `${pathName} must be deprecated`);
    for (const response of Object.values(operation.responses)) {
      const componentName = response.$ref.split('/').at(-1);
      const headers = openapi.components.responses[componentName].headers;
      assert.deepEqual(Object.keys(headers).sort(), ['Deprecation', 'Link', 'Sunset']);
    }
  }
  assert.equal(JSON.parse(packageDocument).scripts['openapi:compat'], 'node scripts/openapi-compat.mjs');
});

test('generated Go SDK and independent consumer stay aligned with OpenAPI', async () => {
  const [
    openapiDocument,
    sdkVersion,
    generatedClient,
    generator,
    consumerMain,
    consumerTests,
    consumerMatrix,
    workspace,
    goRunner,
    environment,
    goWorkflow,
    nodeWorkflow,
    packageDocument,
  ] = await Promise.all([
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'openapi.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'SDK', 'GoExample', 'VERSION'), 'utf8'),
    readFile(path.join(repositoryRoot, 'SDK', 'GoExample', 'client.gen.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'go-sdk.mjs'), 'utf8'),
    readFile(
      path.join(repositoryRoot, 'support', 'consumer', 'HealthProbe', 'cmd', 'healthprobe', 'main.go'),
      'utf8',
    ),
    readFile(
      path.join(repositoryRoot, 'support', 'consumer', 'HealthProbe', 'cmd', 'healthprobe', 'main_test.go'),
      'utf8',
    ),
    readFile(path.join(repositoryRoot, 'docs', 'openapi', 'consumer-matrix.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'go.work'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'go-project.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'environment.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ]);

  const openapi = JSON.parse(openapiDocument);
  const operationCount = Object.values(openapi.paths).reduce(
    (count, pathItem) =>
      count +
      ['get', 'post', 'put', 'patch', 'delete'].filter((method) => pathItem[method]).length,
    0,
  );
  assert.equal(sdkVersion.trim(), openapi.info.version);
	assert.equal(operationCount, 26);
  assert.match(generatedClient, new RegExp(`const APIVersion = "${openapi.info.version}"`));
  assert.equal((generatedClient.match(/OperationID:/g) ?? []).length, operationCount);
  assert.match(generatedClient, /func PublishedOperations\(\) \[\]Operation/);
  assert.match(generatedClient, /DefaultMaxResponseBytes int64 = 1 << 20/);
  assert.match(generatedClient, /Deprecated: GET \/api\/health\/ready/);
  assert.match(generator, /Only local component parameter references are supported/);
  assert.match(generator, /Generated Go SDK is stale/);

  assert.match(consumerMain, /client\.GetReadiness\(ctx\)/);
  assert.doesNotMatch(consumerMain, /GetApiReadiness|\/api\/health\/ready/);
  assert.match(consumerTests, /client\.GetApiReadiness/);
  assert.match(consumerTests, /Deprecation/);
  assert.match(consumerTests, /successor-version/);
  assert.match(consumerTests, /requestedPaths\[0\] != "\/readyz"/);
	assert.match(consumerMatrix, /Go `1\.4\.0`/);
  assert.match(consumerMatrix, /repository-local consumer only/);

  assert.match(workspace, /\.\/SDK\/GoExample/);
  assert.match(workspace, /\.\/support\/consumer\/HealthProbe/);
  assert.match(goRunner, /workspacePatterns/);
  assert.match(goRunner, /\.\.\.workspacePatterns/);
  assert.match(environment, /go\.work must declare workspace modules in a use block/);
  assert.match(goWorkflow, /Verify generated Go SDK/);
  assert.match(goWorkflow, /"SDK\/\*\*"/);
  assert.match(nodeWorkflow, /yarn sdk:check/);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['sdk:generate'], 'node scripts/go-sdk.mjs generate');
  assert.equal(packageScripts['sdk:check'], 'node scripts/go-sdk.mjs check');

  const check = runScript('scripts/go-sdk.mjs', ['check']);
  assert.equal(check.status, 0, check.stderr);
	assert.match(check.stdout, /Go SDK matches OpenAPI 1\.4\.0 \(26 operations\)/);
});

test('MSFront browser workflow keeps production E2E and diagnostics enabled', async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'msfront-browser.yml'),
    'utf8',
  );
  const playwrightConfig = await readFile(
    path.join(repositoryRoot, 'playwright.config.ts'),
    'utf8',
  );
  const nextConfig = await readFile(path.join(repositoryRoot, 'MSFront', 'next.config.ts'), 'utf8');

  assert.match(workflow, /yarn build:front/);
  assert.match(workflow, /yarn playwright install --with-deps chromium/);
  assert.match(workflow, /yarn test:e2e/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(playwrightConfig, /reuseExistingServer:\s*false/);
  assert.match(playwrightConfig, /trace:\s*'retain-on-failure'/);
  assert.match(playwrightConfig, /name:\s*'desktop-chromium'/);
  assert.match(playwrightConfig, /name:\s*'mobile-chromium'/);
  assert.match(nextConfig, /Content-Security-Policy/);
  assert.match(nextConfig, /Cross-Origin-Opener-Policy/);
  assert.match(nextConfig, /Cross-Origin-Resource-Policy/);
  assert.match(nextConfig, /Permissions-Policy/);
  assert.match(nextConfig, /Strict-Transport-Security/);
  assert.match(nextConfig, /X-Content-Type-Options/);
  assert.match(nextConfig, /X-Frame-Options/);
  assert.match(nextConfig, /PHASE_PRODUCTION_SERVER/);
  assert.match(nextConfig, /validateAuthTokenConfiguration/);
  assert.match(nextConfig, /validateTrustedMutationOrigins/);
});

test('Go transport benchmark workflow preserves repeatable Linux evidence', async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'go-transport-benchmark.yml'),
    'utf8',
  );
  const goProjectRunner = await readFile(
    path.join(repositoryRoot, 'scripts', 'go-project.mjs'),
    'utf8',
  );
  const transportBenchmark = await readFile(
    path.join(
      repositoryRoot,
      'Solutions',
      'Example',
      'internal',
      'projectapi',
      'transport_benchmark_test.go',
    ),
    'utf8',
  );
  const transportReport = await readFile(
    path.join(repositoryRoot, 'scripts', 'transport-benchmark-report.mjs'),
    'utf8',
  );
  const transportBaseline = await readFile(
    path.join(repositoryRoot, 'scripts', 'transport-benchmark-baseline.mjs'),
    'utf8',
  );
  const transportEnvironment = await readFile(
    path.join(repositoryRoot, 'scripts', 'lib', 'transport-benchmark-environment.mjs'),
    'utf8',
  );
  const transportSoakReport = await readFile(
    path.join(repositoryRoot, 'scripts', 'transport-soak-report.mjs'),
    'utf8',
  );
  const lifecycleContract = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'lifecycle_contract_test.go'),
    'utf8',
  );
  const httpApp = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'),
    'utf8',
  );
  const httpMiddleware = await readFile(
    path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'),
    'utf8',
  );
  const requestLogger = await readFile(
    path.join(repositoryRoot, 'Framework', 'observability', 'logger.go'),
    'utf8',
  );
  const requestLoggerTest = await readFile(
    path.join(repositoryRoot, 'Framework', 'observability', 'logger_test.go'),
    'utf8',
  );

  assert.match(workflow, /runs-on:\s*ubuntu-24\.04/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /trusted-baseline:[\s\S]*github\.event_name != 'pull_request'/);
  assert.match(workflow, /transport-benchmark:[\s\S]*needs:\s*trusted-baseline/);
  assert.match(workflow, /pull_request_not_eligible/);
  assert.match(workflow, /actions\/github-script@[a-f0-9]{40}/);
  assert.match(workflow, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /default_branch/);
  assert.match(workflow, /\['push', 'workflow_dispatch'\]/);
  assert.match(workflow, /head_repository\?\.full_name/);
  assert.match(workflow, /transport-benchmark-baseline\.mjs prepare/);
  assert.match(workflow, /transport-benchmark-baseline\.mjs unavailable/);
  assert.match(workflow, /baseline-source\.json/);
  assert.match(workflow, /yarn bench:transports/);
  assert.match(workflow, /lscpu/);
  assert.match(workflow, /GOMAXPROCS=2 \/usr\/bin\/time -v/);
  assert.match(workflow, /GOMAXPROCS:\s*"2"/);
  assert.match(workflow, /TRANSPORT_BENCHMARK_GO_VERSION/);
  assert.match(workflow, /transport-benchmark\.txt/);
  assert.match(workflow, /PIPESTATUS\[0\]/);
  assert.match(workflow, /benchmark-status\.txt/);
  assert.match(workflow, /TRANSPORT_SOAK_DURATION=30s GOMAXPROCS=2/);
  assert.match(workflow, /yarn soak:transports/);
  assert.match(workflow, /transport-soak\.txt/);
  assert.match(workflow, /soak-status\.txt/);
  assert.match(workflow, /system-before\.txt/);
  assert.match(workflow, /system-after\.txt/);
  assert.match(workflow, /ss -s/);
  assert.match(workflow, /\/proc\/net\/dev/);
  assert.match(workflow, /\/proc\/meminfo/);
  assert.match(workflow, /benchmark-trend\.txt/);
  assert.match(workflow, /scripts\/transport-benchmark-report\.mjs/);
  assert.match(workflow, /transport-capacity-report\.json/);
  assert.match(workflow, /baseline_args=\(\)/);
  assert.match(workflow, /--baseline \.temp\/transport-benchmark\/baseline\.json/);
  assert.match(workflow, /baseline-candidate\.json/);
  assert.match(workflow, /scripts\/transport-soak-report\.mjs/);
  assert.match(workflow, /transport-soak-report\.json/);
  assert.match(workflow, /go tool pprof -top -nodecount=30/);
  assert.match(workflow, /cpu-profile-top\.txt/);
  assert.match(workflow, /heap-profile-top\.txt/);
  assert.match(workflow, /scripts\/evidence-manifest\.mjs/);
  assert.match(workflow, /scripts\/evidence-verify\.mjs/);
  assert.match(workflow, /yarn evidence:manifest/);
  assert.match(workflow, /yarn evidence:verify --manifest \.temp\/transport-benchmark\/manifest\.json/);
  assert.match(workflow, /manifest\.json/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(transportBaseline, /compatible_candidate_missing/);
  assert.match(transportBaseline, /candidate workload matrix is incompatible/);
  assert.match(transportBaseline, /candidate scenario matrix is incompatible/);
  assert.match(transportBaseline, /candidate must be a schemaVersion 4/);
  assert.match(transportBaseline, /event must be push or workflow_dispatch/);
  assert.match(transportBaseline, /createHash\('sha256'\)/);
  assert.match(transportBaseline, /validateEnvironmentFingerprint/);
  assert.match(transportBaseline, /environmentFingerprintSha256/);
  assert.match(goProjectRunner, /'bench-transports'[\s\S]*'-count=5'/);
  assert.match(goProjectRunner, /-run=\^TestProjectTransport/);
  assert.match(goProjectRunner, /-cpuprofile=transport\.cpu\.pprof/);
  assert.match(goProjectRunner, /-memprofile=transport\.heap\.pprof/);
  assert.match(goProjectRunner, /'soak-transports'[\s\S]*TestProjectTransportSoakTCP/);
  assert.match(transportBenchmark, /TestProjectTransportsReturnTheSameEnvelopeOverTCP/);
  assert.match(transportBenchmark, /TestNetHTTPTransportSupportsHTTP2/);
  assert.match(transportBenchmark, /EnableHTTP2 = true/);
  assert.match(transportBenchmark, /response\.ProtoMajor != 2/);
  assert.match(transportBenchmark, /TestHTTP2EdgeToFiberHTTP1Contract/);
  assert.match(transportBenchmark, /NewSingleHostReverseProxy/);
  assert.match(transportBenchmark, /TestProjectTransportLatencyTCP/);
  assert.match(transportBenchmark, /TRANSPORT_LATENCY/);
  assert.match(transportBenchmark, /TestProjectTransportCapacityMatrixTCP/);
  assert.match(transportBenchmark, /connection-churn-c16/);
  assert.match(transportBenchmark, /TRANSPORT_CAPACITY/);
  assert.match(transportBenchmark, /TestProjectTransportScenarioMatrixTCP/);
  assert.match(transportBenchmark, /TRANSPORT_SCENARIO/);
  assert.match(transportBenchmark, /response-32k-c16/);
  assert.match(transportBenchmark, /auth-reject-c16/);
  assert.match(transportBenchmark, /dependency-delay-5ms-c32/);
  assert.match(transportBenchmark, /httptrace\.ClientTrace/);
  assert.match(transportBenchmark, /\/proc\/self\/fd/);
  assert.match(transportBenchmark, /TestProjectTransportSoakTCP/);
  assert.match(transportBenchmark, /TRANSPORT_SOAK_DURATION/);
  assert.match(transportBenchmark, /TRANSPORT_SOAK/);
  assert.match(transportReport, /const expectedRounds = 5/);
  assert.match(transportReport, /steady-c1/);
  assert.match(transportReport, /steady-c2/);
  assert.match(transportReport, /steady-c4/);
  assert.match(transportReport, /steady-c8/);
  assert.match(transportReport, /steady-c16/);
  assert.match(transportReport, /steady-c32/);
  assert.match(transportReport, /steady-c64/);
  assert.match(transportReport, /steady-c128/);
  assert.match(transportReport, /connection-churn-c16/);
  assert.match(transportReport, /capacityKnee/);
  assert.match(transportReport, /peakThroughputFraction/);
  assert.match(transportReport, /--baseline/);
  assert.match(transportReport, /maxThroughputRegressionFraction/);
  assert.match(transportReport, /maxP95IncreaseFraction/);
  assert.match(transportReport, /maxP99IncreaseFraction/);
  assert.match(transportReport, /captureEnvironmentFingerprint/);
  assert.match(transportReport, /environment_fingerprint_mismatch/);
  assert.match(transportReport, /environmentComparison/);
  assert.match(transportReport, /parseMeasurements\(raw, 'TRANSPORT_SCENARIO'\)/);
  assert.match(transportReport, /schemaVersion: 4/);
  assert.match(transportReport, /scenarioComparisons/);
  assert.match(transportEnvironment, /runner\.imageVersion/);
  assert.match(transportEnvironment, /toolchain\.goVersion/);
  assert.match(transportEnvironment, /execution\.gomaxprocs/);
  assert.match(transportEnvironment, /sha256 does not match its canonical fields/);
  assert.match(transportReport, /all measurement error rates must be zero/);
  assert.match(transportReport, /payloadBytes must remain stable/);
  assert.match(transportReport, /directionalRatios/);
  assert.match(transportReport, /combined client\/server harness-process deltas/);
  assert.match(transportSoakReport, /minimumDurationNanos = 30_000_000_000/);
  assert.match(transportSoakReport, /minimumWindowToMedianThroughputRatio: 0\.5/);
  assert.match(transportSoakReport, /maximumSettledHeapInUseBytesDelta: 32 \* 1024 \* 1024/);
  assert.match(transportSoakReport, /all soak requests must complete without errors/);
  assert.match(transportSoakReport, /combined client\/server harness process/);
  assert.match(lifecycleContract, /TestTLSContractOverTCP/);
  assert.match(lifecycleContract, /TestStreamingResponseOverTCP/);
  assert.match(lifecycleContract, /SendStreamWriter/);
  assert.match(lifecycleContract, /response\.ContentLength != -1/);
  assert.match(lifecycleContract, /TestWriteTimeoutStopsSlowReaderOverTCP/);
  assert.match(lifecycleContract, /options\.WriteTimeout = 75 \* time\.Millisecond/);
  assert.match(lifecycleContract, /writeFailure/);
  assert.match(lifecycleContract, /timeoutError\.Timeout\(\)/);
  assert.match(lifecycleContract, /TestKeepAliveReuseAndIdleTimeoutOverTCP/);
  assert.match(lifecycleContract, /TestTCPHalfCloseStillReceivesCompleteResponse/);
  assert.match(lifecycleContract, /CloseWrite\(\)/);
  assert.match(lifecycleContract, /TestShutdownClosesIdleKeepAliveConnectionsOverTCP/);
  assert.match(lifecycleContract, /active connections after shutdown = %d, want 0/);
  assert.match(lifecycleContract, /tls\.Listen/);
  assert.match(lifecycleContract, /response\.ProtoMajor != 1/);
  assert.match(httpApp, /app\.Use\("\/api\/v1", streamSafeETag\(\)\)/);
  assert.match(httpMiddleware, /response\.IsBodyStream\(\)/);
  assert.match(httpMiddleware, /etag\.GenerateWeak/);
  assert.match(httpMiddleware, /response\.Header\.Del\(fiber\.HeaderETag\)/);
  assert.match(requestLogger, /func responseBytes/);
  assert.match(requestLogger, /c\.Response\(\)\.IsBodyStream\(\)/);
  assert.match(requestLoggerTest, /TestResponseBytesDoesNotMaterializeStream/);
});

test('server admission control remains bounded and probe-safe', async () => {
  const [app, middleware, metrics, config, environment, lifecycle, authRoutes, authTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'lifecycle_contract_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_auth.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
  ]);

  assert.match(app, /MaxInFlight/);
  assert.match(app, /MaxConnections/);
  assert.match(app, /Concurrency:\s*options\.MaxConnections/);
  assert.match(app, /ReadBufferSize/);
  assert.match(app, /app\.Use\(requestIDBoundary\(options\.Metrics\)\)/);
  assert.match(app, /ExposeHeaders:[\s\S]*HeaderRetryAfter/);
  assert.match(middleware, /maxRequestIDLength\s*=\s*128/);
  assert.match(middleware, /func requestIDBoundary/);
  assert.match(middleware, /RecordRequestIDReplaced/);
  assert.match(middleware, /boundedConcurrency/);
  assert.match(middleware, /rejectWhenDraining/);
  assert.match(middleware, /StatusServiceUnavailable/);
  assert.match(middleware, /HeaderRetryAfter/);
  assert.match(metrics, /goexample_http_admission_rejections_total/);
  assert.match(metrics, /goexample_http_draining_rejections_total/);
  assert.match(metrics, /goexample_http_request_id_replacements_total/);
  assert.match(metrics, /RecordAdmissionRejected/);
  assert.match(metrics, /RecordDrainingRejected/);
  assert.match(config, /HTTP_MAX_IN_FLIGHT/);
  assert.match(config, /HTTP_MAX_CONNECTIONS/);
  assert.match(config, /HTTP_READ_BUFFER_SIZE/);
  assert.match(config, /HTTP_READ_TIMEOUT must not exceed HTTP_IDLE_TIMEOUT/);
  assert.match(config, /HTTP_WRITE_TIMEOUT must not exceed HTTP_IDLE_TIMEOUT/);
  assert.match(config, /SHUTDOWN_DRAIN_DELAY plus HTTP_READ_TIMEOUT/);
  assert.match(config, /SHUTDOWN_DRAIN_DELAY plus HTTP_WRITE_TIMEOUT/);
  assert.match(config, /cfg\.DemoAuthEnabled && cfg\.MetricsToken == cfg\.JWTSecret/);
  assert.match(config, /PPROF_TOKEN must differ from active production authentication and metrics secrets/);
  assert.match(config, /JWTAudience/);
  assert.match(config, /TRUSTED_PROXIES must not contain catch-all CIDR/);
  assert.match(environment, /HTTP_MAX_IN_FLIGHT=256/);
  assert.match(environment, /HTTP_MAX_CONNECTIONS=4096/);
  assert.match(environment, /HTTP_READ_BUFFER_SIZE=16384/);
  assert.match(environment, /JWT_AUDIENCE=goexample-api/);
  assert.match(lifecycle, /TestAPIAdmissionRejectsExcessRequestsAndKeepsReadinessAvailable/);
  assert.match(lifecycle, /TestConnectionConcurrencyRejectsExcessConnectionsOverTCP/);
  assert.match(lifecycle, /options\.MaxConnections\s*=\s*1/);
  assert.match(lifecycle, /TestDrainingRejectsNewAPIRequestsButKeepsExistingWorkAndProbeContract/);
  assert.match(lifecycle, /TestReadBufferRejectsOversizedHeaderOverTCP/);
  assert.match(lifecycle, /TestReadTimeoutRejectsIncompleteHeadersOverTCP/);
  assert.match(lifecycle, /TestReadTimeoutRejectsIncompleteBodyOverTCP/);
  assert.match(lifecycle, /TestTrustedProxyBoundaryOverTCP/);
  assert.match(lifecycle, /untrusted peer cannot spoof client IP/);
  assert.match(lifecycle, /Content-Length: 32/);
  assert.match(lifecycle, /options\.ReadTimeout\s*=\s*50 \* time\.Millisecond/);
  assert.match(lifecycle, /" 408 "/);
  assert.match(lifecycle, /StatusServiceUnavailable/);
  assert.match(authTests, /TestRequestIDBoundaryPreservesValidAndReplacesUntrustedValues/);
  assert.match(lifecycle, /\/readyz/);
  assert.match(authRoutes, /authGroup\.Use/);
  assert.match(authRoutes, /setNoStoreHeaders/);
  assert.match(authTests, /assertNoStoreResponse\(t, unauthorized\)/);
  assert.match(authTests, /assertNoStoreResponse\(t, login\)/);
  assert.match(authTests, /assertNoStoreResponse\(t, me\)/);
  assert.match(authTests, /TestErrorResponsesAreNotCacheable/);
});

test('evidence manifest archives hashes and keeps unverified boundaries explicit', async () => {
  const scriptPath = path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs');
  const [script, verifier, packageDocument] = await Promise.all([
    readFile(scriptPath, 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ]);
  assert.match(script, /createHash\(['"]sha256['"]\)/);
  assert.match(script, /changedFileCount/);
  assert.match(script, /productionSharedStore/);
  assert.match(script, /not_recorded/);
  assert.match(script, /output must be a \.json file inside the repository \.temp directory/);
  assert.match(verifier, /Evidence manifest verified/);
  assert.match(verifier, /hash mismatch/);
  assert.match(verifier, /contains an unsafe path/);
  assert.match(verifier, /recorded localNatsRestart is missing required artifact/);
  assert.match(verifier, /single-node restart contract/);
  assert.match(verifier, /recorded localNatsClusterFailover is missing required artifact/);
  assert.match(verifier, /concurrent two-node quorum recovery contract/);
  assert.match(verifier, /report\.requiredLeaseNanos <= 0/);
  assert.match(verifier, /report\.workerAckWaitNanos < report\.requiredLeaseNanos/);
  assert.match(verifier, /report\?\.sameConnectionSession !== true/);
  assert.match(verifier, /report\?\.disconnectedObserved !== true/);
  assert.match(verifier, /report\?\.reconnectedObserved !== true/);
  assert.match(verifier, /report\?\.adapterSessionRecovered !== true/);
  assert.match(verifier, /report\?\.schemaVersion !== 6/);
  assert.match(verifier, /report\?\.abruptLeaderStops !== 3/);
  assert.match(verifier, /report\?\.restartedServers !== 3/);
  assert.match(verifier, /report\?\.replicaRecoveryPassed !== true/);
  assert.match(verifier, /report\?\.secondOldLeader !== report\.newLeader/);
  assert.match(verifier, /report\?\.secondRecoveredStreamSequence !== 5/);
  assert.match(verifier, /report\?\.sameConnectionSessionAfterSecondFailover !== true/);
  assert.match(verifier, /report\?\.overlappingOfflineServers !== 2/);
  assert.match(verifier, /report\?\.quorumUnavailableObserved !== true/);
  assert.match(verifier, /report\.quorumFailureElapsedNanos > report\.quorumFailureBudgetNanos/);
  assert.match(verifier, /report\?\.quorumRecoveredStreamSequence !== 7/);
  assert.match(verifier, /report\?\.persistedAfterQuorumRecovery !== 8/);
  assert.match(verifier, /report\?\.sameConnectionSessionAfterQuorumRecovery !== true/);
  assert.match(verifier, /report\?\.finalReplicaRecoveryPassed !== true/);
  assert.match(verifier, /report\?\.concurrentFaultInjected !== true/);
  assert.match(verifier, /report\?\.concurrentStoppedServers !== 2/);
  assert.match(verifier, /report\.concurrentStopSkewNanos > report\.concurrentStopSkewBudgetNanos/);
  assert.match(verifier, /report\?\.concurrentRecoveredStreamSequence !== 9/);
  assert.match(verifier, /report\?\.persistedAfterConcurrentRecovery !== 10/);
  assert.match(verifier, /report\?\.sameConnectionSessionAfterConcurrentRecovery !== true/);
  assert.match(verifier, /report\?\.concurrentReplicaRecoveryPassed !== true/);
  assert.match(verifier, /report\?\.networkPartitionInjected !== true/);
  assert.match(verifier, /report\?\.networkPartitionedServers !== 3/);
  assert.match(verifier, /report\.networkPartitionLeader === report\.networkPartitionConnectionServer/);
  assert.match(verifier, /report\.routeProxyConnectionsBefore < 3/);
  assert.match(verifier, /report\.routeProxyConnectionsClosed < 3/);
  assert.match(verifier, /report\.partitionFailureElapsedNanos > report\.partitionFailureBudgetNanos/);
  assert.match(verifier, /report\?\.partitionRecoveredStreamSequence !== 11/);
  assert.match(verifier, /report\?\.persistedAfterPartitionRecovery !== 12/);
  assert.match(verifier, /report\?\.sameConnectionSessionAfterPartitionRecovery !== true/);
  assert.match(verifier, /report\?\.partitionReplicaRecoveryPassed !== true/);
  assert.match(verifier, /Starting nats-server/);
  assert.equal(
    JSON.parse(packageDocument).scripts['evidence:verify'],
    'node scripts/evidence-verify.mjs',
  );

  await mkdir(path.join(repositoryRoot, '.temp'), { recursive: true });
  const recoveryRoot = path.join(repositoryRoot, '.temp', 'recovery');
  const recoveryFixtureRoot = path.join(recoveryRoot, '.test-fixtures');
  await mkdir(recoveryFixtureRoot, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(repositoryRoot, '.temp', 'manifest-test-'));
  const artifactDirectory = await mkdtemp(path.join(recoveryFixtureRoot, 'manifest-verify-'));
  const outputPath = path.join(temporaryDirectory, 'manifest.json');
  const artifactPath = path.join(artifactDirectory, 'recovery-result.txt');
  await writeFile(artifactPath, 'verified recovery artifact\n', 'utf8');
  try {
    const result = runScript('scripts/evidence-manifest.mjs', ['--output', outputPath]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(manifest.repository.gitCommit, /^[a-f0-9]{40}$|^unknown$/);
    assert.ok(Array.isArray(manifest.inputs));
    assert.ok(manifest.inputs.some((input) => input.path === 'package.json' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/observability/metrics.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/auth/jwks.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/auth/jwks_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/application_query.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/auth_middleware.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/app_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit_chain.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit_chain_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit_sink.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/security_audit_sink_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/httpapi/token_verifier_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/observability/tracing_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/prometheus/rules/goexample-slo.yml' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/edge/goexample-nginx.contract.json' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/edge/README.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/kubernetes/goexample-api.template.json' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'support/deploy/kubernetes/README.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/security/server-threat-model.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/security/server-audit-events.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/待优化/待优化V13.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/evidence-manifest.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/evidence-verify.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/server-recovery-drill.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/server-release.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/transport-benchmark-report.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/lib/transport-benchmark-environment.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/transport-soak-report.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/kubernetes-manifest.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nginx-edge.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/nginx-edge-contract.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/postgres-recovery-contract.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'scripts/postgres-recovery-report.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/kubernetes-manifest.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/nginx-edge.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/postgres-recovery-report.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/server-release.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/transport-benchmark-report.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '__test__/node/transport-soak-report.test.mjs' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '.github/workflows/go-transport-benchmark.yml' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === '.github/workflows/node-tools-quality.yml' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'docs/recovery/server-failure-matrix.md' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Solutions/Example/internal/projectapi/routes_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Solutions/Example/internal/projectapi/openapi_contract_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Solutions/Example/internal/projectapi/transport_benchmark_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Solutions/Example/internal/projectapp/service_test.go' && input.sha256));
    assert.ok(manifest.inputs.some((input) => input.path === 'Framework/queueclient/natsjetstream/cluster_integration_test.go' && input.sha256));
    assert.ok(manifest.boundaries.productionSharedStore.status === 'not_recorded');
    assert.ok(manifest.boundaries.otelCollector.status === 'not_recorded');
    assert.ok(manifest.boundaries.postgresRecovery.status === 'not_recorded');
    assert.ok(manifest.boundaries.natsBroker.status === 'not_recorded');
    assert.ok(['recorded', 'failed', 'not_recorded'].includes(manifest.boundaries.localNatsRestart.status));
    assert.ok(['recorded', 'failed', 'not_recorded'].includes(manifest.boundaries.localNatsClusterFailover.status));
    assert.ok(manifest.boundaries.oidcProvider.status === 'not_recorded');
    assert.ok(manifest.boundaries.signedRelease.status === 'not_recorded');
    assert.ok(manifest.boundaries.targetEdge.status === 'not_recorded');
    assert.ok(manifest.boundaries.kubernetesDrill.status === 'not_recorded');

    const verified = runScript('scripts/evidence-verify.mjs', ['--manifest', outputPath]);
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /Evidence manifest verified/);

    const falseRecoveryManifest = JSON.parse(JSON.stringify(manifest));
    falseRecoveryManifest.boundaries.postgresRecovery.status = 'recorded';
    falseRecoveryManifest.boundaries.postgresRecovery.reason = 'forged recorded state';
    const falseRecoveryPath = path.join(temporaryDirectory, 'false-postgres-recovery.json');
    await writeFile(falseRecoveryPath, `${JSON.stringify(falseRecoveryManifest, null, 2)}\n`, 'utf8');
    const falseRecovery = runScript('scripts/evidence-verify.mjs', ['--manifest', falseRecoveryPath]);
    assert.equal(falseRecovery.status, 1);
    assert.match(falseRecovery.stderr, /recorded postgresRecovery is missing required artifact/);

    const falseNatsRestartManifest = JSON.parse(JSON.stringify(manifest));
    falseNatsRestartManifest.evidence.natsRestart = [];
    falseNatsRestartManifest.boundaries.localNatsRestart.status = 'recorded';
    falseNatsRestartManifest.boundaries.localNatsRestart.reason = 'forged recorded state';
    const falseNatsRestartPath = path.join(temporaryDirectory, 'false-nats-restart.json');
    await writeFile(falseNatsRestartPath, `${JSON.stringify(falseNatsRestartManifest, null, 2)}\n`, 'utf8');
    const falseNatsRestart = runScript('scripts/evidence-verify.mjs', ['--manifest', falseNatsRestartPath]);
    assert.equal(falseNatsRestart.status, 1);
    assert.match(falseNatsRestart.stderr, /recorded localNatsRestart is missing required artifact/);

    const falseNatsClusterManifest = JSON.parse(JSON.stringify(manifest));
    falseNatsClusterManifest.evidence.natsCluster = [];
    falseNatsClusterManifest.boundaries.localNatsClusterFailover.status = 'recorded';
    falseNatsClusterManifest.boundaries.localNatsClusterFailover.reason = 'forged recorded state';
    const falseNatsClusterPath = path.join(temporaryDirectory, 'false-nats-cluster.json');
    await writeFile(falseNatsClusterPath, `${JSON.stringify(falseNatsClusterManifest, null, 2)}\n`, 'utf8');
    const falseNatsCluster = runScript('scripts/evidence-verify.mjs', ['--manifest', falseNatsClusterPath]);
    assert.equal(falseNatsCluster.status, 1);
    assert.match(falseNatsCluster.stderr, /recorded localNatsClusterFailover is missing required artifact/);

    const artifactManifest = JSON.parse(JSON.stringify(manifest));
    const artifactContents = await readFile(artifactPath);
    artifactManifest.evidence.recovery.push({
      path: path.relative(repositoryRoot, artifactPath).split(path.sep).join('/'),
      bytes: artifactContents.length,
      sha256: createHash('sha256').update(artifactContents).digest('hex'),
    });
    const artifactManifestPath = path.join(temporaryDirectory, 'artifact.json');
    await writeFile(artifactManifestPath, `${JSON.stringify(artifactManifest, null, 2)}\n`, 'utf8');
    const artifactVerified = runScript('scripts/evidence-verify.mjs', ['--manifest', artifactManifestPath]);
    assert.equal(artifactVerified.status, 0, artifactVerified.stderr);

    await writeFile(artifactPath, 'tampered recovery artifact\n', 'utf8');
    const tampered = runScript('scripts/evidence-verify.mjs', ['--manifest', artifactManifestPath]);
    assert.equal(tampered.status, 1);
    assert.match(tampered.stderr, /hash mismatch/);

    const unsafeManifest = JSON.parse(JSON.stringify(manifest));
    unsafeManifest.inputs[0].path = '../go.work';
    const unsafeManifestPath = path.join(temporaryDirectory, 'unsafe.json');
    await writeFile(unsafeManifestPath, `${JSON.stringify(unsafeManifest, null, 2)}\n`, 'utf8');
    const unsafe = runScript('scripts/evidence-verify.mjs', ['--manifest', unsafeManifestPath]);
    assert.equal(unsafe.status, 1);
    assert.match(unsafe.stderr, /contains an unsafe path/);

    const outsidePath = path.join(repositoryRoot, 'manifest-outside-temp.json');
    const rejected = runScript('scripts/evidence-manifest.mjs', ['--output', outsidePath]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /inside the repository \.temp directory/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(artifactDirectory, { recursive: true, force: true });
  }
});

test('Go server release is checksum-bound, tamper-tested, and remotely attested', async () => {
  const [releaseScript, releaseTests, environment, workflow, nodeWorkflow, packageDocument, evidenceManifest, evidenceVerify] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'server-release.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'server-release.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'environment.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-verify.mjs'), 'utf8'),
  ]);
  const scripts = JSON.parse(packageDocument).scripts;

  assert.equal(scripts['release:server:build'], 'node scripts/server-release.mjs build');
  assert.equal(scripts['release:server:verify'], 'node scripts/server-release.mjs verify');
  assert.match(releaseScript, /CGO_ENABLED: '0'/);
  assert.match(releaseScript, /GOOS: 'linux'/);
  assert.match(releaseScript, /GOARCH: 'amd64'/);
  assert.match(releaseScript, /GOTOOLCHAIN: 'local'/);
  assert.match(releaseScript, /'-trimpath', '-buildvcs=false'/);
  assert.match(releaseScript, /little-endian ELF64 amd64 binary/);
  assert.match(releaseScript, /SHA256SUMS must contain exactly the attested release subject/);
  assert.match(releaseScript, /SERVER_RELEASE_REQUIRE_CLEAN/);
  assert.match(releaseTests, /rejects artifact or metadata tampering/);
  assert.match(releaseTests, /appendFile\(artifactPath, 'tampered'\)/);
  assert.match(releaseTests, /manifest\.subject\.name = '\.\.\/outside'/);
  assert.match(environment, /version === requiredGoVersion/);
  assert.match(environment, /GOEXAMPLE_GO_ARCHIVE/);
  assert.match(environment, /Reusing verified Go archive/);

  assert.match(workflow, /server-release-provenance:/);
  assert.match(workflow, /github\.event\.repository\.default_branch/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /go-version: 1\.25\.13/);
  assert.match(workflow, /SERVER_RELEASE_REQUIRE_CLEAN: "true"/);
  assert.match(workflow, /actions\/attest-build-provenance@977bb373ede98d70efdf65b84cb5f73e068dcc2a # v3\.0\.0/);
  assert.match(workflow, /subject-checksums: \.temp\/server-release\/SHA256SUMS/);
  assert.match(workflow, /gh attestation verify/);
  assert.match(workflow, /provenance\.bundle\.json/);
  assert.match(workflow, /attestation-status\.txt/);
  assert.match(workflow, /goexample-server-release-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(
    nodeWorkflow,
    /Set up Go[\s\S]*actions\/setup-go@b7ad1dad31e06c5925ef5d2fc7ad053ef454303e # v7[\s\S]*go-version: 1\.25\.13[\s\S]*Test root Node tools/,
  );

  assert.match(evidenceManifest, /\['release', path\.join\(tempRoot, 'server-release'\)\]/);
  assert.match(evidenceManifest, /const signedReleaseStatus/);
  assert.match(evidenceManifest, /gh attestation verify/);
  assert.match(evidenceVerify, /document\.signedRelease\.status === 'recorded'/);
  assert.match(evidenceVerify, /signedRelease\.bundle\.verificationMaterial/);
  assert.match(evidenceVerify, /attestation-status\.txt/);
});

test('server recovery drill stays bounded, archived, and explicit about local-only evidence', async () => {
  const [packageDocument, workflow, runbook] = await Promise.all([
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'recovery', 'server-failure-matrix.md'), 'utf8'),
  ]);
  assert.equal(
    JSON.parse(packageDocument).scripts['drill:server'],
    'node scripts/server-recovery-drill.mjs',
  );

  const listed = runScript('scripts/server-recovery-drill.mjs', ['--list']);
  assert.equal(listed.status, 0, listed.stderr);
  const scenarioDocument = JSON.parse(listed.stdout);
  assert.equal(scenarioDocument.schemaVersion, 1);
  assert.deepEqual(
    scenarioDocument.scenarios.map((scenario) => scenario.id),
    [
      'redis_outage_and_lock_safety',
      'otel_outage_and_recovery',
      'http_deadline_drain_and_shutdown',
      'outbound_timeout_and_cancellation',
    ],
  );
  for (const scenario of scenarioDocument.scenarios) {
    assert.ok(scenario.package.startsWith('./Framework/'));
    assert.ok(scenario.tests.length > 0);
  }

  const rejected = runScript('scripts/server-recovery-drill.mjs', ['--unknown']);
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /unknown argument: --unknown/);

  assert.match(workflow, /docs\/recovery\/\*\*/);
  assert.match(workflow, /local-recovery-drill:/);
  assert.match(workflow, /run: yarn drill:server/);
  assert.match(workflow, /if: always\(\)\s+run: yarn evidence:manifest --output \.temp\/recovery\/server-local\/manifest\.json/);
  assert.match(workflow, /if: always\(\)\s+run: yarn evidence:verify --manifest \.temp\/recovery\/server-local\/manifest\.json/);
  assert.match(workflow, /if: always\(\)\s+uses: actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /path: \.temp\/recovery\/server-local/);

  assert.match(runbook, /This is local contract evidence/);
  assert.match(runbook, /do not prove target Redis HA/);
  assert.match(runbook, /does not prove provenance/);
  assert.match(runbook, /Remote status remains unverified/);
  assert.match(runbook, /RPO, or RTO/);
});

test('server threat model maps STRIDE risks to evidence and residual boundaries', async () => {
  const threatModel = await readFile(
    path.join(repositoryRoot, 'docs', 'security', 'server-threat-model.md'),
    'utf8',
  );
  assert.match(threatModel, /Out of scope: `MSFront`/);
  assert.match(threatModel, /## 2\. Assets And Data Classification/);
  assert.match(threatModel, /## 3\. Trust Boundaries And Data Flow/);
  assert.match(threatModel, /## 4\. STRIDE Threat Register/);
  assert.match(threatModel, /## 5\. Security Invariants/);
  assert.match(threatModel, /## 6\. Open Production Risks/);
  assert.match(threatModel, /## 7\. Review Triggers And Ownership/);
  for (const classification of ['Restricted', 'Confidential', 'Internal', 'Public']) {
    assert.match(threatModel, new RegExp(`\\| ${classification} \\|`));
  }
  const threats = [...threatModel.matchAll(/^\| TM-(\d{2}) \| ([^|]+) \|/gm)];
  assert.equal(threats.length, 16, 'server threat register must retain all reviewed threats');
	assert.match(threatModel, /TM-16[\s\S]*state[\s\S]*SameSite/);
  const categories = new Set(threats.flatMap((threat) => threat[2].split('/').map((item) => item.trim())));
  for (const category of ['Spoofing', 'Tampering', 'Repudiation', 'Information disclosure', 'Denial of service', 'Elevation of privilege']) {
    assert.ok(categories.has(category), `server threat model is missing STRIDE category ${category}`);
  }
  assert.match(threatModel, /Framework\/httpapi\/lifecycle_contract_test\.go/);
  assert.match(threatModel, /Framework\/observability/);
  assert.match(threatModel, /scripts\/openapi-compat\.mjs/);
  assert.match(threatModel, /deploy\/edge\/goexample-nginx\.contract\.json/);
  assert.match(threatModel, /Nginx/);
  assert.match(threatModel, /OWASP Threat Modeling Cheat Sheet/);
  assert.match(threatModel, /does not prove a production control/);
	assert.match(threatModel, /cannot enumerate or revoke another subject's session/);
});

test('server security audit events stay correlated, bounded, and credential-safe', async () => {
  const [auditSource, sinkSource, chainSource, chainTests, authRoutes, authMiddleware, diagnostics, metrics, appTests, sinkTests, metricsTests, contract, rules] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit_sink.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit_chain.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit_chain_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_auth.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'auth_middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'diagnostics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'security_audit_sink_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'security', 'server-audit-events.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'rules', 'goexample-slo.yml'), 'utf8'),
  ]);
  assert.match(auditSource, /"security_audit"/);
  for (const field of ['request_id', 'trace_id', 'span_id']) {
    assert.match(auditSource, new RegExp(`"${field}"`));
  }
  assert.doesNotMatch(auditSource, /c\.Get\(fiber\.HeaderAuthorization\)|c\.Body\(|c\.OriginalURL\(|c\.IP\(/);
  assert.match(authRoutes, /invalid_credentials/);
  assert.match(authRoutes, /rate_limited/);
  assert.match(authMiddleware, /token_missing/);
  assert.match(authMiddleware, /token_invalid/);
  assert.match(diagnostics, /securityEventDiagnostics/);
  assert.match(auditSource, /securityEventAuthorization\s+=\s+"authorization"/);
  assert.match(metrics, /goexample_security_events_total/);
  assert.match(metrics, /securityLabelIndex/);
  assert.match(sinkSource, /type SecurityAuditRecord struct/);
  assert.match(sinkSource, /type SecurityAuditSink interface/);
  assert.match(sinkSource, /WriteSecurityAudit\(context\.Context, SecurityAuditRecord\) error/);
  assert.match(auditSource, /context\.WithTimeout\(parent, options\.SecurityAuditTimeout\)/);
  assert.match(auditSource, /recover\(\)/);
  assert.doesNotMatch(auditSource, /sink.*(?:err|error)|(?:err|error).*sink/i);
  assert.match(metrics, /goexample_security_audit_sink_writes_total/);
  assert.match(metrics, /RecordSecurityAuditSinkWrite/);
  assert.match(appTests, /TestSecurityAuditEventsAreCorrelatedBoundedAndCredentialSafe/);
  assert.match(appTests, /role_required/);
  assert.match(appTests, /target: "application_command"/);
  assert.match(metricsTests, /TestMetricsRenderSecurityEventsWithFixedLabels/);
  assert.match(metricsTests, /TestMetricsRenderSecurityAuditSinkOutcomesWithFixedLabels/);
  assert.match(sinkTests, /TestSecurityAuditSinkReceivesBoundedLowSensitivityRecord/);
  assert.match(sinkTests, /TestSecurityAuditSinkFailuresAreIsolatedAndCredentialSafe/);
  assert.match(sinkTests, /TestSecurityAuditSinkHonorsConfiguredTimeoutWithoutChangingResponse/);
  assert.match(chainSource, /func NewHashChainAuditSink/);
  assert.match(chainSource, /func VerifyHashChain/);
  assert.match(chainSource, /func NewEncryptedAuditWriter/);
  assert.match(chainSource, /func VerifyEncryptedHashChain/);
  assert.match(chainSource, /cipher\.NewGCM/);
  assert.match(chainSource, /rand\.Reader/);
  assert.match(chainSource, /RotateKey/);
  assert.match(chainSource, /seenNonces/);
  assert.match(chainSource, /defaultAuditChainRecordBytes\s*=\s*16 << 10/);
  assert.match(chainSource, /maxAuditChainRecordBytes\s*=\s*1 << 20/);
  assert.match(chainSource, /json\.NewDecoder/);
  assert.match(chainSource, /DisallowUnknownFields/);
	assert.match(chainSource, /oidc_callback_valid/);
	assert.match(chainSource, /oidc_browser/);
  assert.match(chainTests, /TestHashChainAuditSinkWritesAndVerifiesLinkedRecords/);
  assert.match(chainTests, /TestHashChainAuditSinkRejectsTamperingAndInvalidRecords/);
  assert.match(chainTests, /TestHashChainAuditSinkSerializesConcurrentWriters/);
  assert.match(chainTests, /TestEncryptedAuditWriterEncryptsAndSupportsKeyRotation/);
  assert.match(chainTests, /TestEncryptedAuditWriterRejectsTamperingUnknownKeysAndInvalidConfig/);
  assert.match(contract, /must not contain a submitted username, password, authorization header, token/);
  assert.match(contract, /NewHashChainAuditSink/);
  assert.match(contract, /does not make an arbitrary `io\.Writer` durable, encrypted, access-controlled, immutable/);
  assert.match(contract, /authenticated principal lacked every role/);
  assert.match(contract, /does not provide or deploy an immutable audit sink/);
  assert.match(rules, /goexample:security:login_rate_limited_rate5m/);
  assert.match(rules, /GoExampleAuthenticationRateLimited/);
  assert.match(rules, /goexample:security:audit_sink_failure_rate5m/);
  assert.match(rules, /GoExampleSecurityAuditSinkFailures/);
});

test('V12 completion and V13 backlog match the weighted evaluation', async () => {
  const [evaluation, backlog, nextBacklog] = await Promise.all([
    readFile(path.join(repositoryRoot, 'docs', '评估', '项目架构与性能评估.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V12.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V13.md'), 'utf8'),
  ]);
  const rows = [
    ...evaluation.matchAll(/^\| (?!\*\*综合评分)([^|]+) \| (\d+)% \| ([\d.]+) \| ([\d.]+) \|/gm),
  ];

  assert.equal(rows.length, 18, 'V12 score table must contain 18 weighted dimensions');
  const weightTotal = rows.reduce((total, row) => total + Number(row[2]), 0);
  assert.equal(weightTotal, 100, 'V12 score weights must total 100%');

  let calculatedTotal = 0;
  for (const row of rows) {
    const expectedContribution = (Number(row[2]) * Number(row[3])) / 100;
    const documentedContribution = Number(row[4]);
    assert.ok(
      Math.abs(expectedContribution - documentedContribution) < 0.0005,
      `${row[1].trim()} weighted score is inconsistent`,
    );
    calculatedTotal += documentedContribution;
  }

  const declared = evaluation.match(/精确加权值 \*\*([\d.]+)\/10\*\*/);
  assert.ok(declared, 'current evaluation must declare an exact weighted score');
  assert.equal(declared[1], '9.505', 'current score must include the second independent Framework service, six-module workspace, Billing OpenAPI/SDK contract, multi-project build, and all prior V12 evidence without claiming remote Linux results, target payload/IdP/dependency/TLS edge capacity, target IdP MFA deployment, native Fiber cancellation, device UI, production policy, target recovery, identity, or HA evidence');
  const roundedCalculatedTotal = Math.round((calculatedTotal + 1e-9) * 1000) / 1000;
  assert.equal(roundedCalculatedTotal.toFixed(3), declared[1]);
  assert.match(backlog, /V12-01/);
  assert.match(backlog, /V12-10/);
  assert.match(backlog, /状态：\*\*已完成\*\*/);
  assert.match(backlog, /原有“V12 本身仍未完成”均由本次收口决定取代/);
  assert.match(backlog, /当前精确综合评分：\*\*9\.493\/10\*\*/);
  assert.match(nextBacklog, /状态：\*\*实施中\*\*/);
  assert.match(nextBacklog, /当前精确综合评分：\*\*9\.505\/10\*\*/);
  assert.match(nextBacklog, /V13-01/);
  assert.match(nextBacklog, /V13-09/);
  assert.match(nextBacklog, /V12-06/);
	assert.match(backlog, /capacityKnee/);
  assert.match(backlog, /9 × 2/);
  assert.match(backlog, /3 × 2 × 5/);
  assert.match(backlog, /10%\/20%\/25%/);
  assert.match(backlog, /baseline-source\.json/);
  assert.match(backlog, /environmentFingerprint/);
  assert.match(backlog, /明确排除 PR 运行/);
	assert.match(backlog, /hash-only opaque session\/CSRF\/logout/);
	assert.match(backlog, /AuthorizationRequestStore/);
	assert.match(backlog, /并发恰好一个成功/);
	assert.match(backlog, /RequiredACR/);
	assert.match(backlog, /RequiredAMR/);
	assert.match(backlog, /MaxAuthAge/);
	assert.match(backlog, /BrowserSessionInventoryStore/);
	assert.match(backlog, /MaxSessionsPerSubject/);
	assert.match(backlog, /GET \/api\/v1\/auth\/oidc\/sessions/);
	assert.match(backlog, /Framework API snapshot 已更新为 332 个符号/);
	assert.match(backlog, /Framework\/authorization/);
  assert.match(backlog, /schema v5/);
  assert.match(backlog, /schema v6/);
  assert.match(backlog, /route 网络分区/);
  assert.match(backlog, /屏障同步/);
  assert.match(backlog, /NATS_SERVER_BINARY/);
  assert.match(backlog, /localNatsSnapshotRestore=recorded/);
  assert.match(backlog, /主动篡改拒绝/);
  assert.match(backlog, /SecurityAuditSink/);
  assert.match(backlog, /support\/consumer\/HealthProbe/);
  assert.match(nextBacklog, /Services\/Billing/);
  assert.match(backlog, /Framework\/sqlclient/);
  assert.match(backlog, /Framework\/queueclient/);
  assert.match(nextBacklog, /V13-05/);
  assert.match(nextBacklog, /目标数据库与消息系统实证/);
  assert.match(backlog, /生产 broker/);
  assert.match(backlog, /NATS_TEST_URL/);
  assert.match(backlog, /OIDC\/JWKS 资源服务器基础/);
  assert.match(backlog, /Authorization Code \+ PKCE/);
  assert.match(backlog, /yarn sdk:check/);
  assert.match(backlog, /10\.0\/10/);
});

test('Example project queries and commands keep Fiber behind the Framework adapter', async () => {
  const [applicationAuthorization, applicationQuery, applicationCommand, applicationPrecondition, idempotencyFingerprint, middleware, standardHandler, standardHandlerTests, standardServer, standardServerTests, authMiddleware, routes, app, appTests, projectRoutes, projectService, entrypoint, architectureTests, projectRouteTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_authorization.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_query.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_command.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_precondition.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'idempotency_fingerprint.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'standard_handler.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'standard_handler_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'server', 'http.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'server', 'http_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'auth_middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapp', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'architecture_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes_test.go'), 'utf8'),
  ]);

  assert.match(applicationQuery, /type ApplicationQuery struct/);
  assert.match(applicationQuery, /Handler\s+func\(context\.Context\) \(any, error\)/);
  assert.match(applicationQuery, /func NewQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /func NewAuthenticatedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /func NewAuthorizedQuery\[Request, Response any\]/);
	assert.match(applicationQuery, /func NewResourceAuthorizedQuery\[Request, Response any\]/);
	assert.match(applicationQuery, /func NewResourceAuthorizedVersionedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /authorizationRequired/);
  assert.match(applicationAuthorization, /type ApplicationPrincipal struct/);
  assert.match(applicationAuthorization, /validateApplicationRoleRequirements/);
  assert.match(applicationAuthorization, /func authorizeApplicationRoles/);
  assert.match(applicationQuery, /binder\.URIBinding/);
  assert.match(applicationQuery, /binder\.QueryBinding/);
  assert.match(applicationQuery, /binder\.HeaderBinding/);
  assert.match(applicationQuery, /applicationQueryRoutesOverlap/);
  assert.match(applicationQuery, /func registerApplicationQueries/);
  assert.match(applicationQuery, /func \(query ApplicationQuery\) WithMethod\(method string\)/);
  assert.match(applicationQuery, /case fiber\.MethodGet, fiber\.MethodHead/);
  assert.match(applicationQuery, /router\.Add\(\[\]string\{query\.method\}/);
  assert.match(applicationCommand, /type ApplicationCommand struct/);
  assert.match(applicationCommand, /func NewJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewAuthenticatedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewAuthorizedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewVersionedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewAuthenticatedVersionedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /func NewAuthorizedVersionedJSONCommand\[Request, Response any\]/);
	assert.match(applicationCommand, /func NewResourceAuthorizedJSONCommand\[Request, Response any\]/);
	assert.match(applicationCommand, /func NewResourceAuthorizedVersionedJSONCommand\[Request, Response any\]/);
  assert.match(applicationCommand, /requireApplicationPrecondition/);
  assert.match(applicationCommand, /fingerprintHeaders = \[\]string\{fiber\.HeaderIfMatch\}/);
  assert.match(applicationCommand, /func \(command ApplicationCommand\) WithMethod\(method string\)/);
  assert.match(applicationCommand, /router\.Add\(\[\]string\{command\.method\}/);
  assert.match(standardHandler, /func NewHTTPHandler\(app \*fiber\.App\) \(http\.Handler, error\)/);
  assert.match(standardHandler, /request\.Clone\(request\.Context\(\)\)/);
  assert.match(standardHandler, /standardRequestContexts\.LoadAndDelete/);
  assert.match(standardHandler, /Header\.Del\(standardRequestContextHeader\)/);
  assert.match(app, /app\.Use\(standardRequestContextBridge\(\)\)/);
  assert.match(standardHandler, /app\.ShutdownWithContext/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerComposesWithStandardMiddleware/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerPropagatesRequestCancellation/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerPropagatesStandardClientDisconnect/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerPreservesCallerDeadlineAndContextValue/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerRemovesInternalContextHeader/);
  assert.match(standardHandlerTests, /TestNewHTTPHandlerShutdownCancelsApplicationWork/);
  assert.match(standardServer, /func RunHTTP\(ctx context\.Context, options HTTPOptions\) error/);
  assert.match(standardServer, /ReadHeaderTimeout:/);
  assert.match(standardServer, /netutil\.LimitListener\(listener, options\.MaxConnections\)/);
  assert.match(standardServer, /ApplicationShutdown/);
  assert.match(standardServer, /type HTTPConnectionObserver interface/);
  assert.match(standardServer, /notifyHTTPConnectionState/);
  assert.match(standardServer, /httpServer\.Shutdown\(ctx\)/);
  assert.match(standardServer, /httpServer\.Close\(\)/);
  assert.match(standardServerTests, /TestRunHTTPBoundsSlowRequestHeaders/);
  assert.match(standardServerTests, /TestRunHTTPBoundsAcceptedConnections/);
  assert.match(standardServerTests, /TestRunHTTPForcesBoundedShutdown/);
  assert.match(standardServerTests, /TestRunHTTPBoundsApplicationShutdownHook/);
  assert.match(standardServerTests, /TestRunHTTPIsolatesApplicationShutdownPanic/);
  assert.match(standardServerTests, /TestRunHTTPIsolatesConnectionObserverPanic/);
  assert.match(applicationCommand, /bindBody\(c, request\)/);
  assert.match(applicationCommand, /idempotencyMiddleware/);
  assert.ok(applicationCommand.indexOf('requireAuth(options)') < applicationCommand.indexOf('idempotencyMiddleware'));
	assert.ok(applicationCommand.indexOf('authorizeApplicationResource') < applicationCommand.indexOf('idempotencyMiddleware'));
  assert.match(applicationPrecondition, /type ApplicationPrecondition struct/);
  assert.match(applicationPrecondition, /fiber\.StatusPreconditionRequired/);
  assert.match(applicationPrecondition, /If-Match must contain one strong version tag/);
  assert.match(applicationPrecondition, /var ErrPreconditionFailed/);
  assert.match(applicationQuery, /func NewVersionedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /func NewAuthenticatedVersionedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /func NewAuthorizedVersionedQuery\[Request, Response any\]/);
  assert.match(applicationQuery, /weakETagMatches\(c\.Get\(fiber\.HeaderIfNoneMatch\), entityTag\)/);
  assert.match(idempotencyFingerprint, /fingerprintHeaders \.\.\.string/);
  assert.match(middleware, /fiber\.HeaderETag/);
  assert.match(middleware, /fiber\.HeaderPragma/);
  assert.match(routes, /registerApplicationQueries/);
  assert.match(routes, /registerApplicationCommands/);
  assert.match(routes, /ApplicationQueries\/ApplicationCommands and RegisterRoutes cannot be configured together/);
  assert.match(app, /ApplicationQueries\s+\[\]ApplicationQuery/);
  assert.match(app, /ApplicationCommands\s+\[\]ApplicationCommand/);
  assert.match(appTests, /TestApplicationQueriesKeepHandlersTransportNeutral/);
  assert.match(appTests, /TestTypedApplicationQueryBindsIsolatedSourcesAndAuthenticatedPrincipal/);
  assert.match(appTests, /TestAuthorizedApplicationQueryEnforcesCopiedAnyOfRolesBeforeBinding/);
  assert.match(appTests, /TestTypedApplicationQueriesRejectUnsafeBindingsAndOverlappingRoutes/);
  assert.match(appTests, /TestApplicationQueryErrorsUseTheServerErrorBoundary/);
  assert.match(appTests, /TestVersionedApplicationQueryReturnsStrongETagAndHandlesConditionalGET/);
  assert.match(appTests, /TestApplicationQuerySupportsExplicitHEADWithoutGETRoute/);
  assert.match(appTests, /TestAuthorizedVersionedApplicationQueryChecksAccessBeforeBinding/);
  assert.match(appTests, /TestApplicationQueriesRejectAmbiguousDefinitions/);
  assert.match(appTests, /TestApplicationCommandsBindValidateTraceAndReplayWithoutFiber/);
  assert.match(appTests, /TestAuthenticatedApplicationCommandExposesMinimizedPrincipal/);
  assert.match(appTests, /TestAuthorizedApplicationCommandRejectsBeforeMediaTypeIdempotencyAndBinding/);
  assert.match(appTests, /TestApplicationCommandErrorsUseTheServerErrorBoundary/);
  assert.match(appTests, /TestApplicationCommandsRejectAmbiguousDefinitions/);
  assert.match(appTests, /TestApplicationCommandsSupportExplicitMutationMethods/);
  assert.match(appTests, /TestVersionedApplicationCommandEnforcesStrongPreconditionsAndIdempotency/);
  assert.match(appTests, /TestAuthorizedVersionedApplicationCommandChecksAccessBeforePrecondition/);
  assert.match(projectRoutes, /func Queries\(options httpapi\.Options\) \[\]httpapi\.ApplicationQuery/);
  assert.match(projectRoutes, /func Commands\(options httpapi\.Options\) \[\]httpapi\.ApplicationCommand/);
	assert.match(projectRoutes, /httpapi\.NewResourceAuthorizedJSONCommand/);
	assert.match(projectRoutes, /httpapi\.NewResourceAuthorizedQuery/);
  assert.match(projectService, /RequestedBy/);
  assert.match(projectService, /func \(s \*Service\) PreviewProject/);
  assert.match(authMiddleware, /setNoStoreHeaders\(c\)/);
  assert.match(entrypoint, /apiOptions\.ApplicationQueries = projectapi\.Queries\(apiOptions\)/);
  assert.match(entrypoint, /apiOptions\.ApplicationCommands = projectapi\.Commands\(apiOptions\)/);
  assert.match(entrypoint, /httpapi\.NewHTTPHandler\(app\)/);
  assert.match(entrypoint, /server\.RunHTTP\(ctx, server\.HTTPOptions/);
  assert.match(entrypoint, /ApplicationShutdown:\s+app\.ShutdownWithContext/);
  assert.match(entrypoint, /MaxConnections:\s+cfg\.MaxConnections/);
  assert.doesNotMatch(projectRoutes, /gofiber|fiber\./i);
  assert.doesNotMatch(entrypoint, /gofiber|fiber\./i);
  assert.match(architectureTests, /TestProductionProjectCompositionDoesNotImportFiber/);
  assert.match(projectRouteTests, /TestProjectRouteCreatesChildApplicationSpan/);
  assert.match(projectRouteTests, /TestCommandsAddAuthorizedTypedProjectRoute/);
  assert.match(projectRouteTests, /TestProjectCommandCreatesChildApplicationSpan/);
  assert.match(projectRouteTests, /TestAuthenticatedPreviewBindsPathQueryHeaderAndCreatesChildSpan/);
  assert.match(projectRouteTests, /http\.StatusForbidden/);
});

test('resource authorization is bounded, fail-closed, and used by the Example project', async () => {
	const [contract, contractTests, adapter, adapterTests, projectPolicy, projectPolicyTests, projectRoutes, openapi] = await Promise.all([
		readFile(path.join(repositoryRoot, 'Framework', 'authorization', 'authorization.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Framework', 'authorization', 'authorization_test.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_authorization.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_resource_authorization_test.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapp', 'authorization.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapp', 'authorization_test.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes.go'), 'utf8'),
		readFile(path.join(repositoryRoot, 'docs', 'openapi', 'openapi.json'), 'utf8'),
	]);
	assert.match(contract, /type Authorizer interface/);
	assert.match(contract, /type Resource struct/);
	assert.match(contract, /TenantID\s+string/);
	assert.match(contract, /Attributes map\[string\]string/);
	assert.match(contract, /func ValidateRequest\(request Request\) error/);
	assert.match(contractTests, /TestValidateRequestRejectsUnboundedOrMalformedInput/);
	assert.match(adapter, /context\.WithTimeout\(c\.Context\(\), options\.ResourceAuthorizationTimeout\)/);
	assert.match(adapter, /recover\(\) != nil/);
	assert.match(adapter, /"resource_denied"/);
	assert.match(adapterTests, /TestResourceAuthorizedQueryFailsClosedWithoutExecutingHandler/);
	assert.match(adapterTests, /TestResourceAuthorizedCommandDoesNotPolluteIdempotencyOnDeny/);
	assert.match(adapterTests, /TestResourceAuthorizedVersionedCommandChecksPolicyBeforePrecondition/);
	assert.match(adapterTests, /private-policy-backend\.example/);
	assert.match(projectPolicy, /resource\.TenantID != request\.Principal\.Subject/);
	assert.match(projectPolicyTests, /"cross tenant"/);
	assert.match(projectRoutes, /requestedTenant\(request\.TenantID, principal\.Subject\)/);
	assert.match(openapi, /"x-resource-authorization"/);
	assert.match(openapi, /"tenantSource": "header:X-Tenant-ID or principal:subject"/);
});

test('Framework public API compatibility is versioned and compared with the target branch', async () => {
  const [snapshotDocument, version, policy, changelog, apiTool, apiToolTests, goProjectRunner, workflow, packageDocument, evidenceManifest, appTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'api-snapshot.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'VERSION'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'COMPATIBILITY.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'internal', 'apisnapshot', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'internal', 'apisnapshot', 'main_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'go-project.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
  ]);

  const snapshot = JSON.parse(snapshotDocument);
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.module, 'github.com/zbxing/goexample/Framework');
  assert.equal(snapshot.version, version.trim());
	assert.equal(Object.keys(snapshot.symbols).length, 332);
  assert.ok(Object.keys(snapshot.symbols).every((key) => !key.includes('/internal/')));
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/authorization::type Authorizer'], /Authorize\(context\.Context, Request\)/);
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/authorization::type Resource'], /TenantID[\s\S]*Attributes/);
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewResourceAuthorizedQuery'], /authorization\.Authorizer/);
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewResourceAuthorizedJSONCommand'], /ApplicationPrincipal/);
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/auth::func NewAuthorizationRequestManager'],
    /AuthorizationRequestConfig/,
  );
  assert.equal(
    snapshot.symbols['github.com/zbxing/goexample/Framework/auth::func ValidateAuthorizationNonce'],
    'func ValidateAuthorizationNonce(expected, actual string) error',
  );
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type BrowserSessionInventoryStore'], /DeleteBrowserSessionsForSubject/);
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::method \*BrowserSessionManager.ListForSubject'], /\[\]BrowserSessionInfo/);
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::type DeliveryRetryConfig'],
    /SettlementTimeout\s+time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::type DeliveryRetryConfig'],
    /LeaseExtensionInterval\s+time\.Duration[\s\S]*LeaseExtensionTimeout\s+time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::type Delivery'],
    /ExtendLease func\(context\.Context\) error/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::var ErrDeliverySettlement'],
    /queue delivery settlement failed/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::var ErrDeliveryLeaseExtension'],
    /queue delivery lease extension failed/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::var ErrLeaseExtension'],
    /nats jetstream lease extension failed/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::type Config'],
    /DeadLetterSubject string/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::func New'],
    /\*Adapter, error/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient::method *Client.MinimumDeliveryLease'],
    /DeliveryRetryConfig, safetyMargin time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/queueclient/natsjetstream::func PreflightConsumer'],
    /ConsumerInspector[\s\S]*DeliveryRetryConfig[\s\S]*time\.Duration/,
  );
  assert.match(
    snapshot.symbols['github.com/zbxing/goexample/Framework/auth::method *JWKSVerifier.VerifyIDToken'],
    /IDTokenClaims/,
  );
  assert.doesNotMatch(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type Service'], /secret|password|username/);
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type TokenVerifier'], /VerifyToken\(context\.Context, string\)/);
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type JWKSConfig'], /RefreshInterval time\.Duration/);
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/auth::type JWKSVerifier'], 'type JWKSVerifier struct {\n}');
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func AuthenticationEnabled'], 'func AuthenticationEnabled(options Options) bool');
	assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::type OIDCBrowser'], 'type OIDCBrowser struct {\n}');
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewOIDCBrowser'], /\*auth\.AuthorizationRequestManager[\s\S]*\*auth\.OIDCClient[\s\S]*\*auth\.JWKSVerifier/);
	assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::method *OIDCBrowser.Enabled'], 'func (browser *OIDCBrowser) Enabled() bool');
	assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::type Options'], /OIDCBrowser\s+\*OIDCBrowser/);
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func DefaultEndpointsForAuth'], /demoLoginEnabled bool/);
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func NewEncryptedAuditWriter'], 'func NewEncryptedAuditWriter(config EncryptedAuditWriterConfig) (*EncryptedAuditWriter, error)');
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/httpapi::func VerifyEncryptedHashChain'], 'func VerifyEncryptedHashChain(reader io.Reader, keyring AuditEncryptionKeyring) (int, error)');
  assert.equal(snapshot.symbols['github.com/zbxing/goexample/Framework/server::func RunHTTP'], 'func RunHTTP(ctx context.Context, options HTTPOptions) error');
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/server::type HTTPConnectionObserver'], /ObserveHTTPConnectionState/);
  assert.match(snapshot.symbols['github.com/zbxing/goexample/Framework/server::type HTTPOptions'], /Handler\s+http\.Handler/);
  assert.match(policy, /Framework\/v0\.1\.0/);
  assert.match(policy, /yarn api:compat/);
  assert.match(policy, /Patch releases never permit source-incompatible API changes/);
  assert.match(policy, /natsjetstream\.PreflightConsumer/);
  assert.match(
    policy,
    /treat either a failed server-backed lease check or runtime extension failure as fail-closed/,
  );
  assert.match(changelog, /Public API snapshot and target-branch compatibility gate/);
  assert.match(apiTool, /parser\.SkipObjectResolution/);
  assert.match(apiTool, /func exactChanges/);
  assert.match(apiTool, /func compatibilityChanges/);
  assert.match(apiTool, /func allowsBreakingChange/);
  assert.match(apiTool, /fileDiffersFromGit/);
  assert.match(apiTool, /exec\.Command\("git", "show"/);
  assert.match(apiToolTests, /TestCollectSnapshotKeepsOnlyImportableExportedAPI/);
  assert.match(apiToolTests, /TestSnapshotComparisonAllowsAdditionsAndGuardsBreakingChanges/);
  assert.match(goProjectRunner, /'api-compat'/);
  assert.match(goProjectRunner, /'api-snapshot'/);
  assert.match(goProjectRunner, /GOCACHE:\s*goCacheRoot/);
  assert.match(workflow, /Check Framework public API compatibility/);
  assert.match(workflow, /github\.event\.pull_request\.base\.sha/);
  assert.match(workflow, /fetch-depth:\s*0/);
  assert.match(workflow, /git cat-file -e/);
  assert.match(workflow, /validating the bootstrap snapshot only/);
  const packageScripts = JSON.parse(packageDocument).scripts;
  assert.equal(packageScripts['api:compat'], 'node scripts/go-project.mjs api-compat');
  assert.equal(packageScripts['api:snapshot'], 'node scripts/go-project.mjs api-snapshot');
  assert.match(evidenceManifest, /Framework\/api-snapshot\.json/);
  assert.match(evidenceManifest, /Framework\/auth\/oidc_flow\.go/);
  assert.match(evidenceManifest, /Framework\/auth\/oidc_flow_test\.go/);
  assert.match(appTests, /default route collision/);
  assert.match(appTests, /enabled auth route collision/);
});

test('Go and MSFront auth responses and JWT claims remain hardened', async () => {
  const [login, logout, me, proxy, responseSecurity, authToken, authTokenTest, logoutTest, proxyTest, instrumentation, instrumentationTest, e2e, goAuth, goAuthTest, goResponse, goApp] = await Promise.all([
    readFile(path.join(repositoryRoot, 'MSFront', 'app', 'api', 'auth', 'login', 'route.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'app', 'api', 'auth', 'logout', 'route.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'app', 'api', 'auth', 'me', 'route.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'proxy.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'lib', 'server', 'response-security.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'lib', 'server', 'auth-token.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', '__tests__', 'unit', 'auth-token.test.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', '__tests__', 'unit', 'logout-route.test.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', '__tests__', 'unit', 'proxy.test.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', 'instrumentation.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'MSFront', '__tests__', 'unit', 'instrumentation.test.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'e2e', 'msfront', 'auth-and-accessibility.spec.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'service_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'response.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
  ]);

  assert.match(logout, /isTrustedMutationOrigin/);
  for (const source of [login, logout, me, proxy]) {
    assert.match(source, /disableResponseCaching/);
  }
  assert.match(responseSecurity, /Cache-Control/);
  assert.match(responseSecurity, /no-store/);
  assert.match(responseSecurity, /no-transform/);
  assert.match(responseSecurity, /Pragma/);
  assert.match(responseSecurity, /no-cache/);
  assert.match(responseSecurity, /privateJson/);
  assert.match(authToken, /requiredClaims:\s*\['sub', 'iat', 'exp'\]/);
  assert.match(authToken, /maxTokenAge:\s*tokenTtl/);
  assert.match(authToken, /roleIds\.every/);
  assert.match(authTokenTest, /rejects a token older than the configured session lifetime/);
  assert.match(authToken, /validateAuthTokenConfiguration/);
  assert.match(instrumentation, /validateAuthTokenConfiguration/);
  assert.match(instrumentation, /validateTrustedMutationOrigins/);
  assert.match(instrumentationTest, /fails before serving when production auth configuration is unsafe/);
  assert.match(instrumentationTest, /fails before serving when a trusted origin is malformed/);
  assert.match(logoutTest, /rejects an untrusted mutation origin/);
  assert.match(proxy, /disableResponseCaching\(NextResponse\.redirect/);
  assert.match(proxyTest, /does not cache anonymous protected-page redirects/);
  assert.match(proxyTest, /does not cache authenticated login-page redirects/);
  assert.match(e2e, /anonymousMeResponse/);
  assert.match(e2e, /loginResponse\.headers\(\)\['cache-control'\]/);
  assert.match(e2e, /menusResponse\.headers\(\)\['cache-control'\]/);
  assert.match(e2e, /gvaPageTransition/);
  assert.match(e2e, /is-enter/);
  assert.match(goAuth, /jwt\.WithNotBeforeRequired\(\)/);
  assert.match(goAuth, /Audience:\s+jwt\.ClaimStrings\{s\.audience\}/);
  assert.match(goAuth, /jwt\.WithAudience\(s\.audience\)/);
  assert.match(goAuth, /validClaims/);
  assert.match(goAuth, /maxRoleCount/);
  assert.match(goAuth, /issuedAt\.Add\(ttl\+jwtClockLeeway\)/);
  assert.match(goAuthTest, /TestServiceRejectsMalformedAndOverageClaims/);
  assert.match(goAuthTest, /missing audience/);
  assert.match(goAuthTest, /wrong audience/);
  assert.match(goResponse, /setNoStoreHeaders/);
  assert.match(goResponse, /no-store, no-transform/);
  assert.match(goResponse, /HeaderPragma/);
  assert.match(goApp, /streamSafeETag/);

  const apiDirectory = path.join(repositoryRoot, 'MSFront', 'app', 'api');
  const apiRouteFiles = (await readdir(apiDirectory, { recursive: true }))
    .filter((fileName) => fileName.endsWith('route.ts'));
  for (const fileName of apiRouteFiles) {
    const route = await readFile(path.join(apiDirectory, fileName), 'utf8');
    assert.doesNotMatch(route, /NextResponse\.json/, `${fileName} bypasses privateJson`);
    assert.match(route, /privateJson|jsonOk/, `${fileName} must use a private JSON response helper`);
  }
});

test('server observability rules define executable SLO evidence', async () => {
  const [rules, runbook, metrics, metricsTests, tracingProvider, tracingTests, outboundClient, outboundTests, entrypoint, projectService, projectRouteTests, exampleEnvironment] = await Promise.all([
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'rules', 'goexample-slo.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'observability', 'SLO-and-alerts.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'tracing_provider.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'tracing_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpclient', 'client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapp', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
  ]);

  assert.match(rules, /^groups:/m);
  assert.match(rules, /goexample:sli:availability_ratio5m/);
  assert.match(rules, /goexample:sli:admission_rejection_rate5m/);
  assert.match(rules, /goexample:sli:draining_rejection_rate5m/);
  assert.match(rules, /goexample:http_server_connection_utilization_ratio/);
  assert.match(rules, /GoExampleHTTPConnectionSaturation/);
  assert.match(rules, /goexample:sli:latency_p95_seconds5m/);
  assert.match(rules, /goexample:otel:trace_export_failure_rate5m/);
  assert.match(rules, /goexample:otel:trace_export_attempt_failure_rate5m/);
  assert.match(rules, /goexample:otel:trace_queue_drop_rate5m/);
  assert.match(rules, /goexample:otel:trace_processor_utilization_ratio/);
  assert.match(rules, /GoExampleTraceExportFailures/);
  assert.match(rules, /GoExampleTraceExportAttemptFailures/);
  assert.match(rules, /GoExampleTraceQueueDrops/);
  assert.match(rules, /GoExampleTraceProcessorSaturation/);
  assert.match(rules, /histogram_quantile\(0\.95/);
  assert.match(rules, /GoExampleAvailabilityBurnRateCritical/);
  assert.match(rules, /goexample:slo:availability_burn_rate1h > 14\.4/);
  assert.match(rules, /goexample:slo:availability_burn_rate5m > 14\.4/);
  assert.match(rules, /goexample:slo:availability_burn_rate6h > 6/);
  assert.match(rules, /goexample:slo:availability_burn_rate30m > 6/);
  assert.doesNotMatch(rules, /clamp_min/);
  assert.match(rules, /goexample_http_requests_total\{status!~"5\.\."\}/);
  assert.match(runbook, /99\.9%/);
  assert.match(runbook, /250ms/);
  assert.match(runbook, /goexample_http_admission_rejections_total/);
  assert.match(runbook, /goexample_http_server_connections/);
  assert.match(runbook, /does not yet run `promtool`/);
  assert.match(runbook, /real OpenTelemetry Collector/);
  assert.match(tracingProvider, /go\.opentelemetry\.io\/otel/);
  assert.match(tracingProvider, /NewBatchSpanProcessor/);
  assert.match(tracingProvider, /WithMaxQueueSize/);
  assert.match(tracingProvider, /WithExportTimeout/);
  assert.match(tracingProvider, /traceMetricsExporter/);
  assert.match(tracingProvider, /boundedBatchSpanProcessor/);
  assert.match(tracingProvider, /traceAttemptTransport/);
  assert.match(tracingProvider, /WithRetry\(traceExporterRetryConfig/);
  assert.match(tracingTests, /TestOTLPHTTPBatchExporterDoesNotBlockRequestAndFlushesOnShutdown/);
  assert.match(tracingTests, /TestBatchSpanProcessorDropsBurstWithoutBlockingWhenExporterIsStalled/);
  assert.match(tracingTests, /TestOTLPHTTPExporterMetricsRecordCollectorFailureAndRecovery/);
  assert.match(tracingTests, /TestOTLPHTTPExporterRecordsEachAttemptAndRecoversWithinOneBatch/);
  assert.match(tracingTests, /\/tenant\/v1\/traces/);
  assert.match(metrics, /goexample_otel_trace_export_batches_total/);
  assert.match(metrics, /goexample_otel_trace_export_spans_total/);
  assert.match(metrics, /goexample_otel_trace_export_attempts_total/);
  assert.match(metrics, /goexample_otel_trace_queue_dropped_spans_total/);
  assert.match(metrics, /goexample_otel_trace_processor_pending_spans/);
  assert.match(metrics, /goexample_otel_trace_processor_capacity_spans/);
  assert.match(metrics, /goexample_otel_trace_processor_high_watermark_spans/);
  assert.match(metrics, /goexample_http_server_connection_capacity/);
  assert.match(metrics, /goexample_http_server_connection_events_total/);
  assert.match(metrics, /func \(m \*Metrics\) ObserveHTTPConnectionState/);
  assert.match(metricsTests, /TestMetricsRecordsBoundedHTTPConnectionLifecycle/);
  assert.match(metricsTests, /TestMetricsRenderTraceExporterOutcomesWithFixedLabels/);
  assert.match(entrypoint, /Metrics:\s+metrics/);
  assert.match(entrypoint, /ConnectionObserver:\s+metrics/);
  assert.match(outboundClient, /trace\.WithSpanKind\(trace\.SpanKindClient\)/);
  assert.match(outboundClient, /MaxResponseHeaderBytes/);
  assert.match(outboundClient, /propagation\.TraceContext/);
  assert.doesNotMatch(outboundClient, /url\.full|request\.URL\.String/);
  assert.match(outboundTests, /TestClientCreatesLowSensitivitySpanAndPropagatesW3CContext/);
  assert.match(outboundTests, /TestClientRecordsTimeoutWithoutLeakingTransportError/);
  assert.match(outboundTests, /TestClientRecordsCallerCancellation/);
  assert.match(outboundTests, /TestClientEnforcesResponseHeaderLimit/);
  assert.match(outboundTests, /TestClientNormalizesCustomMethodInSpan/);
  assert.match(outboundTests, /TestClientSpanEndsWhenResponseBodyCloses/);
  assert.match(projectService, /project\.get/);
  assert.match(projectRouteTests, /TestProjectRouteCreatesChildApplicationSpan/);
  assert.match(exampleEnvironment, /OTEL_TRACES_EXPORTER=none/);
});

test('Framework SQL client keeps pool, transaction, timeout, recovery, and trace privacy contracts explicit', async () => {
  const [
    client,
    clientTests,
    postgresTests,
    goMod,
    goWorkflow,
    recoveryRunner,
    recoveryReport,
    packageDocument,
    readme,
    changelog,
    evidenceManifest,
  ] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sqlclient', 'postgres_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'go.mod'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'postgres-recovery-contract.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'postgres-recovery-report.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
  ]);

  assert.match(client, /type Config struct/);
  assert.match(client, /OperationTimeout\s+time\.Duration/);
  assert.match(client, /TransactionTimeout\s+time\.Duration/);
  assert.match(client, /TransactionMaxAttempts\s+int/);
  assert.match(client, /RetryInitialBackoff\s+time\.Duration/);
  assert.match(client, /RetryMaxBackoff\s+time\.Duration/);
  assert.match(client, /SetMaxOpenConns/);
  assert.match(client, /SetMaxIdleConns/);
  assert.match(client, /SetConnMaxLifetime/);
  assert.match(client, /SetConnMaxIdleTime/);
  assert.match(client, /func \(client \*Client\) Transaction/);
  assert.match(client, /func \(client \*Client\) RetryTransaction/);
  assert.match(client, /var ErrOptimisticConflict/);
  assert.match(client, /func \(client \*Client\) ExecVersioned/);
  assert.match(client, /func \(transaction \*Tx\) ExecVersioned/);
  assert.match(client, /affected == 0/);
  assert.match(client, /affected != 1/);
  assert.match(client, /case "40001", "40P01"/);
  assert.match(client, /jitteredBackoff/);
  assert.match(client, /waitForRetry/);
  assert.match(client, /databaseTx\.Rollback\(\)/);
  assert.match(client, /trace\.WithSpanKind\(trace\.SpanKindClient\)/);
  assert.match(client, /semconv\.DBSystemNamePostgreSQL/);
  assert.match(client, /goexample\.database\.result/);
  assert.doesNotMatch(client, /DBStatement|db\.query|server\.address|server\.port/);
  assert.match(clientTests, /TestNewValidatesAndAppliesFinitePoolConfiguration/);
  assert.match(clientTests, /TestPostgresOperationsAndTransactionCreateBoundedPrivateSpans/);
  assert.match(clientTests, /TestDatabaseFailuresTimeoutsAndNotFoundUseFixedTraceResults/);
  assert.match(clientTests, /TestQueryAlwaysClosesRowsAndPropagatesConsumerError/);
  assert.match(clientTests, /TestTransactionRollsBackOnErrorTimeoutAndPanic/);
  assert.match(clientTests, /TestRetryTransactionRetriesOnlySerializationAndDeadlockFailures/);
  assert.match(clientTests, /TestRetryTransactionRetriesCommitSerializationFailure/);
  assert.match(clientTests, /TestRetryTransactionStopsForNonRetryableLimitAndUnsafeRollback/);
  assert.match(clientTests, /TestRetryTransactionBackoffSharesTransactionDeadline/);
  assert.match(clientTests, /TestVersionedExecRequiresExactlyOneAffectedRow/);
  assert.match(clientTests, /len\(span\.Attributes\(\)\) != 3/);
  assert.match(postgresTests, /TestRealPostgresRetryTransactionSerializationConflict/);
  assert.match(postgresTests, /TestRealPostgresRetryTransactionDeadlock/);
  assert.match(postgresTests, /TestRealPostgresVersionedUpdateAllowsOneConcurrentWriter/);
  assert.match(postgresTests, /TestRealPostgresVersionedHTTPPrecondition/);
  assert.match(postgresTests, /TestRealPostgresLockWaitHonorsDeadlineAndRecovers/);
  assert.match(postgresTests, /POSTGRES_TEST_URL/);
  assert.match(postgresTests, /sql\.LevelSerializable/);
  assert.match(postgresTests, /totalAttempts != 3 \|\| retriedWorkers != 1/);
  assert.match(postgresTests, /deadlock counter values/);
  assert.match(postgresTests, /successes != 1 \|\| conflicts != 1/);
  assert.match(postgresTests, /version != 1/);
  assert.match(postgresTests, /httpapi\.ErrPreconditionFailed/);
  assert.match(postgresTests, /http\.StatusPreconditionFailed/);
  assert.match(postgresTests, /FOR UPDATE/);
  assert.match(postgresTests, /context\.DeadlineExceeded/);
  assert.match(postgresTests, /github\.com\/jackc\/pgx\/v5\/stdlib/);
  assert.match(goMod, /github\.com\/jackc\/pgx\/v5 v5\.7\.6/);
  assert.match(goWorkflow, /postgres-contract:/);
  assert.match(goWorkflow, /node scripts\/postgres-recovery-contract\.mjs/);
  assert.match(goWorkflow, /postgres-recovery-contract\/manifest\.json/);
  assert.match(goWorkflow, /postgres-recovery-contract-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.equal(
    JSON.parse(packageDocument).scripts['postgres:recovery:contract'],
    'node scripts/postgres-recovery-contract.mjs',
  );
  assert.match(recoveryRunner, /postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5/);
  assert.match(recoveryRunner, /-run', '\^TestRealPostgres'/);
  assert.match(recoveryRunner, /pg_dump/);
  assert.match(recoveryRunner, /--format=custom/);
  assert.match(recoveryRunner, /pg_restore/);
  assert.match(recoveryRunner, /--single-transaction/);
  assert.match(recoveryRunner, /sourceAfterBackup/);
  assert.match(recoveryRunner, /SHA256SUMS/);
  assert.match(recoveryReport, /restored data must exactly match the backup checkpoint/);
  assert.match(recoveryReport, /backup archive size or SHA-256/);
  assert.match(recoveryReport, /PITR, replication, failover/);
  assert.match(readme, /## 关系数据库/);
  assert.match(readme, /不等于远端 job 已成功/);
  assert.match(readme, /callback 可能执行多次/);
  assert.match(readme, /不能依赖该方法提供 exactly-once/);
  assert.match(readme, /ErrOptimisticConflict/);
  assert.match(readme, /httpapi\.ErrPreconditionFailed/);
  assert.match(readme, /`If-Match`\/412\/`ETag`/);
  assert.match(changelog, /Bounded `database\/sql` PostgreSQL pool adapter/);
  assert.match(changelog, /Typed versioned JSON command adapters/);
  assert.match(evidenceManifest, /Framework\/sqlclient\/client\.go/);
  assert.match(evidenceManifest, /Framework\/sqlclient\/client_test\.go/);
  assert.match(evidenceManifest, /Framework\/sqlclient\/postgres_integration_test\.go/);
  assert.match(evidenceManifest, /Framework\/httpapi\/application_precondition\.go/);
  assert.match(evidenceManifest, /Framework\/httpapi\/idempotency_fingerprint\.go/);
  assert.match(evidenceManifest, /requiredPostgresRecoveryArtifacts/);
  assert.match(evidenceManifest, /postgresRecoveryStatus/);
  assert.match(evidenceManifest, /\.github\/workflows\/go-quality\.yml/);
});

test('Framework queue client keeps bounded W3C messaging spans broker-neutral and private', async () => {
  const [client, clientTests, worker, workerTests, natsTests, jetStreamAdapter, jetStreamAdapterTests, jetStreamIntegrationTests, jetStreamRestartTests, jetStreamSnapshotTests, jetStreamClusterTests, goMod, goWorkflow, readme, changelog, evidenceManifest, rules, sloRunbook] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'worker.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'worker_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'nats_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'adapter.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'adapter_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'restart_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'snapshot_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'queueclient', 'natsjetstream', 'cluster_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'go.mod'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'prometheus', 'rules', 'goexample-slo.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'observability', 'SLO-and-alerts.md'), 'utf8'),
  ]);

  assert.match(client, /type System string/);
  assert.match(client, /SystemKafka\s+System = "kafka"/);
  assert.match(client, /PublishTimeout\s+time\.Duration/);
  assert.match(client, /ProcessTimeout\s+time\.Duration/);
  assert.match(client, /MaxMessageBytes\s+int/);
  assert.match(client, /MaxHeaderBytes\s+int/);
  assert.match(client, /MaxHeaders\s+int/);
  assert.match(client, /ErrMessageTooLarge = errors\.New/);
  assert.match(client, /ErrHeadersTooLarge = errors\.New/);
  assert.match(client, /ErrInvalidHeader = errors\.New/);
  assert.match(client, /propagation\.TraceContext\{\}\.Inject/);
  assert.match(client, /propagation\.TraceContext\{\}\.Extract/);
  assert.match(client, /trace\.SpanKindProducer/);
  assert.match(client, /trace\.SpanKindConsumer/);
  assert.match(client, /messaging\.system\.name/);
  assert.match(client, /messaging\.operation\.type/);
  assert.match(client, /goexample\.messaging\.result/);
  assert.doesNotMatch(client, /messaging\.destination|messaging\.message\.id|span\.RecordError/);
  assert.match(clientTests, /TestPublishClonesMessageAndInjectsCurrentTraceContext/);
  assert.match(clientTests, /TestProcessExtractsRemoteTraceContextAndClonesMessage/);
  assert.match(clientTests, /TestFailuresTimeoutsAndCancellationUseFixedPrivateResults/);
  assert.match(clientTests, /TestMessageLimitsRejectBeforeBrokerOrHandlerExecution/);
  assert.match(clientTests, /TestPublishCountsInjectedTraceHeadersAgainstConfiguredLimits/);
  assert.match(clientTests, /TestCallbackPanicEndsSpanAndIsRethrown/);
  assert.match(clientTests, /baggage\.FromContext\(handlerContext\)\.Len\(\) != 0/);
  assert.match(worker, /type ReceiveFunc func\(context\.Context\) \(Message, error\)/);
  assert.match(worker, /type WorkerConfig struct/);
  assert.match(worker, /type WorkerObserver interface/);
  assert.match(worker, /Observer\s+WorkerObserver/);
  assert.match(worker, /type Delivery struct/);
  assert.match(worker, /ExtendLease\s+func\(context\.Context\) error/);
  assert.match(worker, /Acknowledge\s+func\(context\.Context\) error/);
  assert.match(worker, /DeadLetter\s+func\(context\.Context\) error/);
  assert.match(worker, /type ReceiveDeliveryFunc func/);
  assert.match(worker, /type DeliveryRetryConfig struct/);
  assert.match(worker, /MaxAttempts\s+int/);
  assert.match(worker, /SettlementTimeout\s+time\.Duration/);
  assert.match(worker, /LeaseExtensionInterval\s+time\.Duration/);
  assert.match(worker, /LeaseExtensionTimeout\s+time\.Duration/);
  assert.match(worker, /type DeliveryObserver interface/);
  assert.match(worker, /type DeliveryLeaseObserver interface/);
  assert.match(worker, /ReceiveDelivery\s+ReceiveDeliveryFunc/);
  assert.match(worker, /DeliveryObserver\s+DeliveryObserver/);
  assert.match(worker, /LeaseObserver\s+DeliveryLeaseObserver/);
  assert.match(worker, /maximumDeliveryMaxAttempts\s+=\s+10/);
  assert.match(worker, /ErrDeliveryNotRetryable/);
  assert.match(worker, /ErrDeliverySettlement/);
  assert.match(worker, /ErrDeliveryLeaseExtension/);
  assert.match(worker, /func \(group \*WorkerGroup\) extendDeliveryLease/);
  assert.match(worker, /func callDeliveryLeaseExtension/);
  assert.match(worker, /func deliveryBackoff/);
  assert.match(worker, /func \(client \*Client\) MinimumDeliveryLease/);
  assert.match(worker, /addDeliveryBudget/);
  assert.match(worker, /maxWorkerCount\s*=\s*64/);
  assert.match(worker, /func NewWorkerGroup/);
  assert.match(worker, /func \(group \*WorkerGroup\) Start/);
  assert.match(worker, /func \(group \*WorkerGroup\) Shutdown/);
  assert.match(worker, /func \(group \*WorkerGroup\) Wait/);
  assert.match(worker, /ErrWorkerPanic/);
  assert.match(worker, /ReceiveDelivery mode adds bounded in-process retry/);
  assert.match(workerTests, /TestWorkerGroupCancellationStopsAndWaits/);
  assert.match(workerTests, /TestWorkerGroupKeepsHandlerConcurrencyBounded/);
  assert.match(workerTests, /TestWorkerGroupStopsOnReceiveOrHandlerFailure/);
  assert.match(workerTests, /TestWorkerGroupConvertsCallbackPanicsToPrivateError/);
  assert.match(workerTests, /TestWorkerGroupReportsFixedLifecycleEventsAndIsolatesObserverPanic/);
  assert.match(workerTests, /TestWorkerGroupWaitIncludesStoppedObservation/);
  assert.match(workerTests, /TestWorkerGroupRetriesAndAcknowledgesReliableDelivery/);
  assert.match(workerTests, /TestWorkerGroupDeadLettersExhaustedAndPermanentDeliveries/);
  assert.match(workerTests, /TestWorkerGroupBoundsAndRedactsDeliverySettlementFailure/);
  assert.match(workerTests, /TestWorkerGroupExtendsLeaseUntilSettlement/);
  assert.match(workerTests, /TestWorkerGroupBoundsAndRedactsLeaseExtensionFailure/);
  assert.match(workerTests, /TestWorkerGroupCancellationDuringRetryDoesNotSettleDelivery/);
  assert.match(workerTests, /TestWorkerGroupCancellationDuringSettlementIsANormalStop/);
  assert.match(workerTests, /TestWorkerGroupRejectsInvalidDeliveryAndIsolatesDeliveryObserverPanic/);
  assert.match(workerTests, /TestMinimumDeliveryLeaseUsesEffectiveRetryBudget/);
  assert.match(workerTests, /TestMinimumDeliveryLeaseRejectsInvalidAndOverflowingBudgets/);
  assert.match(natsTests, /TestRealNATSPublishProcessTracePropagation/);
  assert.match(natsTests, /NATS_TEST_URL/);
  assert.match(natsTests, /connection\.SubscribeSync/);
  assert.match(natsTests, /connection\.PublishMsg/);
  assert.match(natsTests, /connection\.FlushWithContext/);
  assert.match(natsTests, /consumerSpan\.Parent\(\)\.SpanID\(\) != producerSpan\.SpanContext\(\)\.SpanID\(\)/);
  assert.match(natsTests, /assertSpanExcludes/);
  assert.match(jetStreamAdapter, /type Publisher interface/);
  assert.match(jetStreamAdapter, /type Consumer interface/);
  assert.match(jetStreamAdapter, /type Config struct/);
  assert.match(jetStreamAdapter, /type ConsumerInspector interface/);
  assert.match(jetStreamAdapter, /func PreflightConsumer/);
  assert.match(jetStreamAdapter, /info\.Config\.BackOff/);
  assert.match(jetStreamAdapter, /ErrAckWaitTooShort = errors\.New/);
  assert.match(jetStreamAdapter, /DeadLetterSubject\s+string/);
  assert.match(jetStreamAdapter, /FetchMaxWait\s+time\.Duration/);
  assert.match(jetStreamAdapter, /func New\(publisher Publisher, consumer Consumer/);
  assert.match(jetStreamAdapter, /func \(adapter \*Adapter\) Publish/);
  assert.match(jetStreamAdapter, /func \(adapter \*Adapter\) ReceiveDelivery/);
  assert.match(jetStreamAdapter, /brokerMessage\.DoubleAck\(settlementContext\)/);
  assert.match(jetStreamAdapter, /brokerMessage\.InProgress\(\)/);
  assert.match(jetStreamAdapter, /source\.DoubleAck\(ctx\)/);
  assert.match(jetStreamAdapter, /Header\.Set\(jetstream\.MsgIDHeader, deadLetterID\(metadata\)\)/);
  assert.match(jetStreamAdapter, /jetStreamControlHeader/);
  assert.match(jetStreamAdapter, /ErrDeadLetter = errors\.New/);
  assert.match(jetStreamAdapter, /ErrLeaseExtension = errors\.New/);
  assert.doesNotMatch(jetStreamAdapter, /fmt\.Errorf|slog\.|RecordError/);
  assert.match(jetStreamAdapterTests, /TestAdapterDeadLetterIsPublishBeforeAckAndDedupeStable/);
  assert.match(jetStreamAdapterTests, /TestAdapterErrorsAreFixedAndInvalidHeadersFailClosed/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerUsesServerAckWaitAndBackoff/);
  assert.match(jetStreamAdapterTests, /TestPreflightConsumerRejectsInvalidOrUnavailableConfiguration/);
  assert.match(jetStreamIntegrationTests, /TestRealNATSJetStreamDurableDelivery/);
  assert.match(jetStreamIntegrationTests, /jetstream\.FileStorage/);
  assert.match(jetStreamIntegrationTests, /metadata\.NumDelivered < 2/);
  assert.match(jetStreamIntegrationTests, /queueclient\.NewWorkerGroup/);
  assert.match(jetStreamIntegrationTests, /contractExtendedAckWait\s+=\s+800 \* time\.Millisecond/);
  assert.match(jetStreamIntegrationTests, /contractExtendedHandling\s+=\s+1500 \* time\.Millisecond/);
  assert.match(jetStreamIntegrationTests, /extensionObserver\.extended\.Load\(\) < 5/);
  assert.match(jetStreamIntegrationTests, /goexample-dlq-/);
  assert.match(jetStreamRestartTests, /TestRealNATSJetStreamRestartRecovery/);
  assert.match(jetStreamRestartTests, /NATS_SERVER_BINARY/);
  assert.match(jetStreamRestartTests, /Process\.Kill\(\)/);
  assert.match(jetStreamRestartTests, /persisted source messages/);
  assert.match(jetStreamRestartTests, /restart-report\.json/);
  assert.match(jetStreamRestartTests, /redeliveryMetadata\.Sequence\.Stream != firstMetadata\.Sequence\.Stream/);
  assert.match(jetStreamRestartTests, /DeliveryCountBeforeRestart/);
  assert.match(jetStreamRestartTests, /DeliveryCountAfterRestart/);
  assert.match(jetStreamRestartTests, /ShortLeaseRejected/);
  assert.match(jetStreamRestartTests, /RequiredLeaseNanos/);
  assert.match(jetStreamSnapshotTests, /TestRealNATSJetStreamSnapshotRestoreRecovery/);
  assert.match(jetStreamSnapshotTests, /NATS_SNAPSHOT_EVIDENCE_DIR/);
  assert.match(jetStreamSnapshotTests, /\$JS\.API\.STREAM\.SNAPSHOT/);
  assert.match(jetStreamSnapshotTests, /\$JS\.API\.STREAM\.RESTORE/);
  assert.match(jetStreamSnapshotTests, /CheckMessages:\s+true/);
  assert.match(jetStreamSnapshotTests, /tamperedSnapshotRejected/);
  assert.match(jetStreamSnapshotTests, /recoveredMetadata\.Sequence\.Stream != unacknowledgedMetadata\.Sequence\.Stream/);
  assert.match(jetStreamSnapshotTests, /restoreElapsed > snapshotRestoreBudget/);
  assert.match(jetStreamSnapshotTests, /snapshot-restore-report\.json/);
  assert.match(jetStreamClusterTests, /TestRealNATSJetStreamClusterLeaderFailover/);
  assert.match(jetStreamClusterTests, /NATS_CLUSTER_EVIDENCE_DIR/);
  assert.match(jetStreamClusterTests, /os\.Remove\(reportPath\)/);
  assert.match(jetStreamClusterTests, /Replicas:\s+3/);
  assert.match(jetStreamClusterTests, /Process\.Kill\(\)/);
  assert.match(jetStreamClusterTests, /waitClusterConnectionRecovered/);
  assert.match(jetStreamClusterTests, /openExistingClusterStream/);
  assert.match(jetStreamClusterTests, /openExistingClusterConsumer/);
  assert.match(jetStreamClusterTests, /waitClusterStreamLeaderChange/);
  assert.match(jetStreamClusterTests, /waitClusterStreamHandleAvailable/);
  assert.match(jetStreamClusterTests, /nats\.DisconnectErrHandler/);
  assert.match(jetStreamClusterTests, /nats\.ReconnectHandler/);
  assert.match(jetStreamClusterTests, /nats\.ClosedHandler/);
  assert.match(jetStreamClusterTests, /oldLeader != newLeader/);
  assert.match(jetStreamClusterTests, /redeliveryMetadata\.Sequence\.Stream != firstMetadata\.Sequence\.Stream/);
  assert.match(jetStreamClusterTests, /cluster-failover-report\.json/);
  assert.match(jetStreamClusterTests, /PublishedAfterFailover/);
  assert.match(jetStreamClusterTests, /LeasePreflightPassed/);
  assert.match(jetStreamClusterTests, /WorkerAckWaitNanos/);
  assert.match(jetStreamClusterTests, /SameConnectionSession/);
  assert.match(jetStreamClusterTests, /ConnectionServerBefore/);
  assert.match(jetStreamClusterTests, /AdapterSessionRecovered/);
  assert.match(jetStreamClusterTests, /SchemaVersion:\s+6/);
  assert.match(jetStreamClusterTests, /AbruptLeaderStops:\s+3/);
  assert.match(jetStreamClusterTests, /servers\[oldLeader\] = startClusterServer\(t, serverConfigs\[oldLeader\]\)/);
  assert.equal((jetStreamClusterTests.match(/waitClusterStreamReady\(t, testContext, (?:source|dlq), 3\)/g) ?? []).length, 15);
  assert.equal((jetStreamClusterTests.match(/waitClusterConsumerReady\(t, testContext, (?:sourceConsumer|dlqConsumer), 3\)/g) ?? []).length, 16);
  assert.match(jetStreamClusterTests, /waitClusterConnectionAvailable/);
  assert.match(jetStreamClusterTests, /SecondRecoveredSequence/);
  assert.match(jetStreamClusterTests, /SecondDeliveryBefore/);
  assert.match(jetStreamClusterTests, /SecondDeliveryAfter/);
  assert.match(jetStreamClusterTests, /SecondLeasePreflight/);
  assert.match(jetStreamClusterTests, /SameSessionAfterSecond/);
  assert.match(jetStreamClusterTests, /AdapterRecoveredSecond/);
  assert.match(jetStreamClusterTests, /waitClusterStreamQuorumRecovered/);
  assert.match(jetStreamClusterTests, /must-not-commit-without-quorum/);
  assert.match(jetStreamClusterTests, /errors\.Is\(quorumPublishError, ErrPublish\)/);
  assert.match(jetStreamClusterTests, /quorumFailureBudget = 3 \* time\.Second/);
  assert.match(jetStreamClusterTests, /servers\[quorumOldLeader\] = startClusterServer\(t, serverConfigs\[quorumOldLeader\]\)/);
  assert.match(jetStreamClusterTests, /servers\[secondOldLeader\] = startClusterServer\(t, serverConfigs\[secondOldLeader\]\)/);
  assert.match(jetStreamClusterTests, /QuorumRecoveredSequence/);
  assert.match(jetStreamClusterTests, /SameSessionAfterQuorumRecovery/);
  assert.match(jetStreamClusterTests, /FinalReplicaRecoveryPassed/);
  assert.match(jetStreamClusterTests, /stopClusterServersConcurrently/);
  assert.match(jetStreamClusterTests, /ready\.Wait\(\)/);
  assert.match(jetStreamClusterTests, /close\(release\)/);
  assert.match(jetStreamClusterTests, /concurrentStopSkewBudget = 250 \* time\.Millisecond/);
  assert.match(jetStreamClusterTests, /must-not-commit-during-concurrent-failure/);
  assert.match(jetStreamClusterTests, /ConcurrentRecoveredSequence/);
  assert.match(jetStreamClusterTests, /ConcurrentReplicaRecoveryPassed/);
  assert.match(jetStreamClusterTests, /--cluster_advertise/);
  assert.match(jetStreamClusterTests, /disableClusterRouteProxies/);
  assert.match(jetStreamClusterTests, /verifyClusterCoreServersAvailable/);
  assert.match(jetStreamClusterTests, /networkPartitionLeader == networkPartitionConnectionServer/);
  assert.match(jetStreamClusterTests, /must-not-commit-during-network-partition/);
  assert.match(jetStreamClusterTests, /partitionRecoveredInfo\.State\.Msgs != 11/);
  assert.match(jetStreamClusterTests, /PartitionRecoveredSequence/);
  assert.match(jetStreamClusterTests, /PartitionReplicaRecoveryPassed/);
  assert.match(jetStreamClusterTests, /UpdateConsumer\(attemptContext, streamName, config\)/);
  assert.match(jetStreamClusterTests, /PreflightConsumer\(\s+attemptContext,/);
  assert.match(goMod, /github\.com\/nats-io\/nats\.go v1\.53\.1/);
  assert.match(goWorkflow, /nats-contract:/);
  assert.match(goWorkflow, /nats:2\.14\.5-alpine@sha256:d4ac35882ac65aff236cd65b9d3fa4d24332c681e1a85f94eedccd3cdd65b1da/);
  assert.match(goWorkflow, /NATS_TEST_URL:/);
  assert.match(goWorkflow, /NATS_SERVER_BINARY:/);
  assert.match(goWorkflow, /NATS_RESTART_EVIDENCE_DIR:/);
  assert.match(goWorkflow, /NATS_SNAPSHOT_EVIDENCE_DIR:/);
  assert.match(goWorkflow, /NATS_CLUSTER_EVIDENCE_DIR:/);
  assert.match(goWorkflow, /-run '\^TestRealNATS'/);
  assert.match(goWorkflow, /docker run.*goexample-nats-contract.*-js.*-sd \/data/s);
  assert.match(goWorkflow, /docker cp goexample-nats-contract:\/nats-server/);
  assert.match(goWorkflow, /nats-server-binary\.sha256/);
  assert.match(goWorkflow, /find "\$\{artifact_dir\}" -type f/);
  assert.match(goWorkflow, /\.\/queueclient\/\.\.\./);
  assert.match(goWorkflow, /nats-server\.log/);
  assert.match(goWorkflow, /nats-server-inspect\.json/);
  assert.match(goWorkflow, /workflow-artifacts\/nats-contract/);
  assert.match(goWorkflow, /nats-contract-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(readme, /## 消息队列/);
  assert.match(readme, /不等于远端 job 已成功/);
  assert.match(readme, /Core NATS 不提供/);
  assert.match(readme, /`queueclient\/natsjetstream`/);
  assert.match(readme, /NumDelivered/);
  assert.match(changelog, /Broker-neutral queue publish\/process instrumentation/);
  assert.match(changelog, /Optional fixed-cardinality `WorkerObserver` and `DeliveryObserver` callbacks/);
  const [metrics, metricsTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics_test.go'), 'utf8'),
  ]);
  assert.match(metrics, /goexample_queue_workers_active/);
  assert.match(metrics, /goexample_queue_worker_events_total/);
  assert.match(metrics, /goexample_queue_delivery_events_total/);
  assert.match(metrics, /goexample_queue_delivery_lease_events_total/);
  assert.match(metricsTests, /TestMetricsRecordsBoundedQueueWorkerLifecycle/);
  assert.match(rules, /GoExampleQueueDeliveryDeadLetters/);
  assert.match(rules, /GoExampleQueueSettlementFailures/);
  assert.match(rules, /GoExampleQueueLeaseExtensionFailures/);
  assert.match(sloRunbook, /acknowledged.*retried.*dead_lettered.*settlement_failed/);
  assert.match(sloRunbook, /lease events use only `extended` and `failure`/);
  assert.match(readme, /ReceiveDelivery/);
  assert.match(readme, /ErrDeliverySettlement/);
  assert.match(readme, /ErrDeliveryLeaseExtension/);
  assert.match(changelog, /opt-in mutually exclusive delivery mode/);
  assert.match(changelog, /Opt-in Core NATS integration contract/);
  assert.match(changelog, /NATS JetStream adapter/);
  assert.match(evidenceManifest, /Framework\/queueclient\/client\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/client_test\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/worker\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/worker_test\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/nats_integration_test\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/natsjetstream\/adapter\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/natsjetstream\/adapter_test\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/natsjetstream\/integration_test\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/natsjetstream\/restart_integration_test\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/natsjetstream\/snapshot_integration_test\.go/);
  assert.match(evidenceManifest, /Framework\/queueclient\/natsjetstream\/cluster_integration_test\.go/);
  assert.match(evidenceManifest, /report\.workerAckWaitNanos >= report\.requiredLeaseNanos/);
  assert.match(evidenceManifest, /natsBroker/);
  assert.match(evidenceManifest, /natsRestartArtifactRoot/);
  assert.match(evidenceManifest, /requiredNatsRestartArtifacts/);
  assert.match(evidenceManifest, /localNatsRestartStatus/);
  assert.match(evidenceManifest, /localNatsRestart/);
  assert.match(evidenceManifest, /natsSnapshotArtifactRoot/);
  assert.match(evidenceManifest, /requiredNatsSnapshotArtifacts/);
  assert.match(evidenceManifest, /localNatsSnapshotRestoreStatus/);
  assert.match(evidenceManifest, /localNatsSnapshotRestore/);
  assert.match(evidenceManifest, /report\.restoreElapsedNanos <= report\.restoreBudgetNanos/);
  assert.match(evidenceManifest, /natsClusterArtifactRoot/);
  assert.match(evidenceManifest, /requiredNatsClusterArtifacts/);
  assert.match(evidenceManifest, /localNatsClusterFailoverStatus/);
  assert.match(evidenceManifest, /localNatsClusterFailover/);
  assert.match(evidenceManifest, /streamLeaderMarker/);
  assert.match(evidenceManifest, /report\?\.schemaVersion === 6/);
  assert.match(evidenceManifest, /report\?\.abruptLeaderStops === 3/);
  assert.match(evidenceManifest, /report\?\.restartedServers === 3/);
  assert.match(evidenceManifest, /report\?\.replicaRecoveryPassed === true/);
  assert.match(evidenceManifest, /report\?\.secondOldLeader === report\.newLeader/);
  assert.match(evidenceManifest, /report\?\.persistedAfterSecondFailover === 6/);
  assert.match(evidenceManifest, /report\?\.secondRecoveredStreamSequence === 5/);
  assert.match(evidenceManifest, /report\?\.sameConnectionSessionAfterSecondFailover === true/);
  assert.match(evidenceManifest, /report\?\.overlappingOfflineServers === 2/);
  assert.match(evidenceManifest, /report\?\.quorumUnavailableObserved === true/);
  assert.match(evidenceManifest, /report\.quorumFailureElapsedNanos <= report\.quorumFailureBudgetNanos/);
  assert.match(evidenceManifest, /report\?\.quorumRecoveredStreamSequence === 7/);
  assert.match(evidenceManifest, /report\?\.persistedAfterQuorumRecovery === 8/);
  assert.match(evidenceManifest, /report\?\.sameConnectionSessionAfterQuorumRecovery === true/);
  assert.match(evidenceManifest, /report\?\.finalReplicaRecoveryPassed === true/);
  assert.match(evidenceManifest, /report\?\.concurrentFaultInjected === true/);
  assert.match(evidenceManifest, /report\?\.concurrentStoppedServers === 2/);
  assert.match(evidenceManifest, /report\.concurrentStopSkewNanos <= report\.concurrentStopSkewBudgetNanos/);
  assert.match(evidenceManifest, /report\?\.concurrentRecoveredStreamSequence === 9/);
  assert.match(evidenceManifest, /report\?\.persistedAfterConcurrentRecovery === 10/);
  assert.match(evidenceManifest, /report\?\.sameConnectionSessionAfterConcurrentRecovery === true/);
  assert.match(evidenceManifest, /report\?\.concurrentReplicaRecoveryPassed === true/);
  assert.match(evidenceManifest, /report\?\.networkPartitionInjected === true/);
  assert.match(evidenceManifest, /report\?\.networkPartitionedServers === 3/);
  assert.match(evidenceManifest, /report\.networkPartitionLeader !== report\.networkPartitionConnectionServer/);
  assert.match(evidenceManifest, /report\.routeProxyConnectionsBefore >= 3/);
  assert.match(evidenceManifest, /report\.routeProxyConnectionsClosed >= 3/);
  assert.match(evidenceManifest, /report\.partitionFailureElapsedNanos <= report\.partitionFailureBudgetNanos/);
  assert.match(evidenceManifest, /report\?\.partitionRecoveredStreamSequence === 11/);
  assert.match(evidenceManifest, /report\?\.persistedAfterPartitionRecovery === 12/);
  assert.match(evidenceManifest, /report\?\.sameConnectionSessionAfterPartitionRecovery === true/);
  assert.match(evidenceManifest, /report\?\.partitionReplicaRecoveryPassed === true/);
  assert.match(evidenceManifest, /totalServerStarts === 8/);
  assert.match(evidenceManifest, /Starting nats-server/);
});

test('external OIDC/JWKS bearer verification stays bounded and separate from demo login', async () => {
  const [authService, verifier, verifierTests, oidcFlow, oidcFlowTests, authorizationRequestStore, authorizationRequestStoreTests, oidcClient, oidcClientTests, oidcCallback, oidcCallbackTests, oidcBrowser, oidcBrowserTests, session, sessionTests, sessionStore, sessionStoreTests, browserSession, browserSessionTests, browserSessionStore, browserSessionStoreTests, app, authRoutes, middleware, httpTests, config, configTests, entrypoint, entrypointTests, projectRoutes, exampleEnvironment, template, readme, changelog, evidenceManifest] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'jwks.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'jwks_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_flow.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_flow_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'authorization_request_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'authorization_request_store_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_client.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_client_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_callback.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'oidc_callback_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'oidc_browser.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'oidc_browser_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'session.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'session_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'session_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'session_store_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'browser_session.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'auth', 'browser_session_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'browser_session_store.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'browser_session_store_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes_auth.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'auth_middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'token_verifier_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'internal', 'projectapi', 'routes.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'kubernetes', 'goexample-api.template.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
  ]);

  assert.match(authService, /type TokenVerifier interface/);
  assert.match(authService, /VerifyToken\(context\.Context, string\) \(Claims, error\)/);
  assert.match(verifier, /jwt\.SigningMethodRS256/);
  assert.match(verifier, /minRSAKeyBits\s*=\s*2048/);
  assert.match(verifier, /maxRSAKeyBits\s*=\s*8192/);
  assert.match(verifier, /maxAccessTokenBytes\s*=\s*16 << 10/);
  assert.match(verifier, /maxJWKSResponseBytes\s*=\s*1 << 20/);
  assert.match(verifier, /maxJWKSKeys\s*=\s*100/);
  assert.match(verifier, /unknownKeyRefreshInterval\s*=\s*5 \* time\.Second/);
  assert.match(verifier, /refreshMu\s+sync\.Mutex/);
  assert.match(verifier, /io\.LimitReader\(response\.Body, maxJWKSResponseBytes\+1\)/);
  assert.match(verifier, /jwt\.WithIssuer\(verifier\.issuer\)/);
  assert.match(verifier, /jwt\.WithAudience\(verifier\.audience\)/);
  assert.match(verifier, /jwt\.WithExpirationRequired\(\)/);
  assert.match(verifier, /jwt\.WithNotBeforeRequired\(\)/);
  assert.match(verifier, /func \(verifier \*JWKSVerifier\) VerifyIDToken/);
  assert.match(verifier, /validIDTokenClaims/);
	assert.match(verifier, /validIDTokenAssurance/);
	assert.match(verifier, /requiredACR == "" && len\(requiredAMR\) == 0/);
	assert.match(verifier, /claims\.AuthTime == nil/);
	assert.match(verifier, /len\(actualAMR\) > maxOIDCAssuranceValues/);
	assert.match(verifier, /requiredACR != "" && actualACR != requiredACR/);
  assert.match(verifier, /claims\.Azp != audience/);
  assert.doesNotMatch(verifier, /RecordError|response\.Request|response\.Body\.String/);
  assert.match(verifierTests, /TestJWKSVerifierValidatesRS256ClaimsAndRefreshesRotatedKey/);
  assert.match(verifierTests, /TestJWKSVerifierCollapsesUnknownKeyRefreshes/);
  assert.match(verifierTests, /TestJWKSVerifierFailsClosedOnExpiredCacheAndCanceledRefresh/);
  assert.match(verifierTests, /TestJWKSVerifierValidatesIDTokenNonceAudienceAndAge/);
	assert.match(verifierTests, /TestJWKSVerifierEnforcesIDTokenAssurancePolicy/);
  assert.match(verifierTests, /TestNewJWKSVerifierRejectsUnsafeConfigurationAndDocuments/);
  assert.match(session, /type SessionConfig struct/);
  assert.match(session, /type SessionStore interface/);
  assert.match(session, /Store\s+SessionStore/);
  assert.match(session, /type SessionManager struct/);
  assert.match(session, /RefreshTTL\s+time\.Duration/);
  assert.match(session, /AbsoluteTTL\s+time\.Duration/);
  assert.match(session, /MaxFamilies\s+int/);
  assert.match(session, /maxSessionTokensPerFamily\s*=\s*1024/);
  assert.match(session, /sha256\.Sum256\(\[\]byte\(rawToken\)\)/);
  assert.match(session, /family\.used\[tokenHash\]/);
  assert.match(session, /family\.revoked = true/);
  assert.match(session, /func \(manager \*SessionManager\) RevokeUser/);
  assert.match(session, /func \(manager \*SessionManager\) RevokeFamily/);
  assert.match(session, /func \(manager \*SessionManager\) ActiveFamilies/);
  assert.doesNotMatch(session, /rawToken\s+string\s+`/);
  assert.match(sessionTests, /TestSessionStartRotateAndReuseRevokesFamily/);
  assert.match(sessionTests, /TestSessionConcurrentRotationDetectsReuse/);
  assert.match(sessionTests, /TestSessionFamilyLimitAndInputValidation/);
  assert.match(sessionTests, /TestSessionRotationHistoryIsBounded/);
  assert.match(sessionStore, /rotateSessionScript/);
  assert.match(sessionStore, /hash-only|hash-only/i);
  assert.match(sessionStore, /var _ auth\.SessionStore = \(\*Redis\)\(nil\)/);
  assert.match(sessionStoreTests, /TestRedisSessionStoreRotatesAcrossClientsAndDetectsReuse/);
  assert.match(sessionStoreTests, /TestRedisSessionStoreCentralUserRevokeAndFamilyLimit/);
  assert.match(sessionStoreTests, /TestRedisSessionStoreFailsClosedWhenBackendStops/);
	assert.match(browserSession, /type BrowserSessionManager struct/);
	assert.match(browserSession, /type BrowserSessionStore interface/);
	assert.match(browserSession, /type BrowserSessionInventoryStore interface/);
	assert.match(browserSession, /type BrowserSessionMetadataStore interface/);
	assert.match(browserSession, /MaxSessionsPerSubject int/);
	assert.match(browserSession, /func \(manager \*BrowserSessionManager\) ListForSubject/);
	assert.match(browserSession, /func \(manager \*BrowserSessionManager\) RevokeForSubject/);
	assert.match(browserSession, /func \(manager \*BrowserSessionManager\) RevokeAllForSubject/);
	assert.match(browserSession, /func \(manager \*BrowserSessionManager\) SetDeviceNameForSubject/);
	assert.match(browserSession, /sha256\.Sum256\(\[\]byte\(sessionToken\)\)/);
	assert.match(browserSession, /expiresAt\.After\(claims\.ExpiresAt\.Time\)/);
	assert.match(browserSession, /subtle\.ConstantTimeCompare/);
	assert.match(browserSessionTests, /TestBrowserSessionCapsLifetimeBindsCSRFAndCopiesClaims/);
	assert.match(browserSessionTests, /TestBrowserSessionStoreSharesHashOnlyStateAcrossManagers/);
	assert.match(browserSessionTests, /TestBrowserSessionInventoryEnforcesSubjectLimitAndScopesRevocation/);
	assert.match(browserSessionTests, /TestBrowserSessionLegacyStoreKeepsStartCompatibilityWithoutInventory/);
	assert.match(browserSessionTests, /TestBrowserSessionDeviceNameLocalUpdateClearAndValidation/);
	assert.match(browserSessionStore, /createBrowserSessionScript/);
	assert.match(browserSessionStore, /deleteBrowserSessionsForSubjectScript/);
	assert.match(browserSessionStore, /updateBrowserSessionDeviceNameScript/);
	assert.match(browserSessionStore, /var _ auth\.BrowserSessionStore = \(\*Redis\)\(nil\)/);
	assert.match(browserSessionStore, /var _ auth\.BrowserSessionInventoryStore = \(\*Redis\)\(nil\)/);
	assert.match(browserSessionStore, /var _ auth\.BrowserSessionMetadataStore = \(\*Redis\)\(nil\)/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionStoreSharesAndRevokesHashOnlySession/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionStoreEnforcesLimitExpiryAndOutage/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionInventoryCrossClientLimitsAndScopesRevocation/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionInventoryRejectsTamperAndOutage/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionSubjectLimitIsAtomicAcrossClients/);
	assert.match(browserSessionStoreTests, /TestRedisBrowserSessionDeviceNameUpdateIsAtomicAndPreservesSession/);

  assert.match(oidcFlow, /type AuthorizationRequestManager struct/);
	assert.match(oidcFlow, /type AuthorizationRequestStore interface/);
	assert.match(oidcFlow, /Store\s+AuthorizationRequestStore/);
	assert.match(oidcFlow, /code_challenge_method\", \"S256\"/);
	assert.match(oidcFlow, /query\.Set\("acr_values", strings\.Join\(config\.ACRValues, " "\)\)/);
	assert.match(oidcFlow, /func \(manager \*AuthorizationRequestManager\) Complete/);
	assert.match(oidcFlow, /func \(manager \*AuthorizationRequestManager\) StartContext/);
	assert.match(oidcFlow, /func \(manager \*AuthorizationRequestManager\) CompleteContext/);
	assert.match(oidcFlow, /pending map\[\[sha256\.Size\]byte\]AuthorizationRequestRecord/);
	assert.match(oidcFlow, /delete\(manager\.pending, stateHash\)/);
	assert.match(oidcFlow, /func ValidateAuthorizationNonce/);
	assert.match(oidcFlow, /subtle\.ConstantTimeCompare/);
	assert.match(oidcFlowTests, /TestAuthorizationRequestManagerBuildsSingleUsePKCERequest/);
	assert.match(oidcFlowTests, /TestAuthorizationRequestStoreSharesHashOnlyStateAcrossManagers/);
	assert.match(oidcFlowTests, /TestAuthorizationRequestManagerExpiresAndBoundsPendingState/);
	assert.match(oidcFlowTests, /TestNewAuthorizationRequestManagerRejectsUnsafeConfiguration/);
	assert.match(authorizationRequestStore, /createAuthorizationRequestScript/);
	assert.match(authorizationRequestStore, /consumeAuthorizationRequestScript/);
	assert.match(authorizationRequestStore, /var _ auth\.AuthorizationRequestStore = \(\*Redis\)\(nil\)/);
	assert.match(authorizationRequestStoreTests, /TestRedisAuthorizationRequestStoreConsumesAcrossClientsExactlyOnce/);
	assert.match(authorizationRequestStoreTests, /TestRedisAuthorizationRequestStoreEnforcesGlobalLimitExpiryTamperAndOutage/);

  assert.match(oidcClient, /type OIDCClient struct/);
  assert.match(oidcClient, /func NewOIDCClient/);
  assert.match(oidcClient, /func \(client \*OIDCClient\) ExchangeCode/);
  assert.match(oidcClient, /CheckRedirect/);
  assert.match(oidcClient, /maxOIDCMetadataBytes\s*=\s*64 << 10/);
  assert.match(oidcClient, /maxOIDCTokenResponseBytes\s*=\s*64 << 10/);
  assert.match(oidcClient, /code_challenge_methods_supported/);
  assert.match(oidcClientTests, /TestOIDCClientDiscoversAndExchangesAuthorizationCode/);
  assert.match(oidcClientTests, /TestNewOIDCClientRejectsUnsafeOrIncompleteDiscovery/);
  assert.match(oidcClientTests, /TestOIDCClientBoundsTokenExchangeAndStopsRedirects/);
  assert.match(oidcCallback, /func CompleteOIDCCallback/);
	assert.match(oidcCallback, /manager\.CompleteContext\(ctx, state, code\)/);
  assert.match(oidcCallback, /verifier\.VerifyIDToken\(ctx, tokens\.IDToken, authorization\.Nonce\)/);
  assert.match(oidcCallbackTests, /TestCompleteOIDCCallbackConsumesStateAndBindsIDTokenNonce/);
  assert.match(oidcCallbackTests, /TestCompleteOIDCCallbackFailsClosedAndDoesNotLeakProviderErrors/);

	assert.match(oidcBrowser, /type OIDCBrowser struct/);
	assert.match(oidcBrowser, /__Host-goexample-oidc-state/);
	assert.match(oidcBrowser, /Secure:\s+true/);
	assert.match(oidcBrowser, /HTTPOnly:\s+true/);
	assert.match(oidcBrowser, /CookieSameSiteLaxMode/);
	assert.match(oidcBrowser, /browser\.requests\.StartContext\(requestContext\)/);
	assert.match(oidcBrowser, /browser\.requests\.CompleteContext\(requestContext, state, code\)/);
	assert.match(oidcBrowser, /subtle\.ConstantTimeCompare/);
	assert.match(oidcBrowser, /VerifyIDToken/);
	assert.match(oidcBrowser, /sameOIDCSubject/);
	assert.match(oidcBrowser, /NewOIDCBrowserWithSessions/);
	assert.match(oidcBrowser, /__Host-goexample-session/);
	assert.match(oidcBrowser, /__Host-goexample-csrf/);
	assert.match(oidcBrowser, /browser\.sessions\.Start/);
	assert.match(oidcBrowser, /browser\.sessions\.End/);
	assert.match(oidcBrowser, /browser\.sessions\.ListForSubject/);
	assert.match(oidcBrowser, /browser\.sessions\.RevokeForSubject/);
	assert.match(oidcBrowser, /browser\.sessions\.RevokeAllForSubject/);
	assert.match(oidcBrowser, /browser\.sessions\.SetDeviceNameForSubject/);
	assert.match(oidcBrowser, /browserSessionDeviceNameRequest/);
	assert.match(oidcBrowser, /fiber\.StatusNotFound/);
	assert.match(oidcBrowser, /fiber\.StatusServiceUnavailable/);
	assert.doesNotMatch(oidcBrowser, /Logger\..*(?:state|code|token|cookie)|fiber\.Map.*(?:state|code|token|cookie)/i);
	assert.match(oidcBrowserTests, /TestOIDCBrowserCompletesStateCookieBoundCallbackOnce/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserSessionInventoryAndSubjectBoundRevocation/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserSessionDeviceNameRequiresCSRFAndScopesUpdates/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserSessionInventoryFailsClosedForLegacyStore/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserSessionInventoryCollapsesBackendOutage/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserRejectsMissingOrMismatchedCookieAndConsumesState/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserCollapsesProviderFailuresAndPrivateQueryValues/);
	assert.match(oidcBrowserTests, /TestOIDCBrowserRequiresExternalAuthenticationMode/);
	assert.match(oidcBrowserTests, /missing CSRF logout/);

  assert.match(app, /TokenVerifier\s+auth\.TokenVerifier/);
  assert.match(authRoutes, /if options\.Auth\.Enabled\(\)/);
  assert.match(middleware, /options\.TokenVerifier\.VerifyToken/);
	assert.match(middleware, /requireBrowserSession/);
	assert.match(middleware, /subtle\.ConstantTimeCompare/);
  assert.match(httpTests, /TestExternalTokenVerifierProtectsRoutesWithoutDemoLogin/);
  assert.match(httpTests, /StatusNotFound/);
  assert.match(httpTests, /TestExternalTokenVerifierFailureUsesPrivateBearerResponse/);
  assert.match(config, /DEMO_AUTH_ENABLED and OIDC_AUTH_ENABLED cannot both be true/);
  assert.match(config, /if cfg\.DemoAuthEnabled && len\(cfg\.JWTSecret\) < 32/);
  assert.match(config, /validateOIDCEndpoint\("OIDC_JWKS_URL"/);
	assert.match(config, /OIDC_BROWSER_ENABLED requires OIDC_AUTH_ENABLED=true/);
	assert.match(config, /validateOIDCRedirectURL/);
	assert.match(config, /production browser OIDC sessions require SHARED_STATE_MODE=external/);
	assert.match(config, /OIDC_BROWSER_MAX_SESSIONS must be between 1 and 10000/);
	assert.match(config, /OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT must be between 1 and OIDC_BROWSER_MAX_SESSIONS/);
	assert.match(config, /OIDC_REQUIRED_ACR/);
	assert.match(config, /OIDC_REQUIRED_AMR/);
	assert.match(config, /OIDC_MAX_AUTH_AGE/);
	assert.match(config, /OIDC assurance settings require OIDC_BROWSER_ENABLED=true/);
  assert.match(configTests, /TestLoadValidatesOIDCResourceServerConfiguration/);
	assert.match(configTests, /TestLoadValidatesOIDCBrowserAuthorizationConfiguration/);
  assert.match(configTests, /TestLoadDoesNotRequireInactiveDemoJWTSecret/);

  assert.match(entrypoint, /auth\.NewJWKSVerifier\(ctx, auth\.JWKSConfig/);
  assert.match(entrypoint, /authMode = "oidc"/);
  assert.match(entrypoint, /TokenVerifier:\s+tokenVerifier/);
	assert.match(entrypoint, /httpapi\.NewOIDCBrowserWithSessions\(oidcRequests, oidcClient, oidcVerifier, browserSessions\)/);
	assert.match(entrypoint, /authorizationRequestStore = externalState/);
	assert.match(entrypoint, /Store:\s+authorizationRequestStore/);
	assert.match(entrypoint, /ACRValues:\s+authorizationACRValues/);
	assert.match(entrypoint, /browserSessionStore = externalState/);
	assert.match(entrypoint, /MaxSessionsPerSubject:\s+cfg\.OIDCBrowserMaxSessionsPerSubject/);
	assert.match(entrypoint, /RequiredACR:\s+cfg\.OIDCRequiredACR/);
	assert.match(entrypoint, /RequiredAMR:\s+cfg\.OIDCRequiredAMR/);
	assert.match(entrypoint, /MaxAuthAge:\s+cfg\.OIDCMaxAuthAge/);
	assert.match(entrypoint, /OIDCBrowser:\s+oidcBrowser/);
  assert.match(entrypoint, /EndpointsForAuth\(tokenVerifier\.Enabled\(\), authService\.Enabled\(\)\)/);
  assert.match(entrypointTests, /TestRunFailsClosedWhenOIDCJWKSIsUnavailable/);
	assert.match(entrypointTests, /TestRunFailsClosedWhenOIDCBrowserDiscoveryIsUnavailable/);
  assert.match(entrypointTests, /TestRunServesAuthorizedProjectRouteWithOIDCJWKS/);
  assert.match(projectRoutes, /DefaultEndpointsForAuth\(authEnabled, demoLoginEnabled\)/);
	assert.match(exampleEnvironment, /OIDC_REQUIRED_ACR=/);
	assert.match(exampleEnvironment, /OIDC_REQUIRED_AMR=/);
	assert.match(exampleEnvironment, /OIDC_MAX_AUTH_AGE=0s/);
	assert.match(exampleEnvironment, /OIDC_BROWSER_MAX_SESSIONS_PER_SUBJECT=10/);
  assert.match(template, /"DEMO_AUTH_ENABLED": "false"/);
  assert.match(template, /"OIDC_AUTH_ENABLED": "true"/);
  assert.match(readme, /资源服务器基础/);
  assert.match(readme, /OIDC discovery\/token exchange/);
  assert.match(readme, /auth\.NewSessionManager/);
  assert.match(changelog, /Bounded RS256 JWKS verifier/);
  assert.match(changelog, /Bounded transport-neutral refresh session manager/);
  assert.match(evidenceManifest, /oidcProvider/);
  assert.match(evidenceManifest, /Framework\/auth\/oidc_client\.go/);
  assert.match(evidenceManifest, /Framework\/auth\/oidc_callback\.go/);
	assert.match(evidenceManifest, /Framework\/httpapi\/oidc_browser\.go/);
	assert.match(evidenceManifest, /Framework\/auth\/browser_session\.go/);
	assert.match(evidenceManifest, /Framework\/sharedstate\/browser_session_store\.go/);
});

test('server shared-state boundary keeps production fail-fast explicit', async () => {
  const [config, sharedState, redisState, redisTracing, redisTests, httpRedisTests, entrypoint, exampleEnvironment, middleware, fingerprint, response, appTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'shared_state.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_tracing.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'redis_shared_state_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'idempotency_fingerprint.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'response.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
  ]);

  assert.match(config, /SHARED_STATE_MODE/);
  assert.match(config, /ALLOW_IN_MEMORY_SHARED_STATE/);
  assert.match(config, /REDIS_LOCK_TTL must be greater than HTTP_REQUEST_TIMEOUT/);
  assert.match(config, /REDIS_LOCK_WAIT_TIMEOUT must be less than HTTP_REQUEST_TIMEOUT/);
  assert.match(config, /environment == 'production'|environment == "production"/);
  assert.match(sharedState, /external shared state requires a shared storage implementation/);
  assert.match(sharedState, /external shared state requires an atomic rate limiter implementation/);
  assert.match(sharedState, /external shared state requires a distributed idempotency lock/);
  assert.match(sharedState, /goexample:/);
  assert.match(redisState, /redis\.NewScript/);
  assert.match(redisState, /redis\.call\("INCR"/);
  assert.match(redisState, /redis\.call\("GET", KEYS\[1\]\) == ARGV\[1\]/);
  assert.match(redisState, /SetNX/);
  assert.match(redisState, /ContextTimeoutEnabled = true/);
  assert.match(redisState, /Scan\(operationCtx/);
  assert.doesNotMatch(redisState, /FlushDB|FlushAll/);
  assert.match(redisState, /newRedisTracingHook\(config\.TracerProvider\)/);
  assert.match(redisTracing, /goexample\.redis\.result/);
  assert.match(redisTracing, /semconv\.DBOperationBatchSize/);
  assert.match(redisTracing, /redis operation failed/);
  assert.doesNotMatch(redisTracing, /DBStatement|RecordError|cmd\.String|FullName|server\.address|server\.port/);
  assert.match(redisTests, /TestRedisCreatesLowSensitivityClientSpans/);
  assert.match(redisTests, /TestRedisFailureSpanDoesNotExposeBackendError/);
  assert.match(redisTests, /TestRedisLockOwnerCannotDeleteReplacementLease/);
  assert.match(redisTests, /REDIS_TEST_URL/);
  assert.match(httpRedisTests, /TestRedisRateLimitIsAtomicAcrossApplications/);
  assert.match(httpRedisTests, /TestRedisIdempotencyIsCoordinatedAcrossApplications/);
  assert.match(entrypoint, /ValidateSharedState/);
  assert.match(entrypoint, /sharedstate\.NewRedis/);
  assert.match(entrypoint, /healthChecker\.Register\("redis", externalState\.Check\)/);
  assert.match(exampleEnvironment, /SHARED_STATE_MODE=memory/);
  assert.match(exampleEnvironment, /ALLOW_IN_MEMORY_SHARED_STATE=false/);
  assert.match(exampleEnvironment, /REDIS_URL=/);
  assert.match(middleware, /idempotencyRequestFingerprint/);
  assert.match(middleware, /sharedstate\.AtomicRateLimiter/);
  assert.match(fingerprint, /errIdempotencyFingerprintConflict/);
  assert.match(fingerprint, /sha256\.New\(\)/);
  assert.match(response, /fiber\.StatusConflict/);
  assert.match(appTests, /TestIdempotencyConcurrentFingerprintConflictExecutesOneRequest/);
});

test('Redis Sentinel contract stays ACL-separated, pinned, archived, and target-explicit', async () => {
  const [config, redisState, integrationTest, runner, workflow, packageDocument, exampleEnvironment, readme, changelog, evidenceManifest] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'sharedstate', 'redis_sentinel_integration_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'redis-sentinel-contract.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'go-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Solutions', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'CHANGELOG.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
  ]);
  const scripts = JSON.parse(packageDocument).scripts;
  const pinnedImage = 'redis:8.2.1-alpine@sha256:987c376c727652f99625c7d205a1cba3cb2c53b92b0b62aade2bd48ee1593232';

  assert.match(redisState, /type RedisTopology string/);
  assert.match(redisState, /RedisTopologySentinel\s+RedisTopology = "sentinel"/);
  assert.match(redisState, /redis\.NewFailoverClient/);
  assert.match(redisState, /SentinelUsername:\s+config\.SentinelUsername/);
  assert.match(redisState, /TLSConfig:\s+tlsConfig/);
  assert.match(config, /production Redis Sentinel requires REDIS_TLS_ENABLED=true/);
  assert.match(config, /production Redis Sentinel requires REDIS_USERNAME and REDIS_PASSWORD/);
  assert.match(config, /production Redis Sentinel requires REDIS_SENTINEL_USERNAME and REDIS_SENTINEL_PASSWORD/);
  assert.match(integrationTest, /TestRedisSentinelFailoverReconnectsSharedStateClients/);
  assert.match(integrationTest, /sentinel\.Failover/);
  assert.match(integrationTest, /"WAIT", 1, 5000/);
  assert.match(integrationTest, /first\.Take/);
  assert.match(integrationTest, /second\.Lock/);
  assert.match(runner, /process\.platform !== 'linux'/);
  assert.match(runner, new RegExp(pinnedImage.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(runner, /'--network', 'host'/);
  assert.match(runner, /'SENTINEL', 'CKQUORUM'/);
  assert.match(runner, /sentinel sentinel-user/);
  assert.match(runner, /sentinel sentinel-pass/);
  assert.match(runner, /tls_enabled=false/);
  assert.match(runner, /target_redis_ha=not_recorded/);
  assert.match(runner, /workflow-artifacts.*redis-sentinel-contract/s);
  assert.match(runner, /SHA256SUMS/);
  assert.equal(scripts['redis:sentinel:contract'], 'node scripts/redis-sentinel-contract.mjs');
  assert.match(workflow, /redis-sentinel-contract:/);
  assert.match(workflow, /run: yarn redis:sentinel:contract/);
  assert.match(workflow, /name: redis-sentinel-contract-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /path: \.temp\/workflow-artifacts\/redis-sentinel-contract/);
  assert.match(exampleEnvironment, /REDIS_TOPOLOGY=standalone/);
  assert.match(exampleEnvironment, /REDIS_SENTINEL_ADDRESSES=/);
  assert.match(readme, /`sentinel` 拓扑/);
  assert.match(changelog, /Redis Sentinel/);
  assert.match(evidenceManifest, /productionSharedStore:\s*\{\s*status: 'not_recorded'/s);
  assert.match(evidenceManifest, /local non-TLS Sentinel ACL\/failover CI contract/);
});

test('Nginx edge baseline stays pinned, bounded, archived, and target-explicit', async () => {
  const [contractDocument, renderer, realRunner, edgeTests, workflow, packageDocument, readme, evidenceManifest] = await Promise.all([
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'edge', 'goexample-nginx.contract.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nginx-edge.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'nginx-edge-contract.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'nginx-edge.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '.github', 'workflows', 'node-tools-quality.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'support', 'deploy', 'edge', 'README.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'scripts', 'evidence-manifest.mjs'), 'utf8'),
  ]);
  const contract = JSON.parse(contractDocument);
  const scripts = JSON.parse(packageDocument).scripts;
  const pinnedImage = 'nginx:1.30.4-alpine@sha256:97d490c12ba55b4946b01546d1c3ed324e8d41ab1c9fcb2a616aa470620e5b46';

  assert.equal(contract.implementation.image, pinnedImage);
  assert.deepEqual(contract.listener.protocols, ['http/1.1', 'h2']);
  assert.deepEqual(contract.listener.tls, {
    minimumVersion: 'TLSv1.2',
    maximumVersion: 'TLSv1.3',
    certificatePath: '/run/secrets/goexample-edge/tls.crt',
    privateKeyPath: '/run/secrets/goexample-edge/tls.key',
  });
  assert.equal(contract.limits.largeHeaderBufferCount, 4);
  assert.equal(contract.limits.largeHeaderBufferBytes, 16 * 1024);
  assert.equal(contract.limits.clientMaxBodyBytes, 4 * 1024 * 1024);
  assert.equal(contract.behavior.proxyRequestBuffering, false);
  assert.equal(contract.behavior.proxyResponseBuffering, false);
  assert.equal(contract.behavior.proxyRetry, false);
  assert.deepEqual(contract.behavior.edgeStatusCodes, [431, 502, 504]);
  assert.deepEqual(contract.behavior.passThroughStatusCodes, [503]);
  assert.deepEqual(contract.lifecycle, {
    workerShutdownSeconds: 25,
    containerStopSeconds: 30,
    stopSignal: 'SIGQUIT',
  });

  assert.match(renderer, /ssl_protocols \$\{listener\.tls\.minimumVersion\} \$\{listener\.tls\.maximumVersion\}/);
  assert.match(renderer, /http2 on/);
  assert.match(renderer, /large_client_header_buffers/);
  assert.match(renderer, /client_max_body_size/);
  assert.match(renderer, /proxy_request_buffering off/);
  assert.match(renderer, /proxy_buffering off/);
  assert.match(renderer, /proxy_next_upstream off/);
  assert.match(renderer, /worker_shutdown_timeout/);
  assert.match(renderer, /error_page 494 = @header_too_large/);

  assert.match(realRunner, /process\.platform !== 'linux'/);
  assert.match(realRunner, /docker.*nginx.*-t/s);
  assert.match(realRunner, /assert\.equal\(trace\.alpnProtocol, 'h2'\)/);
  assert.match(realRunner, /assert\.equal\(oversizedHeaders\.status, 431\)/);
  assert.match(realRunner, /assert\.equal\(broken\.status, 502\)/);
  assert.match(realRunner, /assert\.equal\(unavailable\.status, 503\)/);
  assert.match(realRunner, /assert\.equal\(timedOut\.status, 504\)/);
  assert.match(realRunner, /upload_interruption_propagated/);
  assert.match(realRunner, /sigquit_drain/);
  assert.match(realRunner, /localContractOnly: true/);
  assert.match(realRunner, /workflow-artifacts.*nginx-edge-contract/s);
  assert.match(realRunner, /SHA256SUMS/);

  assert.match(edgeTests, /Nginx edge contract renders bounded TLS HTTP\/2 proxy configuration/);
  assert.match(edgeTests, /rejects unsafe destinations and weakened contracts/);
  assert.equal(scripts['edge:check'], 'node scripts/nginx-edge.mjs check');
  assert.equal(scripts['edge:contract'], 'node scripts/nginx-edge-contract.mjs');
  assert.match(workflow, /nginx-edge-contract:/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /run: yarn edge:contract/);
  assert.match(workflow, /name: nginx-edge-contract-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /path: \.temp\/workflow-artifacts\/nginx-edge-contract/);
  assert.match(readme, /localContractOnly/);
  assert.match(readme, /HTTP\/3 is not enabled or claimed/);
  assert.match(readme, /targetEdge=not_recorded/);
  assert.match(evidenceManifest, /targetEdge:\s*\{\s*status: 'not_recorded'/s);
  assert.match(evidenceManifest, /no target edge, real certificate\/DNS, HTTP\/3, or target lifecycle artifact/);
});

test('V13 evidence index keeps production boundaries strict and complete', async () => {
  const [script, tests, packageDocument, backlog] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'v13-evidence.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, '__test__', 'node', 'v13-evidence.test.mjs'), 'utf8'),
    readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V13.md'), 'utf8'),
  ]);
  const scripts = JSON.parse(packageDocument).scripts;
  for (const id of ['V13-01', 'V13-02', 'V13-03', 'V13-04', 'V13-05', 'V13-06', 'V13-07', 'V13-08', 'V13-09']) {
    assert.match(script, new RegExp(`\\['${id}',`));
  }
  assert.match(script, /statusValues = new Set\(\['not_recorded', 'recorded', 'failed'\]\)/);
  assert.match(script, /recorded requires a non-local targetEnvironment/);
  assert.match(script, /recorded requires an https runUrl/);
  assert.match(script, /recorded requires a complete fingerprint/);
  assert.match(script, /hashFile\(filePath\) !== item\.sha256/);
  assert.match(script, /value\.startsWith\('\.temp\/'\)/);
  assert.match(tests, /rejects forged recorded state and unsafe artifact paths/);
  assert.equal(scripts['evidence:v13'], 'node scripts/v13-evidence.mjs');
  assert.equal(scripts['evidence:v13:verify'], 'node scripts/v13-evidence.mjs --verify');
  assert.match(backlog, /9 个工作包仍保持 `not_recorded`/);
});
