**Status:** Accepted

# Stories: Consolidate duplicate halt-marker and task-status declarations (#1016)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is one declaration per concept for the user-input halt marker, the task-status file type, and the stale-engine restart suppression path, plus registry entries that keep each collapsed pair collapsed. Renaming on-disk markers and unifying the two restart pipelines remain outside this slice.

## Story 1: One declaration of the user-input halt marker

### Acceptance Criteria

#### Happy Path

- Given the build completion check and the task-progress halt helpers, when each resolves the user-input halt marker, then both read the single exported constant declared in the task-progress module.
- Given the collapsed halt-marker pair, when the structural matched-pair check runs, then the registry declares it satisfied by derivation and the check verifies the real import edge and its use.

#### Negative Paths

- Given a completion-check module that drops the import and re-declares the marker literal locally, when the structural matched-pair check evaluates it, then the check fails naming the deriving module, the source module, and the export.

### Done When

- [ ] The completion-check module contains no declaration of the user-input halt marker literal and imports the constant instead.
- [ ] The structural check passes against the real registry entry for the halt-marker pair.
- [ ] A fixture source without the import edge makes the same check throw an error naming both modules.

## Story 2: One task-status file type

### Acceptance Criteria

#### Happy Path

- Given the task-status writer and the rebase evidence translator, when each types a parsed task-status document, then both use the single exported interface declared by the writer, including its optional array of task records.
- Given the shared state types, when a reader looks for a task-status file type, then only the writer's declaration exists and the incompatible record-map alias is gone.

#### Negative Paths

- Given a task-status document whose task list is absent or is not an array, when the rebase evidence translator translates citations and derives pending task ids, then it rewrites nothing and derives no ids.

### Done When

- [ ] The rebase evidence translator declares no local task-status file interface and imports the writer's exported type.
- [ ] The shared state types declare neither a task-status file alias nor its record type, and no module references them.
- [ ] Translator tests cover an absent task list and a non-array task list, asserting an unchanged file and an empty derived id set.

## Story 3: The restart suppression path is derived from its own marker

### Acceptance Criteria

#### Happy Path

- Given the stale-engine restart marker path constant, when the suppression record path is resolved, then it is that constant with the suppression suffix appended rather than a second independently spelled literal.
- Given the daemon state reference documentation, when a reader looks up restart state, then both restart markers are listed and the suppression record is attributed to the marker it actually belongs to.

#### Negative Paths

- Given a suppression record written at the pre-change location, when the daemon reads suppression state after this change, then it is found at that same unchanged location and no marker file is renamed or migrated.

### Done When

- [ ] The suppression constant is expressed in terms of the marker constant and its value is unchanged.
- [ ] A test asserts the resolved suppression path equals the marker path with the suppression suffix, and that the queued-restart marker path stays distinct from both.
- [ ] The daemon state reference lists both restart markers with correct suppression attribution, and the resolved known-limitation note for this defect is removed.

## Negative-category review

Input integrity is covered by the absent and non-array task-list cases, which are the only malformed inputs these readers accept. Backward compatibility is covered by the unchanged suppression location criterion, which is the failure mode a naming change would introduce. Regression protection is covered by the derivation-link failure criterion, which is this feature's only new guard. No queue, datastore, upload, transaction, deletion of user data, permission, or network boundary is introduced or touched, so those categories are inapplicable. Existing halt-marker, task-seed, rebase-translate, and restart-intent suites remain authoritative for the behavior these declarations feed.
