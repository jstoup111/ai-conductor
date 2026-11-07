# Complexity: Intake carries an optional declared semver label (#2027)

Tier: S

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. One optional field (`semver`) on the existing intake filing options, result, and issue-form fields |
| External integrations | None new. Reuses the existing guarded issue-label write and the repository's existing `semver:major` / `semver:minor` / `semver:patch` labels |
| Auth / permission surface | Unchanged: the label rides the same guarded `issue.label.add` / `intake.issue.label.add` operations size and priority already use |
| State machines | None |
| Story count | 2: declare a tier when filing through `intake-file`; declare a tier through the issue form |
| Files touched | ~6: `src/conductor/src/intake-file-cli.ts`, `src/conductor/src/engine/engineer/intake/file-issue.ts`, `src/conductor/src/engine/engineer/intake/filing-output.ts`, `src/conductor/src/engine/engineer/intake/label-sync.ts`, `src/conductor/scripts/intake-label-sync-apply.mts`, `.github/ISSUE_TEMPLATE/intake.yml`, plus their tests and the intake skill's flag reference |
| ADR work | None. It follows the existing size/priority label pattern and contradicts no approved ADR |

## Rationale

Small. The change is additive and display-only: an optional flag and an optional form dropdown that apply one existing label. It never infers or defaults a tier, and nothing downstream reads the label, so a mistake shows a wrong or missing label and cannot misroute work. It is not a hotfix because it adds a CLI flag to the shipped `intake-file` helper and edits more than two production files.
