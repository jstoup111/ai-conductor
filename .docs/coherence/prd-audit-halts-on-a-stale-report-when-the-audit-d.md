# Coherence Mapping: prd-audit-halts-on-a-stale-report-when-the-audit-d (#1838)

Technical track (no `fr` rows). Outcomes staged from jstoup111/ai-conductor#1838.

| Row class | Cited id / criterion | Counterpart / cited task id(s) | Verdict | Notes / verbatim quote |
|---|---|---|---|---|
| outcome | outcome-1 | story-3, story-4 | covered | Readers judge run identity; stale never acted on |
| outcome | outcome-2 | story-2, story-3 | covered | Staleness reasons name artifact + expected/found identity, never stale findings |
| outcome | outcome-3 | story-2 | covered | Write handshake scores a non-writing audit failed |
| outcome | outcome-4 | story-5 | covered | Recovery is clear-and-rerun, no hand-deletion |
| story | story-1 | task-1, task-2, task-3, task-4 | covered | Stamp infrastructure + settle write + echo/write-failure negatives |
| story | story-2 | task-6, task-7 | covered | Handshake happy + partial/corrupt negatives |
| story | story-3 | task-5, task-8, task-9 | covered | Identity helper + classify + predicates/preserve path |
| story | story-4 | task-10, task-11, task-15 | covered | Retry classification, exhaustion halt, telemetry |
| story | story-5 | task-12 | covered | Recovery integration test |
| story | story-6 | task-13 | covered | Fallback + kill-switch parity |
| story | story-7 | task-14 | covered | manual_test composition with #367 guards |
| task | task-1 | story-1 | covered | Marker type + manual_test sidecar path (infrastructure for the stamp) |
| task | task-2 | story-1 | covered | Per-dispatch run id in completion context (infrastructure) |
| task | task-3 | story-1 | covered | Settle-boundary stamp, every terminal outcome |
| task | task-4 | story-1 | covered | Echo ignored; unwritable sidecar loud |
| task | task-5 | story-3 | covered | verdictProducedByRun identity ladder (infrastructure) |
| task | task-6 | story-2 | covered | Post-dispatch handshake |
| task | task-7 | story-2 | covered | Handshake negatives |
| task | task-8 | story-3 | covered | classifyPrdAuditGaps identity-aware |
| task | task-9 | story-3 | covered | Predicates + preserve path judge identity |
| task | task-10 | story-4 | covered | Mismatch is absent, reruns; adverse routes |
| task | task-11 | story-4 | covered | Self-describing exhaustion halt |
| task | task-12 | story-5 | covered | Recovery integration |
| task | task-13 | story-6 | covered | Fallback + kill-switch |
| task | task-14 | story-7 | covered | manual_test composition |
| task | task-15 | story-4 | covered | Telemetry on existing spine |
| adr | adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity | story-1, story-2, story-3, story-4, story-5, story-6, story-7 | covered | D1-D9 implemented across all seven stories |
| adr | adr-2026-07-13-session-fresh-verdict-artifacts | story-6 | covered | Amended non-goal; mtime floor preserved as unstamped fallback |
| adr | adr-2026-07-22-gate-evidence-code-validity-on-redispatch | story-3, story-6 | covered | Amended D5/D1; preserve path + fallback/kill-switch honored |
| adr | adr-2026-07-13-retry-classify-rerun-vs-route | story-4 | covered | Amended D2; absent-means-rerun mapping preserved |
| criterion | Story 1 happy: Given a prd_audit dispatch settles after writing its report, when the engine records the settle, then the gate-code-validity sidecar carries the dispatch's attempt id as the run identity beside `codeStamp` | task-3 | covered | the sidecar carries `runId === attemptRunId` | diff-local |
| criterion | Story 1 happy: Given the three verdict gates run concurrently in a validation group, when each branch settles, then its stamp is written on that branch's own settle path before the join reads any verdict | task-3 | covered | validation-group branches stamp before the join reads verdicts | diff-local |
| criterion | Story 1 negative: Given the provider's output text embeds a run-identity value, when the engine stamps the sidecar, then the provider-supplied value is ignored and the engine's own attempt id is recorded (never validated as an echo) | task-4 | covered | leaves the sidecar with the engine's value | diff-local |
| criterion | Story 1 negative: Given the sidecar cannot be written (e.g. `.pipeline/` unwritable), when the settle records it, then the failure is reported loudly for that branch and the engine does not throw or silently mark the verdict identity-stamped | task-4 | covered | yields a logged warning for the branch and no throw | diff-local |
| criterion | Story 1 negative: Given two validation-group branches settle near-simultaneously, when both stamp their own sidecars, then neither branch's stamp overwrites or blocks the other's (each gate has its own sidecar file) | task-4 | covered | two branches stamping their own sidecars do not interfere | diff-local |
| criterion | Story 2 happy: Given a prd_audit dispatch writes `.pipeline/prd-audit.md` during its run, when the handshake runs after settle, then the attempt is eligible for completion checking with no handshake finding | task-6 | covered | a dispatch that wrote its report fresh passes the handshake | diff-local |
| criterion | Story 2 happy: Given any terminal dispatch outcome (success, error, halt), when the step concludes, then the handshake observation is recorded — not only on the success path | task-6 | covered | record the handshake observation on every terminal outcome | diff-local |
| criterion | Story 2 negative: Given a dispatch settles ✓ but wrote neither report nor marker, when the handshake runs, then the attempt is scored failed with a reason naming each missing artifact, the expected run identity, and the found identity/mtime of whatever is on disk | task-6 | covered | names `.pipeline/prd-audit.md`, the expected run id, and the found id/mtime | diff-local |
| criterion | Story 2 negative: Given a dispatch settles ✓ but only the report (not the marker) was rewritten, when the handshake runs, then the reason names specifically the artifact that was not produced | task-7 | covered | reason names specifically the marker | diff-local |
| criterion | Story 2 negative: Given the handshake's own read throws (unreadable file, corrupt sidecar), when it evaluates, then the attempt is treated as not-verified (fail-closed for the verdict) while the engine itself does not crash | task-7 | covered | attempt not verified (fail-closed for the verdict) and the engine does not crash | diff-local |
| criterion | Story 3 happy: Given a report stamped with the current dispatch's identity and blocking rows, when `classifyPrdAuditGaps` runs, then those rows drive routing as today | task-8 | covered | a current-run stamped report with blocking rows classifies exactly as today | diff-local |
| criterion | Story 3 happy: Given a report stamped with the current identity and no blocking rows, when the completion predicate runs, then the gate passes as today | task-9 | covered | predicates consult `verdictProducedByRun` before content parsing | diff-local |
| criterion | Story 3 negative: Given a report whose stamp identifies an earlier lap of the same session, when `classifyPrdAuditGaps` runs, then it returns no blocking rows from that report and the caller treats the state as "no fresh verdict" — the stale rows never reach a kickback hint or halt reason | task-8 | covered | yields zero blocking classifications | diff-local |
| criterion | Story 3 negative: Given a stale-identity report, when the completion predicate scores the step, then the reason states the verdict was not produced by this run and names the artifact, expected identity, and found identity — with none of the stale findings quoted as current | task-9 | covered | naming artifact + expected + found identity and quoting no findings | diff-local |
| criterion | Story 3 negative: Given the gate-code-validity preserve path (#817) holds a PASS sidecar while the on-disk report is from an older lap with blocking rows, when the predicate evaluates, then the stale report is not re-read as a current clean/blocking verdict | task-9 | covered | the preserve path holding a PASS sidecar over an older-lap blocking report does not return done | diff-local |
| criterion | Story 4 happy: Given the handshake scored "no verdict for this run", when `classifyRetryDecision` runs, then the decision is rerun (routeClass absent), not route | task-10 | covered | `classifyRetryDecision` returns rerun | diff-local |
| criterion | Story 4 happy: Given a rerun then writes a correctly-stamped verdict, when the completion predicate runs, then the lap proceeds normally | task-12 | covered | re-dispatch runs a fresh audit (fake provider writes stamped outputs) | diff-local |
| criterion | Story 4 negative: Given the retry budget is exhausted with the verdict still missing/mismatched, when the step concludes, then a `needs-human` halt is written through `writeHaltMarker` whose reason names the step, the artifact, the expected run identity, and the found identity/mtime — and quotes no stale findings | task-11 | covered | the step, artifact path, expected run id, and found id/mtime | diff-local |
| criterion | Story 4 negative: Given the mismatch, when the decision is made, then it is made on a typed facet — a test that rewords the reason text does not change the routing outcome | task-10 | covered | rewording the reason string does not change either outcome | diff-local |
| criterion | Story 4 negative: Given a fresh adverse (blocking) verdict with a matching stamp, when classification runs, then it still routes (named-route) — identity checking does not convert genuine failures into endless reruns | task-10 | covered | a matching-stamp adverse verdict ⇒ route | diff-local |
| criterion | Story 5 happy: Given a stale-identity halt was cleared (HALT + HALT.class removed), when the daemon re-dispatches the feature, then the re-run treats prior-identity artifacts as absent input and a fresh audit runs | task-12 | covered | the run completes without any manual `.pipeline/` deletion | diff-local |
| criterion | Story 5 negative: Given the prior lap's stale report and marker are still on disk after halt-clear, when the re-dispatched gate evaluates before the fresh audit writes, then the stale pair does not reproduce the halt (the failure mode where clearing alone re-halted is gone) | task-12 | covered | prior-lap stale report+marker+sidecar and a cleared halt | diff-local |
| criterion | Story 5 negative: Given the fresh audit then writes a stamped blocking verdict, when the gate evaluates, then the blocking verdict is honored — recovery does not whitewash genuine findings | task-12 | covered | routes/halts on the FRESH findings | diff-local |
| criterion | Story 6 happy: Given a verdict artifact with no run-identity stamp (written pre-upgrade), when readers evaluate it, then today's mtime-floor behavior applies unchanged | task-13 | covered | unstamped fresh artifact passes exactly as today | diff-local |
| criterion | Story 6 happy: Given the existing gate-code-validity kill-switch is off, when the gates run, then identity checking is bypassed and pure mtime behavior applies end-to-end | task-13 | covered | no identity comparison occurs | diff-local |
| criterion | Story 6 negative: Given an unstamped stale artifact, when readers evaluate it, then it is not treated as MORE trusted than today (fallback never widens acceptance) | task-13 | covered | unstamped stale artifact fails exactly as today | diff-local |
| criterion | Story 6 negative: Given a corrupt/unparseable sidecar, when the identity helper reads it, then it degrades to the unstamped path without throwing | task-5 | covered | corrupt-JSON case returns `unstamped` | diff-local |
| criterion | Story 7 happy: Given a manual-test run appends its `## Attempt N` section and the engine stamps the run identity, when the gate evaluates, then the latest attempt section is judged exactly as today plus the identity check | task-14 | covered | consults the identity helper before latest-section judging | diff-local |
| criterion | Story 7 negative: Given results flip FAIL→PASS with HEAD unmoved, when the gate evaluates, then the whitewash guard still blocks regardless of a matching run-identity stamp | task-14 | covered | still blocks even when the run identity matches | diff-local |
| criterion | Story 7 negative: Given the results file was not appended this dispatch (prior lap's latest section only), when the gate evaluates, then the identity check scores "no fresh verdict" instead of re-judging the old section | task-14 | covered | instead of re-judging the old section | diff-local |
