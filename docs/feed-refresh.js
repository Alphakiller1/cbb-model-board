const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

export function isStale(board, now = new Date()) {
  const age = now.getTime() - Date.parse(board.generated_at_utc);
  return !Number.isFinite(age) || age < -60_000 || age > 2 * 60 * 60_000
    || board.as_of_date !== easternDay.format(now);
}

export function selectedDate(previous, previousAsOf, nextAsOf, dates) {
  // Follow today's slate across midnight; preserve an explicitly chosen future slate.
  return previous && previous !== previousAsOf && dates.includes(previous) ? previous : nextAsOf;
}

export function startFeedRefresh({
  fetchBoard, render, report, now = () => new Date(),
  schedule = setInterval, cancel = clearInterval, intervalMs = 5 * 60_000,
}) {
  let board = null;
  let pending = null;
  let lastError = null;
  let checkedAt = null;

  function state() {
    report({ board, checkedAt, error: lastError, stale: board ? isStale(board, now()) : true });
  }

  function refresh() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const next = await fetchBoard();
        const generated = Date.parse(next.generated_at_utc);
        if (!Number.isFinite(generated) || generated > now().getTime() + 60_000) {
          throw new Error("Score feed has an invalid forecast time");
        }
        // A CDN may briefly return an older commit. Keep the newer board on screen.
        if (!board || generated > Date.parse(board.generated_at_utc)) {
          render(next, board);
          board = next;
        }
        checkedAt = now();
        lastError = null;
      } catch (error) {
        lastError = error;
      } finally {
        pending = null;
        state();
      }
    })();
    return pending;
  }

  const timer = schedule(() => { state(); void refresh(); }, intervalMs);
  void refresh();
  return { refresh, stop: () => cancel(timer) };
}
