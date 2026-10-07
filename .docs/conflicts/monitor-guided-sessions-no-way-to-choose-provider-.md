# Conflict Check: Monitor guided sessions — choose provider, model, and effort

**Date:** 2026-10-06
**New stories:** `.docs/stories/monitor-guided-sessions-no-way-to-choose-provider-.md` (Stories 1–10)
**ADR corpus:** `change_set` (the default; `conflict_check.adr_corpus` unset). That is
`adr-2026-10-06-catalog-owned-interactive-model-and-effort` (APPROVED), plus the ADRs it builds on, compared
for the decisions they share with these stories:
`adr-2026-09-24-built-in-provider-catalog-and-boot-discovery` (D2, D9, D10) and
`adr-2026-09-20-operator-launched-sessions-retain-conductor-authority` (D3, D4, D5, D8).
**Result:** PASSED: 0 blocking, 0 degrading.

## Candidate set

The 550 story files were filtered for the surfaces these stories touch: interactive launch, guided
sessions, `CONDUCT_ENGINEER_PERMISSION_MODE`, `--permission-mode`, the unregistered-provider refusal,
the launch seam, and monitor provider resolution. 7 files matched, and each was compared pairwise in both
directions:

| Existing story | Shared surface | Verdict (both directions) |
|---|---|---|
| `monitor-daemon-halts-through-a-guided-resolution-q.md` Story 12 | Guided session opens in "the operator's configured provider". Unknown provider is reported at start. A missing binary is reported per item and the monitor stays active. No terminal means refuse. | Compatible. With no guided-session provider set, the new Story 1 resolves to the same provider as today (the first build-selection entry), so Story 12 holds unchanged. When one is set, it *is* the operator's configured provider for guided sessions. The unknown-provider (new Story 8), ENOENT-per-item (new Story 8 negative 3), and no-terminal (new Story 10 negative 3) assertions are preserved verbatim, not altered. |
| `compose-launcher-honors-llm-provider-for-codex.md` | Composer argv: Claude `--permission-mode default /composer`. Codex has exactly one positional prompt and no model flags. `CONDUCT_ENGINEER_PERMISSION_MODE=plan` gives `default`. Pi is refused naming `interactiveLaunch` and #1007. | Compatible. New Story 10 pins the composer argv byte-for-byte and ADR D1 passes no model/effort for the composer, so "no model flags" still holds. The Pi refusal wording in new Story 8 matches. |
| `pi-as-a-build-provider.md` | Pi fails before spawn on a path requiring `interactiveLaunch`. Claude/Codex step-dispatch argv is unchanged. | Compatible. The new stories refuse Pi identically and do not touch adapter dispatch argv. |
| `pi-runs-stay-contained-despite-pi-having-no-permis.md` | Pi `interactiveLaunch` capability is false. | Compatible. It is unchanged here. |
| `daemon-merged-config-967.md` | Provider selection merged from user and project config; an unregistered provider is rejected before dispatch. | Compatible. New Story 9 validates the guided-session provider through the same config-load path. |
| `engineer-cli-subcommand-help-executes-the-command.md` | Bare interactive composer launch path | Compatible. Its launch semantics are unchanged (new Story 10). |
| `pi-runs-report-token-usage-and-cost-into-harness-t.md` | Matched only on "model" (Pi usage attribution) | No shared behavior. |

## ADR-versus-story comparison

- **adr-2026-09-20 D8** (composer exempt from the seam) vs new Story 10: compatible. Story 10 shares the
  *definition*, not the seam, and the composer keeps its own spawn.
- **adr-2026-09-20 D4** (seam reachable only from a foreground command with an attached terminal) vs
  new Stories 1–8: compatible. All launches still go through the seam from `conduct monitor`.
- **adr-2026-09-24 D9** (Pi refused, naming `interactiveLaunch` and #1007) vs new Story 8: compatible.
- **adr-2026-09-24 D10** (composer host selection uses the `explore` step's provider) vs new Story 4
  (guided-session defaults ignore a project's `explore` pin): different surfaces. D10 governs the
  composer's *host* selection. Story 4 governs the monitor's *model/effort defaults*, and the APPROVED
  `adr-2026-10-06-catalog-owned-interactive-model-and-effort` D4 explicitly states that guided triage
  does not follow a DECIDE pin. Neither statement constrains the other's surface.

## Oscillation check

The one same-gate pair is Story 10's "the monitor uses permission mode `default` regardless of the env"
and the compose story's "`CONDUCT_ENGINEER_PERMISSION_MODE=plan` gives `default`". If either is fully
satisfied, the other still holds, because ADR D1 makes the permission mode an explicit per-caller input.
There is no oscillation.

## Conflicts

None.
