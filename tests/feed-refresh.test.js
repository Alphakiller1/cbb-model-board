import assert from "node:assert/strict";
import test from "node:test";
import { isStale, selectedDate, startFeedRefresh } from "../docs/feed-refresh.js";

const currentTime = new Date("2026-11-19T20:00:00Z");
const board = (generated = "2026-11-19T19:45:00Z", date = "2026-11-19") => ({
  generated_at_utc: generated, as_of_date: date, games: [],
});

function harness(fetchBoard) {
  const rendered = [], reported = [], timers = [];
  const controller = startFeedRefresh({
    fetchBoard, render: (next) => rendered.push(next), report: (state) => reported.push(state),
    now: () => currentTime,
    schedule: (callback, ms) => { timers.push({ callback, ms }); return 1; }, cancel: () => {},
  });
  return { ...controller, rendered, reported, timers };
}

test("freshness follows the Eastern slate and the real generation age", () => {
  assert.equal(isStale(board(), currentTime), false);
  assert.equal(isStale(board("2026-11-19T17:59:00Z"), currentTime), true);
  assert.equal(isStale(board("2026-11-19T19:45:00Z", "2026-11-18"), currentTime), true);
  assert.equal(isStale(board("bad-time"), currentTime), true);
  assert.equal(isStale(board("2026-11-20T00:45:00Z"), new Date("2026-11-20T01:00:00Z")), false);
});

test("midnight follows today, while an explicitly selected future slate stays selected", () => {
  const dates = ["2026-11-20", "2026-11-21"];
  assert.equal(selectedDate("2026-11-19", "2026-11-19", dates[0], dates), dates[0]);
  assert.equal(selectedDate("2026-11-21", "2026-11-19", dates[0], dates), "2026-11-21");
  assert.equal(selectedDate("2026-11-18", "2026-11-19", dates[0], dates), dates[0]);
});

test("the periodic check renders newer data without rolling back to a cached commit", async () => {
  const queue = [board(), board("2026-11-19T19:50:00Z"), board("2026-11-19T19:30:00Z")];
  const h = harness(async () => queue.shift());
  await h.refresh();
  assert.equal(h.timers[0].ms, 300_000);
  h.timers[0].callback();
  await h.refresh();
  await h.refresh();
  assert.equal(h.rendered.length, 2);
  assert.equal(h.reported.at(-1).board.generated_at_utc, "2026-11-19T19:50:00Z");
});

test("a failed refresh retains the loaded board and recovers on the next check", async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 2) throw new Error("offline");
    return board(calls === 1 ? "2026-11-19T19:45:00Z" : "2026-11-19T19:55:00Z");
  });
  await h.refresh();
  await h.refresh();
  assert.equal(h.reported.at(-1).error.message, "offline");
  assert.equal(h.rendered.length, 1);
  assert.equal(h.reported.at(-1).board.generated_at_utc, "2026-11-19T19:45:00Z");
  await h.refresh();
  assert.equal(h.reported.at(-1).error, null);
  assert.equal(h.rendered.length, 2);
});

test("an unavailable first fetch retries without requiring a page reload", async () => {
  let calls = 0;
  const h = harness(async () => {
    if (++calls === 1) throw new Error("offline");
    return board();
  });
  await h.refresh();
  assert.equal(h.reported.at(-1).board, null);
  await h.refresh();
  assert.equal(h.reported.at(-1).stale, false);
  assert.equal(h.rendered.length, 1);
});

test("tab and timer checks cannot overlap or allow future-dated responses", async () => {
  let resolve, calls = 0;
  const h = harness(() => { calls++; return new Promise((done) => { resolve = done; }); });
  const first = h.refresh(), second = h.refresh();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolve(board("2026-11-19T22:00:00Z"));
  await first;
  assert.equal(h.rendered.length, 0);
  assert.match(h.reported.at(-1).error.message, /invalid forecast time/);
});
