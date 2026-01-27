/**
 * Fetch with timeout using AbortController.
 * Composes with an external abort signal if provided.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = 15000, signal: externalSignal, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  // If caller provided a signal, abort our controller when it fires
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener('abort', onExternalAbort);

  try {
    const response = await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(id);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
