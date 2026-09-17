# Conflict Check: Guided setup walks the operator through project and operator configuration

**Date:** 2026-09-14
**Feature:** bootstrap-register-never-walk-the-user-through-use (jstoup111/ai-conductor#2218)
**ADR corpus:** `repo_wide` (from `conflict_check.adr_corpus`)
**Inventory:** all story files under `.docs/stories/` (keyword scan over onboarding, project/user configuration writing, operator identity, test-suite command, and registry-command surfaces narrowed semantic comparison to 20 files, 6 read in full); the approved PRD; all 585 `.docs/decisions/` entries via the pre-stories repo-wide sweep, narrowed to the 10 ADRs and reviews whose decisions address these surfaces; prior conflict reports consulted for the config-writer and owner-identity families.
**Result:** **PASS — zero blocking conflicts.** One degrading intra-feature overlap was found and resolved in place. No degrading conflict is accepted as a compromise.

## Conflict: Empty identity answer re-asks forever while another story lets the operator decline

**Stories involved:** Story 4 "Establish operator identity during onboarding" vs Story 5 "Say plainly when identity cannot be established"
**Files:** `.docs/stories/bootstrap-register-never-walk-the-user-through-use.md` (both)
**Type:** overlap
**Severity:** degrading
**Confidence:** 90% — Story 4's negative path rejected every empty answer and re-asked; Story 5 requires a path where the operator declines and onboarding finishes with identity unresolved. Read literally, an operator with nothing to enter could never reach Story 5's outcome. Tested both directions: satisfying Story 5 leaves Story 4 intact (an explicit decline is not an empty answer); satisfying Story 4 as first written did not leave Story 5 reachable. One direction fails, so this is an overlap, not an oscillation.

**Resolution Options:**
1. Reword Story 4's negative path so an empty submission is distinct from an explicit decline, and the re-ask restates the decline option.
2. Drop Story 5's decline path and require an identity to finish onboarding — contradicts FR-8 and FR-12.
3. Add a bounded retry count after which an empty answer is treated as a decline — new behavior no FR asks for.

**Resolution:** Option 1, applied in place (pure story phrasing; no upstream root). Story 4's negative now reads: "Given the operator submits an empty value to the identity question rather than explicitly declining it, when the answer is processed, then it is rejected, the question is re-asked with the decline option restated, and no identity is recorded."

## Examined pairs found compatible

Each pair was tested in both directions ("fully satisfy A — does B still hold?", then reversed).

| Existing artifact | Passage | New story | Finding |
|---|---|---|---|
| `test-suite-re-runs-and-re-passes-the-full-suite-10.md` (D8 stories) | "`config init` invoked with no verification flags … matches today's template output"; Done-When "SKILL.md documents the two questions and the auto-mode default" | Story 1, Story 2, Story 8 | Compatible. Story 2 and Story 8 keep flagless and unattended output byte-identical; the expanded question set is a superset, so "documents the two questions" remains satisfied. |
| `multi-operator-ownership-hardening.md` Story 2 | "a committed project `.ai-conductor/config.yml` containing a `spec_owner` key … the daemon does not start and authoring does not proceed" | Story 4 | Same direction. Story 4's negative asserts the committed-identity rejection is unchanged. |
| `config-keys-that-validate-but-have-no-consumer-inc.md` Story 4 | "Given `conduct-ts config set` writing the user-level conductor block … that path is unchanged" | Story 4 | Compatible. adr-2026-08-09 decision 6 adds one accepted path; the `conductor` path is untouched. |
| `daemon-owner-gate.md` "headless … behaves exactly as it does today when it cannot determine an owner … owner-gating is inactive" | pre-D3 fail-open wording | Story 5, Story 8 | Not a new conflict. That wording was superseded by adr-2026-07-01 D3 and `multi-operator-ownership-hardening.md`; the new stories align with the current approved decision. Pre-existing staleness in a shipped story is recorded here, not re-litigated. |
| `install-and-first-run-paths-give-misleading-or-mis.md` | provider/viewer selections persisted to `~/.ai-conductor/config.yml` | Story 4, Story 6 | Compatible. Different keys; both writers merge without touching other top-level keys. |
| `features/bootstrap/ST-026-project-scaffolding.md` | "Given the project already has CLAUDE.md and `.docs/`, when bootstrap runs, then it skips scaffolding" | Story 6 | Compatible. Re-run reports established configuration and skips; nothing rewritten. |

## ADRs examined (repo-wide) versus stories

Compared and found consistent: adr-003-registry-write-and-integration (no prompt added to `register`/`create` — Stories 1–8 never touch them); adr-2026-07-01-machine-scoped-operator-identity D1–D3 (Stories 4, 5, 8); adr-2026-07-27-project-config-scaffolder decision 3 and its rejected "have `/bootstrap` write the config" (Story 2 records through the writer only); adr-2026-08-28 D8 and the new D9 (Stories 1–3, 8); adr-2026-08-09 decisions 3 and 6 (Story 4); adr-2026-08-26 decision 4 (no new key — Story 7 explains existing keys only); adr-2026-08-01 (Story 3: recorded command is the aggregate command, never executed at recording time); adr-2026-08-09-conductor-block-single-source-of-truth; architecture-review-2026-06-25 and -2026-07-30. Narrowed out: the remaining approved ADRs, whose subjects (build-review rubrics, daemon scheduling, rebase, telemetry, release gates, sandboxing, memory providers) share no behavior, entity, field, or gate with these stories. Supersession parsing was applied at this scope; no partially superseded ADR in the examined set was excluded.
