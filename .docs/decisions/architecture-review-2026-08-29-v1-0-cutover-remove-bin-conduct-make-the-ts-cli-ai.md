# Architecture Review: v1.0 cutover — remove bin/conduct, make the TS CLI the only CLI
**Date:** 2026-08-29
**Stories reviewed:** none yet (pre-stories DECIDE review, technical track, Medium tier — lightweight mode)
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility** — pure removal + shell/docs edits; no new dependencies. The TS CLI
  already implements the surviving operator surface (verified 2026-08-29:
  `--resume --status --from --cleanup --reset --cooldown --interactive` wired in
  `src/conductor/src/index.ts`; `--update`/`--set-channel` live in `bin/update` per #220).
- **Prerequisites** — all gates CLOSED: #220 (update flow), #221 (check_harness_config),
  #222 (rate-limit hook), #223 (CI), #224 (worktree test port), #225 (inline field test).
  PR #2023 already made `bin/ai-conductor` the canonical launcher with `conduct-ts` as a
  deprecation-window alias; this feature completes the cutover the governing ADR defers to #226.
- **Integration surface** — `bin/install` (symlink swap), `bin/conduct` + dedicated tests
  (deletion), `test/test_no_legacy_cli_references.sh` (guard extension),
  `test/test_harness_integrity.sh` (MUST drop its bin/update↔bin/conduct tagged-update-parity
  assertions — they hard-fail once bin/conduct is gone), `bin/lib/harness-common.sh` (stale
  header comments), forward-facing docs/skills.
- **Data implications / performance** — none.
- **Worktree isolation** — file edits only; no shared services or ports.
- **Release gate** — the self-host release classifier names `bin/conduct CLI` a canonical
  breaking surface, so the PR body MUST carry a real `## Migration` block (re-symlink
  `~/.local/bin/conduct`, verify build). This is a genuine behavior change — a waiver would be
  wrong. `Release-Disposition: note`, `Release-Category: Removed`, `Release-Semver: major`.
  No VERSION/CHANGELOG edits (bot-owned release PR).

## Alignment

- **Governing ADR (reused, not duplicated):**
  `adr-2026-08-26-music-vocabulary-player-composer-rename` (APPROVED) — decision 3 explicitly
  defers `bin/conduct` removal and the installer cutover to #226 "which targets `ai-conductor`
  as the surviving binary"; decision 4 ("aliases never own a second implementation") governs the
  new `conduct` alias: a symlink to `bin/ai-conductor`, never a forwarder script. The ADR's
  compatibility boundary ("exactly three seams") gains a fourth seam — the `conduct` binary
  alias — recorded as an amendment note on the ADR (additive, original preserved).
- **Canonical breaking-surface names** (`bin/conduct CLI` in `release-gate.ts`
  `CANONICAL_BREAKING_SURFACES`, PR template, AGENT_INSTRUCTIONS) are machine-matched contract
  strings, NOT forward-facing prose — they stay unchanged per the operator's scope boundary.
  Renaming them rolls into the behind-the-scenes rename intake.
- **Pattern consistency** — the alias-window symlink pattern from PR #2023 is the local
  precedent: installer-managed `~/.local/bin` symlink onto `bin/ai-conductor`, invoked-name
  deprecation warning via `$0` basename check in the launcher (bin/ai-conductor resolves its
  real path with `readlink -f`). The `conduct` alias replicates exactly this; allowed variation:
  the warning text names `conduct` instead of `conduct-ts`. Rediscovery seeds:
  `bin/ai-conductor` ($0 basename check), `bin/install` step 3/3b symlink blocks,
  `test/test_ai_conductor_launcher.sh`.
- **Guard precedent** — `test_no_legacy_cli_references.sh` polices `conduct-ts` mentions with an
  explicit allowlist; extending it to police `bin/conduct` mentions follows its existing shape
  (scanned-set + case-allowlist), keeping the deletion mechanically dead.

## Domain Integrity
N/A (no domain model changes). Skipped per lightweight mode.

## Wiring Surface

| New/changed production surface | Called from |
|---|---|
| `~/.local/bin/conduct` symlink → `bin/ai-conductor` | created/updated by `bin/install` step 3 (replacing the bash-conduct symlink block); resolves through the existing launcher to `src/conductor/dist/index.js` |
| `conduct` deprecation warning | `bin/ai-conductor`'s existing invoked-name (`basename "$0"`) check, extended to recognize `conduct` |
| Extended legacy-reference guard | `test/test_no_legacy_cli_references.sh`, run by CI (#223) and `test/test_harness_integrity.sh`'s suite |
| Installer hard-requirement path | already-shipping `fail "conduct-ts not installed …"` tail in `bin/install` — unchanged, re-asserted by tests |

Overlap scan run (advisory): every long-lived spec branch matches on these hot paths
(`bin/install`, integrity suite) because their merge-bases predate recent churn — noise, no
actionable collision; `bin/conduct` deletions conflict trivially (whole-file delete wins at rebase).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Integrity-suite parity checks (bin/update↔bin/conduct) fail after deletion | Technical | Certain if missed | Medium | Explicit story/task to remove those assertions in the same diff |
| Operator boxes keep a dangling `~/.local/bin/conduct` symlink until re-install | Integration | High | Low | `## Migration` block re-runs `bin/install`; symlink swap is idempotent |
| A doc/skill still instructs invoking bash-conduct behavior (`--log`, `--step`, `--auto`) | Knowledge | Medium | Low | Reference sweep + extended guard test fail CI on regression |
| Deleting bin/conduct + rewriting its tests in one diff trips the testQuality counterfactual restore | Technical | Low | Medium | Single-file deletions restore cleanly (the #1961 failure needs a deleted *directory*); no directory is deleted here |

## ADRs Created
None. Reused `adr-2026-08-26-music-vocabulary-player-composer-rename` with one additive
amendment note (fourth alias seam). No uncovered structural decision remains.

## Conditions
None.
