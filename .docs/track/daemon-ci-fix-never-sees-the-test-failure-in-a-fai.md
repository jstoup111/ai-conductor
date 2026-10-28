# Track: CI-fix log excerpt carries the failure, not the setup output

Track: technical

Scope boundary: Balanced (pre-authorized composer run; the default reading of intake jstoup111/ai-conductor#3106). The per-run workflow-log excerpt that `enrichCiFixHint` (`src/conductor/src/engine/ci-fix.ts`) adds to the daemon CI-fix hint carries the log's failure lines and its end, stays within its existing 12,288-byte per-run budget and the 24,576-byte total hint budget, and still yields a non-empty excerpt when the log has no recognizable failure line. Excluded: the required check metadata built by `buildCiFixHint`; the three-run read limit; the total hint budget and its truncation; the CI-fix agent prompt; the `conductor` CI reporter output (#2631 / spec PR #3076); and any per-job or per-step log API other than `gh run view --log-failed`.

Rationale: daemon-internal repair context with no user-facing product capability, so acceptance criteria live directly in stories (no PRD). Not a maintenance change: it changes what the CI-fix agent observes.

Verified baseline (beyond the issue): the failed-log read passes `maxBuffer: CI_FIX_LOG_MAX_BUFFER` (65,536) to Node `execFile` through `makeProductionGh`. A child writing 127,189 bytes under that limit rejects with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` (reproduced locally with Node's promisified `execFile`), so for the issue's 127,189-byte log `enrichCiFixHint` records `log-unavailable` and adds no excerpt at all. The fix must therefore raise the read limit as well as change which lines are kept.

Approach chosen: raise the read limit to a few MiB, then build each excerpt from failure-marker lines (generic CI and test-runner markers plus the `[ci-progress]` failure records from #3076) followed by the log tail, falling back to the tail alone when no marker matches. Rejected: tail-only (drops an early first failure when a long trailing step follows it); head-plus-tail (the head is the setup noise the issue reports); reading per-job logs or test-report artifacts (Vitest- and API-specific, not usable for consumer repositories whose CI is not Vitest).

Event spine: not applicable as a new channel. Degradations keep flowing through the existing `deps.diagnostic` `log-enrichment` stage in `daemon-ci-fix.ts`; no new occurrence, ledger, or sidecar is introduced (`.agents/skills/event-spine/SKILL.md`).

Scope check: engine code under `src/conductor/src/engine/`, shipped to every repository that runs the daemon's CI-fix; no rule, doc, or skill placement and no provider-specific behavior.
