# Conflict Report: enable-single-repo-daemon-concurrency-un-clamp-the

**Date:** 2026-08-27
**Corpus:** change-set ADRs (adr-2026-08-27-daemon-dispatcher-executor-seam + the eight ADRs it
amends) and the full `.docs/stories/` corpus (daemon dispatch/lifecycle/park/restart/refresh/
live-boundary/logging candidates read in full; clean areas listed at the end).
**Result after resolution:** zero blocking conflicts remain. Degrading interactions accepted with
mitigations recorded below.

Foreign-stem story replacements cannot ride a spec branch (engineer land stem gate), so all
superseded-story rewrites ship as a companion main-based PR, referenced from the spec PR.

## Conflict 1 (blocking, resolved): FR-13 pins the clamp as a forward guarantee

**Stories involved:** new Story 1 vs `daemon-supervised-hosting.md` "A daemon builds one feature at a time" (FR-13)
**Type:** contradiction (both directions)
**Resolution:** replace the FR-13 story in place (companion PR) — the guarantee becomes "at the
default concurrency of 1 the daemon builds one feature at a time; the operator may raise
concurrency explicitly". The pinned test `daemon-concurrency-clamp.test.ts` is replaced by the
resolver test in this feature's BUILD (plan task).

## Conflict 2 (blocking, resolved): "the refresh chain never runs mid-build"

**Stories involved:** new Story 6 vs `daemon-stale-engine-origin-advance.md` (TI-1)
**Type:** contradiction + sequencing
**Resolution:** split the old assertion in place (companion PR): the rebuild/restart half survives
under drain-then-act; the fetch/fast-forward half is superseded by pinned-base refresh
(adr-2026-08-27 D4/D5, and the amendment note already on
adr-2026-07-22-origin-refresh-before-engine-rebuild).

## Conflict 3 (blocking, resolved): mid-build fast-forward vs unproven-containment fail-closed

**Stories involved:** new Stories 6/8 vs `live-boundary-halts-self-host-builds-when-the-oper.md`
Stories 2–3 and `live-boundary-guard-cannot-attribute-a-live-checko.md` Story 5
**Type:** contradiction + state conflict
**Resolution:** resolved inside this feature's own stories (no foreign edit needed): when any open
fingerprint window belongs to an executor whose containment is unproven, dispatcher root mutations
are DEFERRED until no such window is open — attribution never substitutes for fail-closed there.
Deferral happens at provider-dispatch gaps, so it does not require a full drain. New criteria added
to Stories 6 and 8.

## Degrading interactions (accepted, with mitigations)

- **F4 — process-wide tee attribution** (`daemon-log-feature-tags-254.md` negative path): the old
  "process-wide diagnostics carry no feature tag" assertion is superseded for feature-owned
  warnings; replaced in the companion PR. New Story 9 keeps the no-false-attribution negative for
  genuinely global lines.
- **F5 — closed dispatch entry-point enumerations** (`park-all-dispatch-paths.md` Story 3,
  `park-in-flight-features-at-step-boundaries-after-p.md` Story 8): the set literal gains the
  dispatcher claim path; the tests fail loudly by design until BUILD updates them (new Story 4
  Done-When). Companion PR updates the stale set literal.
- **F6 — episode gate on restarts**: resolved in this feature's Story 7 — drained-boundary
  restarts still defer while a rate-limit episode is active.
- **F7 — all-or-nothing leak heal starves at N>1**: accepted; new Story 6 requires the loud
  refusal with the dirty-entry list. Multi-candidate triage is recorded future work in the seam
  ADR's consequences.
- **F8 — reap paths and live claims**: resolved in this feature's Story 5 — worktree-removal
  predicates consult the claim registry (adr-2026-08-27 D3 liveness) and refuse on an active claim.
- **F9 — singular "which feature it is waiting on"** (`2026-07-04-daemon-lifecycle-controls.md`
  FR-9): status reports the drain set at N>1 (new Story 7 criterion); the old singular phrasing is
  replaced in the companion PR.
- **F10 — SIGTERM force-release timeout**: resolved in this feature's Story 7 — the bound scales
  per in-flight executor so a routine drain never force-releases the lock under running builds.
- **F11 — `base-moved` setup reason** (`bin-setup-re-runs-on-every-dispatch-instead-of-onc.md`
  Story 2): "resolved base SHA" is redefined as the work order's pinned base (amendment note
  already on adr-2026-08-26-setup-once-per-worktree-marker D2); story sentence replaced in the
  companion PR.

## Watch items (no story change)

- OTel per-dispatch visualizer flushes at N=2 share process-global SDK state — covered by adding
  an N=2 case to the existing EVENT_SINKS parity test (plan task), not by a story rewrite.
- "Claim" terminology collision: intake-ledger claims (`engineer claim`) vs the new dispatch
  `WorkClaims` — naming note for the plan; no behavioral conflict.

## Examined and clean

Rate-limit coordinator/jitter/SIGTERM N>1 stories (supportive), provider-scratch lease stories,
event-driven wake dedup, pause-gates-every-dispatch-path, daemon lock drain stories, park-marker
placement stories, mid-loop-wipe guards, config consumer-registry stories, dependency-ordered
dispatch (claim-order preserved; pinned by the serial-equivalence test), live-boundary containment
probe/bind-set stories, codex concurrent task attribution, log-noise suppression scoping,
priority-banded intake claim (different domain).
