export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

const browserClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: id => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function pausableTimer(ms: number, onDone: () => void, clock: Clock = browserClock) {
  let left = ms;
  let since = 0;
  let id: unknown = null;
  let over = false;
  const holds = new Set<string>();
  const run = () => {
    since = clock.now();
    id = clock.setTimeout(() => { id = null; over = true; onDone(); }, left);
  };
  run();
  return {
    hold(reason: string) {
      if (over) return;
      holds.add(reason);
      if (id === null) return;
      clock.clearTimeout(id);
      id = null;
      left -= clock.now() - since;
    },
    release(reason: string) {
      if (over || !holds.delete(reason) || holds.size > 0) return;
      run();
    },
    stop() {
      over = true;
      if (id !== null) clock.clearTimeout(id);
      id = null;
    },
  };
}
