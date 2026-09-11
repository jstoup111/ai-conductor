**Status:** Accepted

# Stories: Refuse unsupported plugin kinds at load (#1931)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is retiring the two plugin kinds no runtime seam retrieves, refusing them by name at manifest validation, and binding the remaining kind list to real retrieval sites. Designing or building a step-plugin or hook-plugin execution seam is outside this slice.

## Story 1: Refuse a plugin whose declared kind no runtime seam can run

### Acceptance Criteria

#### Happy Path

- Given a plugin directory whose manifest declares a supported kind, when discovery runs, then the plugin registers and stays retrievable from the registry unchanged.
- Given a manifest declares a retired kind, when the manifest is validated, then validation fails with a message naming that kind as unsupported and listing the kinds that are supported.

#### Negative Paths

- Given a plugin directory whose manifest declares a retired kind, when discovery runs, then the directory is skipped with a warning naming the plugin, and the registry holds no entry for that kind.
- Given a manifest declares a kind that was never valid, when the manifest is validated, then the pre-existing invalid-kind refusal is returned unchanged.

### Done When

- [ ] The retired kinds are absent from the plugin kind union and from the valid-kind list.
- [ ] Manifest unit fixtures cover a supported kind, each retired kind, and a kind that was never valid.
- [ ] A discovery fixture containing a retired-kind plugin directory registers nothing for that kind and warns.
- [ ] The page that documents plugin manifests names the supported kinds and the retired-kind refusal.

## Story 2: Keep the valid-kind list bound to real retrieval sites

### Acceptance Criteria

#### Happy Path

- Given every kind in the valid-kind list, when the retrieval-site guard runs, then each kind maps to an engine module that exists and retrieves that kind from the registry.

#### Negative Paths

- Given a retired kind is reintroduced into the valid-kind list, when the retrieval-site guard runs, then the guard fails rather than accepting a kind with no site.

### Done When

- [ ] The retrieval-site map is typed over the kind union so adding a kind without a site fails the typecheck that covers test files.
- [ ] The guard reads each mapped module and asserts it names its kind at a registry retrieval call.
- [ ] The guard fails for a valid-kind list that contains a kind absent from the retrieval-site map.

## Negative-category review

Input integrity is covered by the retired-kind and never-valid-kind manifests, which are the only malformed inputs this change can newly produce; existing manifest coverage retains the missing-field, bad-name, bad-YAML, and unreadable-file cases. Dependency and partial-failure behavior is covered by the discovery fixture, where one refused plugin directory must not prevent a valid sibling from registering. Idempotency is inapplicable: validation is a pure function of the manifest and discovery re-scans from disk each run. Permission, network, deletion, queue, datastore, upload, and transaction categories are inapplicable — the change adds no I/O beyond reading manifests that discovery already reads, and the guard's file reads are test-local. No third party is contacted at any point, so no smoke coverage is owed.
