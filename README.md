# CBB model dashboard

The model publisher writes the same validated score feed to `board.json` and
`docs/board.json` in one commit. GitHub Pages deploys `docs/`; the dashboard reads
its local feed so a cached raw-GitHub branch alias cannot hold it on an older
board after deployment. The root feed remains available for existing consumers.

The page checks for new data every five minutes and when focused, preserves
filters, and rejects older or future-dated responses. Each check bypasses the
browser cache. `npm test` verifies refresh, outage, date rollover and rollback
behavior.
