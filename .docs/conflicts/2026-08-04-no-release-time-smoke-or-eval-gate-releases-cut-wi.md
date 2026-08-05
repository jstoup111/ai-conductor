# Conflict Report: Release-Time Smoke and Eval Gate

**Date:** 2026-08-04
**Feature:** no-release-time-smoke-or-eval-gate-releases-cut-wi (jstoup111/ai-conductor#1259)
**Stories checked:** 5 new, against all accepted stories in `.docs/stories/`
**Result:** PASSED — 0 blocking, 2 degrading (both resolved)

## Scope of the scan

All five conflict types (contradiction, behavioral overlap, state conflict, resource contention,
sequencing) were evaluated pairwise across the five new stories and against every accepted story
that touches a contended surface. Story files reaching those surfaces, found by content search:

- `daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md` (#1124) — the live workflow this feature calls
- `ci-test-suite-workflow.md` (#318) — authored `ci.yml`
- `ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md` (#630) — the deterministic fixture
- `codex-fresh-session-per-step-contract.md` (#927) — depends on the codex smoke gate

---

## Conflict 1: Two layers both enforce the missing-credential failure

**Stories involved:** ST-1124-5 "Missing credentials skip when advisory and fail when gating"
vs new "Every smoke file declares the capability it requires"
**Files:** `.docs/stories/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md:155-175` vs
`.docs/stories/no-release-time-smoke-or-eval-gate-releases-cut-wi.md` (Story 2)
**Type:** behavioral overlap
**Severity:** degrading

**Description.** ST-1124-5 places the gating credential check at the *workflow* level: the
`Check live-provider credentials` step in `live-daemon-e2e.yml` fails "before any provider
dispatch, naming the missing secret." The new capability story places an equivalent check at the
*test-runner* level: gate mode fails when a `credentialed` capability is unmet. Both fire on the
same underlying condition, so a release blocked by a missing token could produce two different
failure messages depending on which layer trips first.

This is not a contradiction — both demand failure, neither permits a silent pass — but undefined
precedence would make the failure output ambiguous, which works against DO-5 (attributability).

**Resolution options.**
1. Keep both, with explicit non-overlapping authority: the workflow step owns the reusable live
   workflow's own entry point; the capability helper owns `npm run smoke`. Document which fires
   where.
2. Remove the workflow-level check and rely solely on the capability helper.
3. Remove gate mode from the helper and rely solely on the workflow step.

**Recommendation: Option 1 — ADOPTED.** Option 2 would edit a shipped, APPROVED contract
(ST-1124-5) for no functional gain. Option 3 would leave `npm run smoke` unable to fail on a
missing credential, breaking DO-6 for every entry point except the live workflow. The two checks
guard genuinely different entry points, so keeping both is defense in depth rather than
duplication. Precedence is deterministic in practice: the workflow step runs first and exits
before the runner starts, so on the release path its message is the one the operator sees.

---

## Conflict 2: Retiring the per-file kill-switch variables changes a shipped contract

**Stories involved:** new "Every smoke file declares the capability it requires"
vs ST-1124-5 (#1124) and `codex-fresh-session-per-step-contract.md` (#927)
**Files:** `.docs/stories/no-release-time-smoke-or-eval-gate-releases-cut-wi.md` (Story 2,
"Done When" item 2) vs `.docs/stories/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md:155-175`,
`.docs/stories/codex-fresh-session-per-step-contract.md:158`
**Type:** resource contention
**Severity:** degrading

**Description.** Story 2 as first written required that the seven per-file variables "no longer
gate execution." Two of them are load-bearing in already-accepted specs:

- `DAEMON_E2E_LIVE_SMOKE=0` is the documented operator affordance for disabling an otherwise
  credentialed local run (`docs/contributing/testing.md:85`), and ST-1124-5 specifies the
  `describe.skipIf` idiom it implements.
- `CODEX_CLI_SMOKE_TEST=1` is cited by #927's stories and its architecture review as the existing,
  relied-upon gate for the codex smoke lane.

Deleting the *capability* those variables provide — an operator's ability to force a skip on a
machine that would otherwise qualify — removes a documented affordance from shipped work. The
capability enum replaces *detection* (what does this file need?), but it does not by itself replace
*override* (I have the credential and still do not want to spend it right now).

**Resolution options.**
1. Retain the override concept behind one uniform mechanism, and retire only the nine bespoke
   spellings.
2. Retain all seven variables exactly as they are, adding capability declaration alongside.
3. Delete the override concept entirely.

**Recommendation: Option 1 — ADOPTED.** Option 2 keeps the inconsistency the feature exists to
remove and leaves nine spellings to maintain. Option 3 silently removes an affordance shipped specs
depend on, and would force a developer with a valid token to spend it on every local smoke run.
Option 1 preserves the behavior both prior specs rely on while still collapsing nine conventions
into one.

**Applied resolution.** A single uniform override is recognized by the capability helper, allowing
a forced skip by capability or by file. In advisory mode a forced skip is reported as `skipped
(operator override)`; in gate mode a forced skip of a `credentialed` capability is a **failure**,
so the override can never be the reason a release passes. Story 2 has been amended in place with an
additive note; `docs/contributing/testing.md` documents the replacement spelling for each retired
variable.

---

## Not conflicts

- **The ~24 spec branches `overlap-scan` flagged on `.github/workflows/release.yml`.** These are
  stale or already-merged spec branches whose diff is computed against an older base; the substantive
  one (#1124's) is already merged into this feature's base and is handled above. Advisory signal
  only — no story-level contradiction exists.
- **`ci-test-suite-workflow.md` (#318).** It owns `ci.yml`. This feature leaves `ci.yml` unchanged
  by explicit decision (adr-2026-08-04-classify-before-spend-release-smoke-gate), so the two never
  write the same surface.
- **`ci-needs-a-daemon-end-to-end-smoke-step-drive-a-1-.md` (#630).** Owns the deterministic
  provider-fake fixture, which runs inside `npm test`. This feature neither moves it nor changes its
  exclusion status.
- **Sequencing.** The three new production surfaces have a strict, acyclic order — capability
  helper precedes the entry point, which precedes the workflow wiring; classify precedes the
  workflow wiring. No story assumes it runs first against another that assumes the same.
- **State.** Advisory-vs-gate is a single mode with two values, and capability is a closed enum, so
  no combination of the new stories produces an ambiguous or impossible run state.
