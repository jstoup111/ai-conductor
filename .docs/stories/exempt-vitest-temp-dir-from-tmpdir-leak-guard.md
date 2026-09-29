**Status:** Accepted

# Stories: Exempt Vitest's own temp dir from the tmpdir leak guard (#2759)

Track: technical

Tier: S

Approved by the operator on 2026-09-28 (delegated). Scope is the tmpdir leak guard's teardown verdict for Vitest's own project temp directory and the package runner's binary lookup. The repository's scoped test command and run-root allocation are unchanged.

## Story 1: Do not report Vitest's own temp dir as a leak

### Acceptance Criteria

#### Happy Path

- Given a run whose Vitest project temp directory is a direct child of the real tmpdir, when that directory is present at teardown and nothing else appeared, then the tmpdir leak guard passes without naming it as stray.
- Given a run launched through the package runner, whose Vitest project temp directory lies inside the run root, when teardown runs, then the guard's verdict is unchanged from today.

#### Negative Paths

- Given a run whose Vitest project temp directory is exempt, when a test also created a different new entry directly in the real tmpdir, then teardown fails naming that entry and not the Vitest directory.
- Given a new real-tmpdir entry whose name merely starts with the Vitest directory's name, or a Vitest project temp directory that is not a direct child of the real tmpdir, when teardown runs, then that entry is still classified as stray.
- Given globalSetup is invoked without a project or with a project lacking a temp directory, when teardown runs, then no entry is exempted and every new unmatched entry is stray.

### Done When

- [ ] Unit cases for the diff helper and the exemption helper cover exact-name exemption, prefix look-alikes, non-child paths, and absent project data.
- [ ] A setup-and-teardown integration fixture passes a project temp directory into the real guard and observes pass for the Vitest-only case and a failure naming only the genuine stray entry.

## Story 2: Launch the package runner without PATH tweaks

### Acceptance Criteria

#### Happy Path

- Given the conductor package has a Vitest binary under its own node_modules bin directory and that directory is not on PATH, when the package runner is invoked directly with node, then it launches that binary with the forwarded arguments and the run-scoped TMPDIR.

#### Negative Paths

- Given no package-local Vitest binary exists, when the package runner is invoked, then it falls back to the vitest command on PATH exactly as today.
- Given no Vitest binary exists either package-locally or on PATH, when the package runner is invoked, then it exits nonzero and removes the run root it allocated.

### Done When

- [ ] Launcher fixture tests prove the package-local binary is chosen over PATH, the PATH fallback still works, and the missing-binary case exits nonzero with no leftover run root.
- [ ] The contributing testing guide states that the runner resolves the package-local binary.

## Negative-category review

Input integrity is covered by the exact-name, direct-child, and absent-project cases, so the exemption cannot widen into a prefix match or a blanket pass. The genuine-stray case preserves the guard's leak detection. Dependency failure is covered by the missing-binary case, which must still exit nonzero and reclaim its allocated root. Permission, network, concurrency, idempotency, deletion, and persistence categories are inapplicable: the guard reads directory names only, the runner spawns one local process, and no state is stored.
