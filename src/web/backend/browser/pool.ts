// A few workers sharing a queue of calls. Each worker handles one call at a time; a worker
// replies { id, ok, result } or { id, ok: false, error } (see rpc.ts).

interface Task {
  method: string;
  args: unknown[];
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class WorkerPool {
  private idle: Worker[] = [];
  private queue: Task[] = [];
  private all: Worker[] = [];
  private nextId = 1;

  constructor(private readonly make: () => Worker, private readonly size: number) {}

  call<T>(method: string, ...args: unknown[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ method, args, resolve: resolve as (v: unknown) => void, reject });
      this.pump();
    });
  }

  /** Stop every worker (pending calls fail). */
  terminate() {
    for (const w of this.all) w.terminate();
    this.all = [];
    this.idle = [];
    for (const t of this.queue.splice(0)) t.reject(new Error('Stopped'));
  }

  private pump() {
    while (this.queue.length) {
      let w = this.idle.pop();
      if (!w && this.all.length < this.size) {
        w = this.make();
        this.all.push(w);
      }
      if (!w) return;
      this.run(w, this.queue.shift()!);
    }
  }

  private run(w: Worker, t: Task) {
    const id = this.nextId++;
    const onMessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      if (e.data?.id !== id) return;
      cleanup();
      if (e.data.ok) t.resolve(e.data.result);
      else t.reject(new Error(e.data.error ?? 'Worker failed'));
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      // A crashed worker (out of memory on a huge image, say) is replaced on the next call.
      this.all = this.all.filter((x) => x !== w);
      w.terminate();
      t.reject(new Error(e.message || 'The image worker stopped unexpectedly'));
      this.pump();
    };
    const cleanup = () => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      if (this.all.includes(w)) this.idle.push(w);
      queueMicrotask(() => this.pump());
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, method: t.method, args: t.args });
  }
}
