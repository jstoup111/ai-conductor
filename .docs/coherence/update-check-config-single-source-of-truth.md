# Coherence: Update-check config single source of truth (#1400)

**Date:** 2026-08-09
**Tier:** M
**Track:** technical — the `fr` row class is omitted (no PRD; technical intents TI-1..TI-6 in the
stories file carry the requirement layer).
**Outcome source:** the OUTCOMES bullets of jstoup111/ai-conductor#1400, carried into the spec by the
`.docs/intake/` marker landed with this branch.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-ST-1400-1, story-ST-1400-5 | covered | "One source of truth for update-check state. Editing the documented location changes real behavior; there is no second file that silently wins." Story 1 asserts every read and write resolves to `conductor:` and that a hand-edited value is observed; story 5 makes a reintroduced second surface fail the integrity suite. |
| outcome | outcome-2 | story-ST-1400-2, story-ST-1400-4 | covered | "Existing installs migrate without losing `currentVersion`/`lastCheckedAt`." Story 2's first happy-path asserts the live JSON overwrites a stale block, preserving version identity; story 4 forbids a failed read from masquerading as a default, which is the other route to the same silent-stop failure at `bin/update:133-138`. |
| outcome | outcome-3 | story-ST-1400-1 | covered | "Key naming agrees between writer and schema." Story 1 asserts writes appear "under `conductor:` in snake_case" and its Done-When requires the accessors resolve `conductor.<snake_case_key>`. |
| outcome | outcome-4 | story-ST-1400-5 | covered | "The stale/duplicate block cannot silently reappear — a check fails if the update flow reads or writes a config surface the schema does not own." Story 5 is the dedicated story; its negative paths cover both the legacy-path reference and the unknown-key case, and require the check to fail closed when it cannot determine the schema's allowed set. |
| outcome | outcome-5 | story-ST-1400-2, story-ST-1400-6 | covered | "Divergent pre-existing values resolve by an explicit documented rule, not by whichever file is read first." Story 2 fixes the rule mechanically (legacy JSON wins the one-time seed; the rename is the marker) and its ordering negative-path removes read-order dependence entirely; story 6 requires the rule be written into `docs/reference/configuration.md`. |
| story | story-ST-1400-1 | task-4, task-5, task-11 | covered | Task 4 specifies the round-trip, key-preservation and no-legacy-file assertions; task 5 repoints both accessors; task 11 closes the third writer at `bin/install:914-963` that bypasses them. |
| story | story-ST-1400-2 | task-7, task-8, task-9, task-10 | covered | Task 7 covers the operator's real divergence plus the rename marker and idempotence; task 8 covers absent/empty/malformed legacy data, the partial-key and invalid-channel refusals, and the failed rename; task 9 implements; task 10 makes the seed a precondition, covering the ordering and once-per-invocation negatives. |
| story | story-ST-1400-3 | task-1, task-2, task-3 | covered | Task 1 covers detection plus every rejection path; task 2 covers persistence, boolean coercion, key preservation and intermediate-mapping creation; task 3 covers dispatch and asserts `config read`/`config write` contracts are unchanged. |
| story | story-ST-1400-4 | task-6 | covered | Task 6 covers the missing-`conduct-ts` prerequisite failure, the non-default propagation, the advisory-only exit, and the no-PyYAML assertion. |
| story | story-ST-1400-5 | task-12 | covered | Task 12 covers all four of story 5's criteria, including passing on the current tree and failing on a deliberately introduced violation. |
| story | story-ST-1400-6 | task-13, task-14, task-15 | covered | Task 13 deletes the four named residues with their tests; task 14 corrects `configuration.md`, `cli.md` and `validation.md`; task 15 carries the migration fence and release disposition. |
| task | task-1 | story-ST-1400-3 | covered | RED for `config set` detection and every rejection path. |
| task | task-2 | story-ST-1400-3 | covered | GREEN: validated write with boolean coercion and key preservation. |
| task | task-3 | story-ST-1400-3 | covered | Dispatch wiring; existing config verbs asserted unchanged. |
| task | task-4 | story-ST-1400-1 | covered | RED for accessor round-trip through `conductor:`. |
| task | task-5 | story-ST-1400-1 | covered | GREEN: accessors repointed, signatures unchanged so the ten call sites do not move. |
| task | task-6 | story-ST-1400-4 | covered | Loud degradation on a failed read; no PyYAML in the path. |
| task | task-7 | story-ST-1400-2 | covered | Seed happy paths: legacy wins, rename marker, idempotence. |
| task | task-8 | story-ST-1400-2 | covered | Seed negatives: malformed input, partial keys, invalid channel, failed rename. |
| task | task-9 | story-ST-1400-2 | covered | GREEN: seed implemented in `bin/lib/harness-common.sh`, not `bin/conduct`. |
| task | task-10 | story-ST-1400-2 | covered | Precondition guard closes the ordering hazard and the once-only requirement. |
| task | task-11 | story-ST-1400-1 | covered | `bin/install`'s `configure_conductor()` writes through the accessors. |
| task | task-12 | story-ST-1400-5 | covered | New numbered integrity check, failing closed. |
| task | task-13 | story-ST-1400-6 | covered | `readLegacyJson`, `legacyJsonPath`, `LEGACY_JSON_FILE`, `migrate_legacy_conductor_config` removed with their tests. |
| task | task-14 | story-ST-1400-6 | covered | The three affected documentation pages corrected in the same PR. |
| task | task-15 | story-ST-1400-6 | covered | Migration fence and `note`/`Fixed`/`patch` disposition. |

No `gap` rows. Every `covered` verdict was checked against the cited artifact file in this worktree
(`.docs/stories/update-check-config-single-source-of-truth.md` and
`.docs/plans/update-check-config-single-source-of-truth.md`). All 6 stories are cited by at least one
task, and all 15 tasks cite exactly one story.

## Assumptions surfaced

- **The `conductor:` block has zero production readers** — ~95% confidence, verified by searching for
  every caller of `readLegacyJson`, `legacyJsonPath`, and `ConductorConfig` outside tests. Impact if
  wrong: an unseen reader would observe the block change from stale to live values at seed time,
  which is the intended direction but would be an unplanned behavior change for that consumer.
  Mitigated because the seed only ever moves the block toward the values the live JSON already drove.
- **#226 removes `bin/conduct` without removing `bin/lib/harness-common.sh`** — ~92% confidence, based
  on the issue title, its open state, and the explicit sequencing note at `bin/update:9-14`. Impact
  if wrong: the seed and accessors would be deleted at cutover. Mitigated by task 9 placing them in
  the file that note names as their permanent home, and by task 12's integrity check, which would
  fail if the update flow lost its schema-owned surface.
- **PyYAML is not a documented installation prerequisite** — ~90% confidence, verified against
  `bin/install`, `docs/`, and `README.md`. This assumption only motivates the chosen mechanism; it is
  not load-bearing for correctness, because task 6 asserts the absence of PyYAML from the path
  regardless of how common it is.
- **The operator's intent for the divergence rule** — 100% confidence; explicitly confirmed on
  2026-08-09 after both readings were put side by side. Recorded in
  `adr-2026-08-09-legacy-json-seed-migration-rule.md`.

No assumption remains unconfirmed in a way that would change a requirement, task, or code behavior,
so nothing blocks the build.
