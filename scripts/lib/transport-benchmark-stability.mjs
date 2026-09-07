export const transportBenchmarkExpectedRounds = 5;
export const transportBenchmarkMaximumMetricSpreadRatio = 2;
export const transportBenchmarkStabilityFields = Object.freeze([
  'throughputRps',
  'p50Nanos',
  'p95Nanos',
  'p99Nanos',
]);

const metadataKeys = Object.freeze([
  'status',
  'method',
  'expectedRounds',
  'maxMetricSpreadRatio',
  'metricFields',
]);
const stabilityKeys = Object.freeze(['status', 'metrics']);
const metricKeys = Object.freeze(['minimum', 'maximum', 'maxToMinRatio']);

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function requireExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(requireObject(value, label)).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length
    || actualKeys.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function requirePositiveMetric(value, field, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} ${field} must be a finite positive number`);
  }
  if (field !== 'throughputRps' && !Number.isInteger(value)) {
    throw new TypeError(`${label} ${field} must be an integer`);
  }
  return value;
}

function roundedRatio(maximum, minimum) {
  return Number((maximum / minimum).toFixed(6));
}

export function createTransportBenchmarkRoundStabilityMetadata() {
  return {
    status: 'passed',
    method: 'per_group_max_to_min_ratio',
    expectedRounds: transportBenchmarkExpectedRounds,
    maxMetricSpreadRatio: transportBenchmarkMaximumMetricSpreadRatio,
    metricFields: [...transportBenchmarkStabilityFields],
  };
}

export function verifyTransportBenchmarkRoundStabilityMetadata(value, label = 'roundStability') {
  requireExactKeys(value, metadataKeys, label);
  if (
    value.status !== 'passed'
    || value.method !== 'per_group_max_to_min_ratio'
    || value.expectedRounds !== transportBenchmarkExpectedRounds
    || value.maxMetricSpreadRatio !== transportBenchmarkMaximumMetricSpreadRatio
    || !Array.isArray(value.metricFields)
    || value.metricFields.length !== transportBenchmarkStabilityFields.length
    || value.metricFields.some((field, index) => field !== transportBenchmarkStabilityFields[index])
  ) {
    throw new TypeError(`${label} does not match the fixed transport benchmark stability contract`);
  }
}

export function summarizeTransportBenchmarkRoundStability(measurements, label) {
  if (!Array.isArray(measurements) || measurements.length !== transportBenchmarkExpectedRounds) {
    throw new TypeError(`${label} must contain exactly ${transportBenchmarkExpectedRounds} rounds`);
  }
  const metrics = Object.fromEntries(transportBenchmarkStabilityFields.map((field) => {
    const values = measurements
      .map((measurement) => requirePositiveMetric(measurement?.[field], field, label))
      .sort((left, right) => left - right);
    const minimum = values[0];
    const maximum = values.at(-1);
    const maxToMinRatio = roundedRatio(maximum, minimum);
    if (maxToMinRatio > transportBenchmarkMaximumMetricSpreadRatio) {
      throw new TypeError(
        `${label} ${field} max/min ratio ${maxToMinRatio} exceeds ${transportBenchmarkMaximumMetricSpreadRatio}`,
      );
    }
    return [field, { minimum, maximum, maxToMinRatio }];
  }));
  return { status: 'passed', metrics };
}

export function verifyTransportBenchmarkRoundStabilityResult(result, label) {
  requireObject(result, label);
  if (result.rounds !== transportBenchmarkExpectedRounds) {
    throw new TypeError(`${label} must record exactly ${transportBenchmarkExpectedRounds} rounds`);
  }
  const median = requireObject(result.median, `${label} median`);
  const stability = result.stability;
  requireExactKeys(stability, stabilityKeys, `${label} stability`);
  if (stability.status !== 'passed') {
    throw new TypeError(`${label} stability status must be passed`);
  }
  requireExactKeys(stability.metrics, transportBenchmarkStabilityFields, `${label} stability metrics`);
  for (const field of transportBenchmarkStabilityFields) {
    const metric = stability.metrics[field];
    requireExactKeys(metric, metricKeys, `${label} ${field} stability`);
    const minimum = requirePositiveMetric(metric.minimum, field, `${label} minimum`);
    const maximum = requirePositiveMetric(metric.maximum, field, `${label} maximum`);
    if (maximum < minimum) {
      throw new TypeError(`${label} ${field} maximum must be >= minimum`);
    }
    const medianValue = requirePositiveMetric(median[field], field, `${label} median`);
    if (medianValue < minimum || medianValue > maximum) {
      throw new TypeError(`${label} ${field} median must stay between minimum and maximum`);
    }
    const expectedRatio = roundedRatio(maximum, minimum);
    if (metric.maxToMinRatio !== expectedRatio) {
      throw new TypeError(`${label} ${field} maxToMinRatio does not match minimum and maximum`);
    }
    if (expectedRatio > transportBenchmarkMaximumMetricSpreadRatio) {
      throw new TypeError(
        `${label} ${field} max/min ratio ${expectedRatio} exceeds ${transportBenchmarkMaximumMetricSpreadRatio}`,
      );
    }
  }
}
