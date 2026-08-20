import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
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

test('Go project runner rejects project paths outside Proj', () => {
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
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'internal', 'projectapi', 'openapi_contract_test.go'), 'utf8'),
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
      'Proj',
      'Example',
      'internal',
      'projectapi',
      'transport_benchmark_test.go',
    ),
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
  assert.match(workflow, /yarn bench:transports/);
  assert.match(workflow, /lscpu/);
  assert.match(workflow, /GOMAXPROCS=2 \/usr\/bin\/time -v/);
  assert.match(workflow, /transport-benchmark\.txt/);
  assert.match(workflow, /PIPESTATUS\[0\]/);
  assert.match(workflow, /benchmark-status\.txt/);
  assert.match(workflow, /scripts\/evidence-manifest\.mjs/);
  assert.match(workflow, /yarn evidence:manifest/);
  assert.match(workflow, /manifest\.json/);
  assert.match(workflow, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(goProjectRunner, /'bench-transports'[\s\S]*'-count=5'/);
  assert.match(goProjectRunner, /-run=\^TestProjectTransport/);
  assert.match(goProjectRunner, /-cpuprofile=transport\.cpu\.pprof/);
  assert.match(goProjectRunner, /-memprofile=transport\.heap\.pprof/);
  assert.match(transportBenchmark, /TestProjectTransportsReturnTheSameEnvelopeOverTCP/);
  assert.match(transportBenchmark, /TestNetHTTPTransportSupportsHTTP2/);
  assert.match(transportBenchmark, /EnableHTTP2 = true/);
  assert.match(transportBenchmark, /response\.ProtoMajor != 2/);
  assert.match(transportBenchmark, /TestHTTP2EdgeToFiberHTTP1Contract/);
  assert.match(transportBenchmark, /NewSingleHostReverseProxy/);
  assert.match(transportBenchmark, /TestProjectTransportLatencyTCP/);
  assert.match(transportBenchmark, /TRANSPORT_LATENCY/);
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
    readFile(path.join(repositoryRoot, 'Proj', 'Example', '.env.example'), 'utf8'),
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
  assert.match(config, /METRICS_TOKEN must differ from JWT_SECRET/);
  assert.match(config, /PPROF_TOKEN must differ from METRICS_TOKEN and JWT_SECRET/);
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
  const script = await readFile(scriptPath, 'utf8');
  assert.match(script, /createHash\(['"]sha256['"]\)/);
  assert.match(script, /changedFileCount/);
  assert.match(script, /productionSharedStore/);
  assert.match(script, /not_recorded/);
  assert.match(script, /output must be a \.json file inside the repository \.temp directory/);

  const temporaryDirectory = await mkdtemp(path.join(repositoryRoot, '.temp', 'manifest-test-'));
  const outputPath = path.join(temporaryDirectory, 'manifest.json');
  try {
    const result = runScript('scripts/evidence-manifest.mjs', ['--output', outputPath]);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(manifest.schemaVersion, 1);
    assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(manifest.repository.gitCommit, /^[a-f0-9]{40}$|^unknown$/);
    assert.ok(Array.isArray(manifest.inputs));
    assert.ok(manifest.inputs.some((input) => input.path === 'package.json' && input.sha256));
    assert.ok(manifest.boundaries.productionSharedStore.status === 'not_recorded');
    assert.ok(manifest.boundaries.otelCollector.status === 'not_recorded');
    assert.ok(manifest.boundaries.postgresRecovery.status === 'not_recorded');
    assert.ok(manifest.boundaries.signedRelease.status === 'not_recorded');
    assert.ok(manifest.boundaries.targetEdge.status === 'not_recorded');
    assert.ok(manifest.boundaries.kubernetesDrill.status === 'not_recorded');

    const outsidePath = path.join(repositoryRoot, 'manifest-outside-temp.json');
    const rejected = runScript('scripts/evidence-manifest.mjs', ['--output', outsidePath]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /inside the repository \.temp directory/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('V11 evaluation score matches its weighted evidence table and backlog', async () => {
  const [evaluation, backlog] = await Promise.all([
    readFile(path.join(repositoryRoot, 'docs', '评估', '项目架构与性能评估.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', '待优化', '待优化V11.md'), 'utf8'),
  ]);
  const rows = [
    ...evaluation.matchAll(/^\| (?!\*\*综合评分)([^|]+) \| (\d+)% \| ([\d.]+) \| ([\d.]+) \|/gm),
  ];

  assert.equal(rows.length, 18, 'V11 score table must contain 18 weighted dimensions');
  const weightTotal = rows.reduce((total, row) => total + Number(row[2]), 0);
  assert.equal(weightTotal, 100, 'V11 score weights must total 100%');

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
  assert.ok(declared, 'V11 evaluation must declare an exact weighted score');
  assert.equal(declared[1], '8.960', 'V11 score must include the verified context-only application query boundary');
  const roundedCalculatedTotal = Math.round((calculatedTotal + 1e-9) * 1000) / 1000;
  assert.equal(roundedCalculatedTotal.toFixed(3), declared[1]);
  assert.match(backlog, /V11-00/);
  assert.match(backlog, /V11-11/);
  assert.match(backlog, /8\.960\/10/);
  assert.match(backlog, /10\.0\/10/);
});

test('Example project queries keep Fiber behind the Framework adapter', async () => {
  const [applicationQuery, routes, app, appTests, projectRoutes, entrypoint, architectureTests, projectRouteTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'application_query.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'routes.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'internal', 'projectapi', 'routes.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'internal', 'projectapi', 'architecture_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'internal', 'projectapi', 'routes_test.go'), 'utf8'),
  ]);

  assert.match(applicationQuery, /type ApplicationQuery struct/);
  assert.match(applicationQuery, /Handler\s+func\(context\.Context\) \(any, error\)/);
  assert.match(applicationQuery, /func registerApplicationQueries/);
  assert.match(routes, /registerApplicationQueries/);
  assert.match(routes, /ApplicationQueries and RegisterRoutes cannot be configured together/);
  assert.match(app, /ApplicationQueries \[\]ApplicationQuery/);
  assert.match(appTests, /TestApplicationQueriesKeepHandlersTransportNeutral/);
  assert.match(appTests, /TestApplicationQueryErrorsUseTheServerErrorBoundary/);
  assert.match(appTests, /TestApplicationQueriesRejectAmbiguousDefinitions/);
  assert.match(projectRoutes, /func Queries\(options httpapi\.Options\) \[\]httpapi\.ApplicationQuery/);
  assert.match(entrypoint, /apiOptions\.ApplicationQueries = projectapi\.Queries\(apiOptions\)/);
  assert.doesNotMatch(projectRoutes, /gofiber|fiber\./i);
  assert.doesNotMatch(entrypoint, /gofiber|fiber\./i);
  assert.match(architectureTests, /TestProductionProjectCompositionDoesNotImportFiber/);
  assert.match(projectRouteTests, /TestProjectRouteCreatesChildApplicationSpan/);
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
  const [rules, runbook, tracingProvider, tracingTests, projectService, projectRouteTests, exampleEnvironment] = await Promise.all([
    readFile(path.join(repositoryRoot, 'deploy', 'prometheus', 'rules', 'goexample-slo.yml'), 'utf8'),
    readFile(path.join(repositoryRoot, 'docs', 'observability', 'SLO-and-alerts.md'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'tracing_provider.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'tracing_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'internal', 'projectapp', 'service.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'internal', 'projectapi', 'routes_test.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', '.env.example'), 'utf8'),
  ]);

  assert.match(rules, /^groups:/m);
  assert.match(rules, /goexample:sli:availability_ratio5m/);
  assert.match(rules, /goexample:sli:admission_rejection_rate5m/);
  assert.match(rules, /goexample:sli:draining_rejection_rate5m/);
  assert.match(rules, /goexample:sli:latency_p95_seconds5m/);
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
  assert.match(runbook, /does not yet run `promtool`/);
  assert.match(runbook, /real OpenTelemetry Collector/);
  assert.match(tracingProvider, /go\.opentelemetry\.io\/otel/);
  assert.match(tracingProvider, /NewBatchSpanProcessor/);
  assert.match(tracingProvider, /WithMaxQueueSize/);
  assert.match(tracingProvider, /WithExportTimeout/);
  assert.match(tracingTests, /TestOTLPHTTPBatchExporterDoesNotBlockRequestAndFlushesOnShutdown/);
  assert.match(tracingTests, /\/tenant\/v1\/traces/);
  assert.match(projectService, /project\.get/);
  assert.match(projectRouteTests, /TestProjectRouteCreatesChildApplicationSpan/);
  assert.match(exampleEnvironment, /OTEL_TRACES_EXPORTER=none/);
});

test('server shared-state boundary keeps production fail-fast explicit', async () => {
  const [config, sharedState, entrypoint, exampleEnvironment, middleware, fingerprint, response, appTests] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'shared_state.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'idempotency_fingerprint.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'response.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app_test.go'), 'utf8'),
  ]);

  assert.match(config, /SHARED_STATE_MODE/);
  assert.match(config, /ALLOW_IN_MEMORY_SHARED_STATE/);
  assert.match(config, /environment == 'production'|environment == "production"/);
  assert.match(sharedState, /external shared state requires a shared storage implementation/);
  assert.match(sharedState, /external shared state requires a distributed idempotency lock/);
  assert.match(sharedState, /goexample:/);
  assert.match(entrypoint, /ValidateSharedState/);
  assert.match(exampleEnvironment, /SHARED_STATE_MODE=memory/);
  assert.match(exampleEnvironment, /ALLOW_IN_MEMORY_SHARED_STATE=false/);
  assert.match(middleware, /idempotencyRequestFingerprint/);
  assert.match(fingerprint, /errIdempotencyFingerprintConflict/);
  assert.match(fingerprint, /sha256\.New\(\)/);
  assert.match(response, /fiber\.StatusConflict/);
  assert.match(appTests, /TestIdempotencyConcurrentFingerprintConflictExecutesOneRequest/);
});
