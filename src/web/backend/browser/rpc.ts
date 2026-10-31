// The worker side of pool.ts: answer { id, method, args } with the handler's result.

export function serve(handlers: Record<string, (...args: never[]) => unknown>) {
  self.addEventListener('message', async (e: MessageEvent<{ id: number; method: string; args: unknown[] }>) => {
    const { id, method, args } = e.data;
    try {
      const fn = handlers[method] as ((...a: unknown[]) => unknown) | undefined;
      if (!fn) throw new Error(`Unknown method ${method}`);
      const result = await fn(...args);
      (self as unknown as Worker).postMessage({ id, ok: true, result });
    } catch (err) {
      (self as unknown as Worker).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}
