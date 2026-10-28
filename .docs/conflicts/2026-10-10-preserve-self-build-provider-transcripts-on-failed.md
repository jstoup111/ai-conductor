# Conflict Check: Preserve self-host provider transcripts

**Date:** 2026-10-10
**New stories:** `.docs/stories/preserve-self-build-provider-transcripts-on-failed.md` (Stories 1–9)
**ADR corpus:** `repo_wide` (from `.ai-conductor/config.yml`)
**Result:** PASSED after resolution — 1 blocking conflict resolved, 0 degrading accepted.

## Scope

Stories scanned against all 575 files in `.docs/stories/`. Pairs examined in depth (both
directions) were the stories that assert behavior for self-host provider homes, scratch teardown,
the dead-owner sweep, self-host credentials, and `.pipeline` run state:
`interrupted-self-host-runs-leak-provider-homes-unt`, `harness-self-host-guardrails`,
`isolate-daemon-build-auth-from-operator-oauth`, `self-host-builds-isolate-and-fingerprint-pi-operat`,
`pi-as-a-build-provider`, `codex-safety-and-self-host-parity-907`,
`pi-runs-stay-contained-despite-pi-having-no-permis`, `generated-project-artifacts-delay-provider-startup`,
`unusable-provider-candidate-throws-instead-of-fall`.

ADRs examined (repo_wide, narrowed to the scratch/self-host subject):
`adr-2026-08-09-worktree-local-provider-scratch` (amended by this spec),
`adr-2026-08-04-live-tier-provisions-its-own-provider-home`,
`adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation`,
`adr-2026-06-30-self-host-detection-seam`, `adr-2026-10-10-retain-self-host-provider-transcripts`.
All other ADRs were narrowed out as unrelated to provider homes, transcripts, or run state.

## Conflict: Verbatim transcript capture persists secrets that FR-14 requires removed

**Stories involved:** Story 2 / Story 9 (this spec) vs "Keep safety diagnostics confidential"
**Files:** `.docs/stories/preserve-self-build-provider-transcripts-on-failed.md` vs
`.docs/stories/codex-safety-and-self-host-parity-907.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The existing story's NP-1 reads: "Given a provider error includes a token,
secret, authorization header, credential payload, sensitive configuration value, or raw diagnostic
body, when it crosses the safety boundary, then the sensitive content is removed before any
operator-visible or persisted output." As first written, Story 2 copied transcripts verbatim into
`.pipeline/transcripts/` and Story 9 printed them, so a transcript that recorded such an error
would persist and display it. Satisfying Story 2 verbatim breaks NP-1; satisfying NP-1 still
allows Story 2 if the capture is sanitized — a one-directional contradiction, not an oscillation.

**Resolution Options:**
1. Sanitize every captured line with the existing `redactSafetyText` before writing it.
2. Sanitize only on display in the reader (persisted files still violate NP-1).
3. Narrow FR-14 to safety-check diagnostics only (weakens an accepted safety story).

**Recommendation / chosen:** Option 1 (operator-approved 2026-10-10). Stories 2, 3, and 9 gained
redaction criteria; `adr-2026-10-10-retain-self-host-provider-transcripts` decision 3 and its
consequences were revised; the architecture review's risk register gained the echoed-secret risk.

## Examined, no conflict

- `interrupted-self-host-runs-leak-provider-homes-unt` Story 4 ("A normally completed attempt
  leaves nothing behind"): the scratch home and lease are still removed on every path, and a
  successful attempt's capture is pruned at its verdict, so steady state still accumulates nothing
  beyond capped failure evidence. Both directions hold.
- Same file, sweep stories: the sweep's reclaim decisions are unchanged; capture is added before
  reclaim and is best-effort.
- `self-host-builds-isolate-and-fingerprint-pi-operat` ("isolated home directory is removed …
  one-entry `auth.json` no longer exists on disk"): `auth.json` is never captured (Story 3), and
  the home is still removed.
- `generated-project-artifacts-delay-provider-startup` ("`live-boundary.ts` imports no event
  emitter"): this spec emits from the scratch/retention seams, not `live-boundary.ts`.

## Re-check

After applying option 1, the full set was re-checked: zero blocking conflicts, zero degrading.
