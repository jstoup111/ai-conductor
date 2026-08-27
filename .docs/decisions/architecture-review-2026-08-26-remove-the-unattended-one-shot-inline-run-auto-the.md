# Architecture Review: remove the unattended one-shot inline run (--auto remnants)
**Date:** 2026-08-26
**Stories reviewed:** none yet (pre-stories DECIDE review; input = explore output + technical intent, #1436)
**Mode:** Lightweight (tier M, technical track)
**Verdict:** APPROVED

## Feasibility

- **Stack:** pure removal/edit within existing TS + bash + Markdown surfaces; no new deps. Verified.
- **`deriveMode` dead arm** (`src/conductor/src/index.ts:22`): provably unreachable —
  `process.exit(1)` fires at `:20` on any `--auto`. Free to delete (verified). Direct tests of the
  deprecation exist at `src/conductor/test/cli/mode-derivation.test.ts:23,50` and must be triaged
  per `skills/code-removal` (kept — they pin the surviving rejection behavior; only assertions on
  the removed arm change).
- **Engine `'auto'` branch audit:** every `this.mode === 'auto'` branch in
  `src/conductor/src/engine/conductor.ts` (sites at 6212, 9361, 9405, 9430, 9589, 9836, 10807,
  11070, 12164 at this HEAD) is reachable from daemon dispatch — `daemon-cli.ts` constructs the
  Conductor with `mode: 'auto'` at five sites (1002, 1023, 1213, 1863, 1954) — and there is **no**
  `mode === 'auto' && !this.daemon` branch anywhere (verified by grep + read). Four APPROVED ADRs
  pin these branches as daemon contract (see Alignment). The audit story therefore **records
  evidence and deletes no engine branch**; its deliverable is the recorded classification, plus a
  grep-pass over `'auto'` string literals mirroring the discipline of
  `architecture-review-2026-08-26-hard-delete-the-retired-wiring-check-step-name-fro`
  (partial maps need an explicit grep pass — most of the issue's 55 hits are unrelated
  `ReviewMode`/park-provenance/config coincidences).
- **Examples retirement:** `examples/inline.sh` currently runs `conduct-ts inline "<prompt>"
  --auto` (line 27), which now always exits 1 — the shipped example is broken today. Removing it
  plus its `examples/README.md` row and `test/test_examples_inline.sh` (and inline references in
  `test/test_examples_common_*.sh`, which use inline.sh as their fixture) touches no isolation seam.
- **Rejection message:** appending the docs path to the existing error string in
  `deriveMode` is a one-line change; `docs/guides/running-the-daemon.md` exists.

## Alignment

Governing APPROVED ADRs (repo-wide sweep, 513 files):

**Pin the engine branches (deletion forbidden):**
- `adr-2026-07-10-validation-group-join` — validation fan-out gates on `mode === 'auto'`
  (:6212) and checkpoint pause on `mode !== 'auto'` (:11070); both are the ADR's mechanism.
- `adr-2026-08-03-fail-closed-decide-entry` — complexity computes in-process under
  `mode: 'auto'`, "the daemon's mode" (:12164 is the daemon's tier-resolution path).
- `architecture-review-daemon-autonomous-runs-must-fail-closed-on-any-amb` — assumption A3
  relies on the :12164 short-circuit.
- `adr-2026-08-26-remove-retrospectives-one-shot` — the advisory auto-skip (:9836) is
  explicitly retained for config-declared custom steps.

**Amended in this pass (additive notes, originals preserved):**
- `adr-2026-07-22-headless-vs-guided-examples` — headless-capable list no longer includes
  `inline --auto`.
- `adr-2026-08-01-engine-owned-resumable-finish-publication` — "foreground automatic mode"
  is unreachable from the CLI; its policy survives as daemon-dispatched behavior only.

**Complied with (no change needed):** `adr-2026-07-22-examples-state-isolation` (surviving
examples keep the seam), `adr-2026-07-21-serena-removal-path` (the rejecting flag is the
"inert shield" — kept, only its text re-pointed), `adr-2026-08-22-one-owner-per-review-question`
(no absence tests; evidence = deletion diff + green surviving suite),
`adr-2026-08-11-deprecated-no-op-step-retirement` (explicitly not applicable: its two-phase
contract covers engine steps, and a CLI flag has none of those surfaces),
`adr-2026-07-07-audit-trail-event-sink` (inline entry survives as `--interactive`/default —
the sweep must not prune inline-mode wiring), `adr-005-non-autonomy-and-read-only-governor`.

**Release surface:** per `adr-2026-08-01-scoped-run-verb-release-surface`, nothing under
`src/conductor/` or `examples/` trips the canonical breaking surfaces; the behavioral break
shipped in #1509. Expected disposition: note/Removed/patch, no migration block (verify at PR
time rather than pre-author one).

**No ADR governs:** `dangerouslySkipPermissions`-vs-mode, checkpoint skipping as a concept,
`deriveMode`/CLI flag contracts, or the `RunMode` union itself. Verified no-fit; no exemplar
invented.

## Wiring Surface

No new production surface is introduced — this feature only removes or edits existing ones:
- `deriveMode` (`src/conductor/src/index.ts`) — already wired into the `inline` command
  dispatch in `cli.ts`/`index.ts`; its rejection text changes, callers unchanged.
- `examples/inline.sh` + `test/test_examples_inline.sh` — deleted; `examples/README.md` and
  `test/test_examples_common_*.sh` re-pointed at surviving flows (daemon example remains the
  unattended demo, consumed by `test/test_examples_daemon.sh`).
- Docs pages edited in place (`docs/quickstart.md`, `docs/reference/cli.md`,
  `docs/reference/steps.md`, `examples/README.md`); no page added or removed, so the
  browsable-docs navigation contract is untouched.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Audit misclassifies a daemon-live branch as dead and deletes it | Technical | Low | High | Hard rule in stories/plan: deletion requires `mode === 'auto' && !this.daemon` gating, which zero branches have; expected engine deletion set is exactly the deriveMode arm |
| `test_examples_common_*.sh` use inline.sh as their shared fixture; deleting it breaks the common suites | Technical | Medium | Medium | Re-point common tests at a surviving example (or an inline fixture) in the same diff; full `test/test_harness_integrity.sh` before commit |
| Docs still advertise the one-shot somewhere unswept | Integration | Low | Low | Repo-wide grep for `inline --auto`/`--auto` in docs/, README, HARNESS.md as an acceptance criterion |

## ADRs Created

None — no uncovered structural decision. Two existing APPROVED ADRs amended additively
(listed under Alignment); no ADR superseded.

## Conditions

None.
