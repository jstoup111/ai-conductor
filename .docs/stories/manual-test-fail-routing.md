# Stories: manual-test-fail-routing (ai-conductor#367)

**Status: Accepted**
**Track:** technical · **Tier:** M · **ADR:** adr-2026-07-06-manual-test-fail-routing.md

---

## Story 1 — manual_test is a gating step

As the engine, I refuse to advance past a failing manual test, in every mode.

- **Happy:** Given `manual_test` in the step topology, When the topology is built, Then its
  enforcement is `gating`, `isGatingStep('manual_test')` is true, and the SKILL.md
  frontmatter (`enforcement: gating`) and `steps.ts` agree.
- **Negative (auto-skip closed):** Given an auto-mode non-daemon run where manual_test fails
  all retries, When the failure routing runs, Then the step is NOT auto-skipped (the
  advisory branch no longer applies) and the run HALTs with the manual_test reason.
- **Negative (recovery skip refused):** Given an interactive run with retries exhausted,
  When the recovery menu returns `skip`, Then the skip is refused (existing gating-step
  recovery contract now covers manual_test).

## Story 2 — enforcement cannot be downgraded from outside

As the engine, I ignore attempts to soften manual_test back to advisory.

- **Happy:** Given `manual_test` in `ENFORCEMENT_LOCKED_STEPS`, When a project-local skill
  override declares `enforcement: advisory` for manual-test, Then the resolved enforcement
  is still `gating`.
- **Negative (config disable rejected):** Given a project config with manual_test disabled,
  When the config loads, Then validation fails with the existing "Cannot disable gating
  step" error (and the CHANGELOG Migration note tells consumers to remove the disable).

## Story 3 — daemon kickback manual_test → build with FAIL evidence

As the daemon, when a manual test keeps failing I send the work back to build with the
evidence, instead of retrying manual_test into whitewash or halting uselessly.

- **Happy:** Given a daemon run where manual_test exhausts step retries with FAIL rows in
  the results file, When failure routing runs, Then a `kickback` event (from `manual_test`,
  to `build`) is emitted, `build` is re-opened via `navigateBack`, the retry hint handed to
  build contains the FAIL rows, manual_test is restaged `stale`, and the loop continues at
  build (no HALT yet).
- **Happy (bounded):** Given the kickback has fired `MAX_KICKBACKS_PER_GATE` times, When
  manual_test fails again, Then the run HALTs with a reason naming the exhausted self-heal
  budget and the surviving FAIL rows.
- **Negative (non-FAIL failure not routed):** Given manual_test failed for a non-FAIL reason
  (missing or stale results file — the skill never ran properly), When failure routing runs,
  Then the kickback to build does NOT fire (there is no bug evidence to hand build) and the
  run HALTs with the gate's own reason.
- **Negative (interactive unaffected):** Given a non-daemon run, When manual_test exhausts
  retries, Then no automatic kickback fires (recovery menu/HALT as per Story 1).

## Story 4 — whitewash guard: FAIL→PASS requires new commits

As the completion gate, I refuse a results file that flips FAIL→PASS while HEAD never moved.

- **Happy (fix accepted):** Given the gate observed FAIL rows at sha A and recorded the fail
  evidence marker, When a later check sees a FAIL-free fresh results file and HEAD ≠ A, Then
  the gate passes and the marker is cleared.
- **Negative (whitewash refused):** Given the marker records sha A, When a later check sees
  a FAIL-free results file and HEAD = A, Then the gate returns not-done with a reason
  naming the whitewash guard (no new commits since the recorded FAIL).
- **Happy (marker lifecycle):** Given the gate sees FAIL rows, When it evaluates, Then it
  writes/refreshes `.pipeline/manual-test-fail-evidence.json` with the current HEAD sha and
  an excerpt of the FAIL rows, and still returns the existing FAIL-rows reason.
- **Negative (stale marker ignored):** Given a marker whose `observedAt` predates this
  conductor session, When the gate evaluates a FAIL-free file, Then the stale marker is
  ignored (no false refusal from a previous feature/session) and cleaned up.
- **Negative (no git → fail-open):** Given `getHeadSha` is absent or returns null (test
  envs, no repo), When the gate evaluates, Then the whitewash guard is skipped entirely and
  pre-change behavior is preserved.

## Story 5 — injectable HEAD seam

As a test, I can drive the whitewash guard without a real git repo.

- **Happy:** Given `CompletionContext.getHeadSha` is provided, When the manual_test gate
  runs, Then HEAD is read only through the seam (no direct child_process in artifacts.ts).
- **Happy (production wiring):** Given the conductor builds the completion context, When a
  real run evaluates gates, Then `getHeadSha` resolves `git rev-parse HEAD` in the project
  root and returns null (never throws) on any git error.

## Story 6 — append-only per-attempt results

As the manual-test skill and gate, we preserve attempt history so a retry cannot erase what
attempt 1 found, and an old FAIL cannot block a real fix forever.

- **Happy:** Given the skill runs a second attempt, When it records results, Then it appends
  an `## Attempt N — <timestamp>` section (SKILL.md contract) instead of overwriting.
- **Happy (gate reads latest):** Given a results file with attempt sections where attempt 1
  has FAIL rows and attempt 2 (after a fix commit) is FAIL-free, When the gate evaluates,
  Then only the LATEST attempt section determines FAIL detection and the gate passes
  (subject to Story 4's sha check).
- **Negative (back-compat):** Given a results file with no attempt sections (old format),
  When the gate evaluates, Then the whole file is scanned for FAIL rows exactly as today.
- **Negative (latest attempt FAILs):** Given attempt 2 is the latest and contains FAIL rows,
  When the gate evaluates, Then it returns the FAIL reason even though attempt 1 was clean.

## Story 7 — docs track the feature

- **Happy:** Given the change ships, Then README.md ("Daemon manual-test routing" alongside
  the prd-audit routing docs), src/conductor/README.md (gate + kickback + whitewash guard),
  skills/manual-test/SKILL.md (append-only attempts + whitewash-guard contract), and
  CHANGELOG `[Unreleased]` (Changed/Fixed + `## Migration` note for the config-disable
  break) are all updated in the same PR.
