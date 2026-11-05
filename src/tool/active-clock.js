// Workers have no document.visibilityState. The parent forwards visibility so
// budgets and speed measurements exclude time the browser may suspend work.
export function createActiveClock({now = () => performance.now(), hidden = false} = {}) {
  let pausedAt = hidden ? now() : undefined, pausedMs = 0;
  const waiters = new Set();
  return {
    now: () => (pausedAt ?? now()) - pausedMs,
    setHidden(value) {
      if (value === (pausedAt !== undefined)) return;
      if (value) pausedAt = now();
      else {
        pausedMs += now() - pausedAt;
        pausedAt = undefined;
        for (const resolve of waiters) resolve();
        waiters.clear();
      }
    },
    waitUntilVisible() {
      return pausedAt === undefined ? Promise.resolve() : new Promise(resolve => waiters.add(resolve));
    },
  };
}
