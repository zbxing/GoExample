export const environmentFetchMaximumTimeoutMs = 10 * 60_000;

function validateTimeout(timeoutMs) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > environmentFetchMaximumTimeoutMs
  ) {
    throw new RangeError(
      `Environment fetch timeout must be a safe integer between 1 and ${environmentFetchMaximumTimeoutMs} milliseconds`,
    );
  }
}

/**
 * Keeps both response-header wait and response-body consumption inside one
 * abort budget. The consumer owns HTTP status and body semantics.
 */
export async function runEnvironmentFetch(
  url,
  consume,
  {
    timeoutMs,
    fetchImpl = globalThis.fetch,
    schedule = setTimeout,
    cancel = clearTimeout,
  } = {},
) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('Environment fetch URL must be a non-empty string');
  }
  if (typeof consume !== 'function') {
    throw new TypeError('Environment fetch consumer must be a function');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('Environment fetch implementation must be a function');
  }
  validateTimeout(timeoutMs);

  const controller = new AbortController();
  const timer = schedule(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error(`Environment fetch timed out after ${timeoutMs} ms`);
      timeoutError.name = 'EnvironmentFetchTimeoutError';
      timeoutError.code = 'ETIMEDOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    cancel(timer);
  }
}
