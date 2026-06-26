# Manual Test Results
**Date:** 2026-05-02
**Tester:** Claude (console-based — no HTTP endpoints)
**Note:** Features 3.2 and 4.1 are CLI/plugin/service-layer features; no HTTP server to start.
  Manual-test executed as console smoke tests.

## Results

| Story | Criterion | Result | Notes |
|---|---|---|---|
| 3.2-2 happy | JSON line per event with ts field | PASS | tsx direct invocation confirmed `{"type":"step_started",...,"ts":"2026-05-02T..."}` |
| 3.2-2 happy | Multiple events → multiple lines | PASS | Two handle() calls → two newline-delimited JSON lines |
| 3.2-2 negative | handle() before start() → no output | PASS | Verified by unit tests (864 passing) |
| 3.2-3 happy | Events flow through JsonStdoutSubscriber | PASS | Verified via integration tests |
| 3.2-3 happy | Terminal path unaffected | PASS | Verified via integration tests |
| 4.1-4 happy | Step Durations table sorted desc | PASS | conduct-ts --report: plan(15400) > brainstorm(8200) > implement(3100) |
| 4.1-5 happy | Retry Hotspots table with count + reason | PASS | plan: 1 retry, "Response truncated", status ok |
| 4.1-6 happy | Token Spend table with input/output | PASS | plan: 4200 in / 1800 out; implement: 2100 in / 900 out |
| 4.1-4 negative | Missing events.jsonl → exit 1 + message | PASS | "No event log found at .pipeline/events.jsonl" + exit 1 |

## Bugs Found

None.
