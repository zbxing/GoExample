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

test('MSFront browser workflow keeps production E2E and diagnostics enabled', async () => {
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'msfront-browser.yml'),
    'utf8',
  );
  const playwrightConfig = await readFile(
    path.join(repositoryRoot, 'playwright.config.ts'),
    'utf8',
  );

  assert.match(workflow, /yarn build:front/);
  assert.match(workflow, /yarn playwright install --with-deps chromium/);
  assert.match(workflow, /yarn test:e2e/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(playwrightConfig, /reuseExistingServer:\s*false/);
  assert.match(playwrightConfig, /trace:\s*'retain-on-failure'/);
  assert.match(playwrightConfig, /name:\s*'desktop-chromium'/);
  assert.match(playwrightConfig, /name:\s*'mobile-chromium'/);
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
  assert.match(lifecycleContract, /tls\.Listen/);
  assert.match(lifecycleContract, /response\.ProtoMajor != 1/);
});

test('server admission control remains bounded and probe-safe', async () => {
  const [app, middleware, metrics, config, environment, lifecycle] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'app.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'middleware.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'observability', 'metrics.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', '.env.example'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'lifecycle_contract_test.go'), 'utf8'),
  ]);

  assert.match(app, /MaxInFlight/);
  assert.match(app, /MaxConnections/);
  assert.match(app, /Concurrency:\s*options\.MaxConnections/);
  assert.match(app, /ReadBufferSize/);
  assert.match(app, /ExposeHeaders:[\s\S]*HeaderRetryAfter/);
  assert.match(middleware, /boundedConcurrency/);
  assert.match(middleware, /rejectWhenDraining/);
  assert.match(middleware, /StatusServiceUnavailable/);
  assert.match(middleware, /HeaderRetryAfter/);
  assert.match(metrics, /goexample_http_admission_rejections_total/);
  assert.match(metrics, /goexample_http_draining_rejections_total/);
  assert.match(metrics, /RecordAdmissionRejected/);
  assert.match(metrics, /RecordDrainingRejected/);
  assert.match(config, /HTTP_MAX_IN_FLIGHT/);
  assert.match(config, /HTTP_MAX_CONNECTIONS/);
  assert.match(config, /HTTP_READ_BUFFER_SIZE/);
  assert.match(environment, /HTTP_MAX_IN_FLIGHT=256/);
  assert.match(environment, /HTTP_MAX_CONNECTIONS=4096/);
  assert.match(environment, /HTTP_READ_BUFFER_SIZE=16384/);
  assert.match(lifecycle, /TestAPIAdmissionRejectsExcessRequestsAndKeepsReadinessAvailable/);
  assert.match(lifecycle, /TestConnectionConcurrencyRejectsExcessConnectionsOverTCP/);
  assert.match(lifecycle, /options\.MaxConnections\s*=\s*1/);
  assert.match(lifecycle, /TestDrainingRejectsNewAPIRequestsButKeepsExistingWorkAndProbeContract/);
  assert.match(lifecycle, /TestReadBufferRejectsOversizedHeaderOverTCP/);
  assert.match(lifecycle, /TestReadTimeoutRejectsIncompleteHeadersOverTCP/);
  assert.match(lifecycle, /options\.ReadTimeout\s*=\s*50 \* time\.Millisecond/);
  assert.match(lifecycle, /" 408 "/);
  assert.match(lifecycle, /StatusServiceUnavailable/);
  assert.match(lifecycle, /\/readyz/);
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

    const outsidePath = path.join(repositoryRoot, 'manifest-outside-temp.json');
    const rejected = runScript('scripts/evidence-manifest.mjs', ['--output', outsidePath]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /inside the repository \.temp directory/);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test('V9 evaluation score matches its weighted evidence table', async () => {
  const evaluation = await readFile(
    path.join(repositoryRoot, 'docs', '评估', '项目架构与性能评估.md'),
    'utf8',
  );
  const rows = [
    ...evaluation.matchAll(/^\| (?!\*\*综合评分)([^|]+) \| (\d+)% \| ([\d.]+) \| ([\d.]+) \|/gm),
  ];

  assert.equal(rows.length, 16, 'V9 score table must contain 16 weighted dimensions');
  const weightTotal = rows.reduce((total, row) => total + Number(row[2]), 0);
  assert.equal(weightTotal, 100, 'V9 score weights must total 100%');

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
  assert.ok(declared, 'V9 evaluation must declare an exact weighted score');
  const roundedCalculatedTotal = Math.round((calculatedTotal + 1e-9) * 1000) / 1000;
  assert.equal(roundedCalculatedTotal.toFixed(3), declared[1]);
});

test('server observability rules define executable SLO evidence', async () => {
  const rules = await readFile(
    path.join(repositoryRoot, 'deploy', 'prometheus', 'rules', 'goexample-slo.yml'),
    'utf8',
  );
  const runbook = await readFile(
    path.join(repositoryRoot, 'docs', 'observability', 'SLO-and-alerts.md'),
    'utf8',
  );

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
});

test('server shared-state boundary keeps production fail-fast explicit', async () => {
  const [config, sharedState, entrypoint, exampleEnvironment] = await Promise.all([
    readFile(path.join(repositoryRoot, 'Framework', 'config', 'config.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Framework', 'httpapi', 'shared_state.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', 'cmd', 'server', 'main.go'), 'utf8'),
    readFile(path.join(repositoryRoot, 'Proj', 'Example', '.env.example'), 'utf8'),
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
});
