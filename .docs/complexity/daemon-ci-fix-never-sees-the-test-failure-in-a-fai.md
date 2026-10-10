# Complexity: CI-fix log excerpt carries the failure, not the setup output

Tier: S

Rationale: One local change inside an existing function, with no new state, event, schema, config,
or CLI surface:

1. `enrichCiFixHint` in `src/conductor/src/engine/ci-fix.ts` replaces its head-only
   `truncateUtf8(stdout, 12_288, ...)` call with a pure excerpt builder (failure-marker lines, then
   the log tail, tail-only fallback) under the same 12,288-byte per-run budget.
2. `CI_FIX_LOG_MAX_BUFFER` is raised so a log larger than 64 KiB is read instead of rejected by
   Node's `execFile` `maxBuffer` limit (verified: a 127,189-byte child output under the current
   65,536-byte limit rejects with `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`).

The only caller (`daemon-ci-fix.ts`) and the `log-enrichment` diagnostic stage are unchanged. Tests
extend the existing `src/conductor/test/engine/ci-fix.test.ts` enrichment suite. No ADR,
architecture review, conflict check, or coherence check is required at Tier S.
