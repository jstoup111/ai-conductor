**Status:** Accepted

# Stories: path policy decides feature ownership from the artifact manifest (#3418, spec 2 of 3)

Technical track. Sources: `.docs/track/path-policy-still-decides-feature-ownership-by-fol.md`,
`adr-2026-10-28-path-policy-reads-feature-ownership-from-manifest`, and the 2026-10-28 amendments to
`adr-2026-10-24-per-feature-artifact-manifest`, `adr-2026-10-15-operator-cli-prunes-shipped-decide-artifacts`
and `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`.

Terms:
- **Manifest:** `.docs/<slug>/manifest.json`, where `<slug>` is the feature's plan stem.
- **Manifest-backed feature:** a feature whose manifest exists in the worktree. A **legacy feature** has none.
- **Listed path:** a path named by an entry of the feature's manifest.
- **Protected kind:** `plan`, `stories`, `prd`, `architecture` or `decision`.
- **In-scope path:** a path the manifest kind table classifies as a manifest kind (for example `.docs/stories/x.md` or `.docs/coherence/x.md`), or any path under `.docs/<slug>/`. The manifest itself, `.docs/plan-review/`, `.docs/shipped/`, `.docs/halted/` and `.docs/release-waivers/` paths are never in scope.
- **Feature-added path:** a path added or untracked between the merge base of HEAD with the feature's base branch and the working tree.
- **Five protected folders:** `.docs/architecture`, `.docs/decisions`, `.docs/plans`, `.docs/specs` and `.docs/stories`.

## Story 1: A disagreeing or malformed manifest stops the run at the step boundary

**Requirement:** #3418 desired outcome: when the manifest and the files it lists disagree, the run stops with a reason that names each disagreeing path and never silently reads a partial set

As the engine, I want every BUILD and SHIP step to start only when the feature's manifest agrees with its files so that no step runs on a partial or unregistered artifact set.

### Acceptance Criteria

#### Happy Path
- Given a manifest-backed feature whose every listed path exists and which has added no unlisted in-scope path, when a BUILD or SHIP step starts, then the step dispatches as it does today.
- Given a manifest-backed feature that added `src/x.ts` and `.docs/release-waivers/f.md`, when a BUILD step starts, then the step dispatches, because neither path is in scope.
- Given a manifest-backed stacked child whose base branch is its parent's branch, and the parent added `.docs/stories/p.md`, when the child's BUILD step starts, then the child's step dispatches, because the parent's path is not a feature-added path of the child.

#### Negative Paths
- Given a manifest that lists `.docs/coherence/f.md` and that file is absent from the worktree, when a BUILD step starts, then the step is refused with refusal kind `seal`, and its reason names `.docs/coherence/f.md` as missing and says to restore the file.
- Given a manifest-backed feature that committed a new `.docs/stories/extra.md` not listed in the manifest, when a BUILD step starts, then the step is refused with a reason that names `.docs/stories/extra.md` as unlisted and names the `ai-conductor register-artifact` command as the remedy.
- Given a manifest-backed feature with an untracked, uncommitted `.docs/f/notes.md`, when a SHIP step starts, then the step is refused with a reason that names `.docs/f/notes.md` as unlisted.
- Given one missing listed path and two unlisted feature-added paths, when a BUILD step starts, then the refusal reason names all three paths, each with its own reason, in one refusal.
- Given a manifest whose `slug` differs from its folder name, when a BUILD step starts, then the step is refused with the parser's named failure, and no policy falls back to folder or stem matching.
- Given a feature rebased onto a base branch that merged another feature's `.docs/stories/other.md`, when its next BUILD step starts, then `.docs/stories/other.md` is not reported as unlisted.
- Given a drift refusal on the first attempt, when the second attempt is refused the same way, then a HALT of the protected-artifact class is written whose text names each disagreeing path.
- Given a manifest-backed feature with drift, when its rebase step is about to move HEAD, then the rebase is refused before HEAD moves, naming each disagreeing path.
- Given a legacy feature that added an unlisted-looking `.docs/stories/extra.md`, when a BUILD step starts, then no drift check runs and the step proceeds exactly as it does today.

### Done When
- [ ] Step-entry tests assert dispatch or refusal for each listed case, with the refusal reason containing every named path and its reason.
- [ ] A rebase test asserts HEAD is unchanged after a drift refusal.
- [ ] A stacked-child test and a rebased-feature test assert no unlisted report for paths inherited from the base branch.

## Story 2: The manifest cannot be changed by a BUILD or SHIP session through any tool

**Requirement:** #3418 desired outcome: a BUILD session that modifies or deletes `.docs/<slug>/manifest.json`, through any tool including a shell command, is refused or caught before the change lands, naming the manifest

As the operator, I want any change to a feature's manifest during BUILD or SHIP refused or caught so that the authority on ownership cannot drift from what DECIDE approved.

### Acceptance Criteria

#### Happy Path
- Given a manifest-backed feature at its first BUILD step entry, when the seal is created, then the seal's protected artifacts include `.docs/<slug>/manifest.json` with its fingerprint.
- Given a manifest-backed feature whose manifest is unchanged, when the seal is inspected at a later step entry, then the manifest raises no violation.

#### Negative Paths
- Given a BUILD session that rewrites `.docs/<slug>/manifest.json` with a shell command and stages it, when it runs `git commit`, then the pre-commit hook rejects the commit and its message names `.docs/<slug>/manifest.json`.
- Given a BUILD session that deletes `.docs/<slug>/manifest.json` with `rm` and stages the deletion, when it runs `git commit`, then the pre-commit hook rejects the commit naming the manifest.
- Given a manifest changed through a shell command and committed with `--no-verify`, when the next BUILD or SHIP step starts, then the step is refused with `Protected artifact changed: .docs/<slug>/manifest.json`, and the manifest is not reported as a self-amendment.
- Given a manifest changed through a shell command and left uncommitted, when the next BUILD or SHIP step starts, then the step is refused naming the manifest.
- Given a feature whose seal was created before this change and does not list the manifest, and whose branch has not changed the manifest since its merge base with the base branch, when the next step starts, then the manifest raises no violation, even when the base branch has since changed its own copy.
- Given a feature whose seal does not list the manifest and whose branch changed the manifest since its merge base, when the next step starts, then the step is refused with `Protected artifact added: .docs/<slug>/manifest.json`.
- Given a manifest-backed feature whose seal is rotated by a rebase, when the rotated seal is written, then it still fingerprints the manifest and every listed protected-kind path, and the rotation's audit record lists them.
- Given a Codex BUILD session, which has no PreToolUse docs guard, that stages a manifest change, when it commits, then the pre-commit hook rejects the commit naming the manifest.

### Done When
- [ ] A pre-commit hook test stages a manifest change and a manifest deletion under a BUILD phase marker and asserts a rejected commit naming the manifest.
- [ ] Seal tests assert a fingerprinted manifest entry at creation, a `Protected artifact changed` refusal for a committed or uncommitted change, and tolerance for an older seal whose branch never changed the manifest.
- [ ] A rotation test asserts the rotated seal and its audit record contain the manifest and every listed protected-kind path.

## Story 3: The seal, the pre-commit hook and the write allowlist decide ownership from the manifest

**Requirement:** #3418 desired outcome: for a spec with a manifest, the protected-artifact seal, the pre-commit hook and the BUILD docs write allowlist treat exactly the files the manifest lists as that feature's artifacts, wherever those files live under `.docs/`

As the engine, I want protection and own-artifact exceptions to follow the manifest so that renaming or moving a listed file cannot strip its protection or grant another file the feature's exception.

### Acceptance Criteria

#### Happy Path
- Given a manifest that lists a `stories` entry at `.docs/f/review/stories.md`, when the seal is created, then that path is sealed even though it is outside the five protected folders.
- Given a manifest-backed feature whose listed `.docs/plans/f.md` changed during BUILD, when the seal is inspected, then the change is reported as a self-amendment naming `.docs/plans/f.md`, and the step proceeds.
- Given a manifest-backed feature in BUILD, when the phase marker is written, then it carries one `own:` line per listed path except the manifest, and one `protect:` line per listed protected-kind path and the manifest.
- Given a BUILD session that stages a change to its listed `.docs/f/review/stories.md`, when it commits, then the pre-commit hook accepts the path as the feature's own.
- Given a manifest-backed feature at its `remediate` step, when the phase marker is written, then its `allow:` lines are `.docs/release-waivers/` and the listed plan path, not `.docs/plans/`.
- Given a manifest-backed feature with a changed, committed listed `.docs/f/review/stories.md`, when the operator runs `ai-conductor reseal --slug f --path .docs/f/review/stories.md --reason "approved edit"`, then reseal accepts the path and rotates its fingerprint.
- Given a manifest-backed feature whose remediation is directed at its listed `.docs/plans/f.md`, when the remediation redirect classifies the target, then the target is the feature's own and remediation is not redirected to the `plan` step.

#### Negative Paths
- Given a manifest-backed feature `f` whose BUILD session changes `.docs/stories/f-old.md`, a file whose stem matches `f` but which the manifest does not list, when the seal is inspected, then the change is a `Protected artifact changed` refusal, not a self-amendment.
- Given a manifest that lists a `coherence` entry, when the seal is created, then the coherence file is not sealed, because `coherence` is not a protected kind.
- Given a BUILD session for manifest-backed `f` that stages `.docs/stories/f-old.md`, an unlisted file whose stem matches `f`, when it commits, then the pre-commit hook rejects it naming the path.
- Given a BUILD session that stages a change to another feature's `.docs/plans/g.md`, when it commits, then the pre-commit hook rejects it naming the path.
- Given a manifest-backed `remediate` step that writes `.docs/plans/other.md` with the Write tool, when the docs write guard runs, then the write is denied.
- Given a manifest-backed `remediate` step whose allowlist names `.docs/plans/f.md`, when it writes `.docs/plans/f.md.orig` with the Write tool, or stages `.docs/plans/f.md.orig` for commit, then the docs write guard denies the write and the pre-commit hook rejects the path, because a file entry matches exactly.
- Given a phase marker whose `allow:` entry is `.docs/release-waivers/`, when a session writes `.docs/release-waivers/f.md`, then the write is permitted by directory-prefix matching exactly as today.
- Given a manifest-backed feature, when the operator runs `ai-conductor reseal --slug f --path .docs/f/manifest.json`, then reseal refuses the manifest, names `ai-conductor register-artifact` as the way to change it, and leaves the seal unchanged.
- Given a protected-artifact halt caused by a changed manifest, when its recovery text is printed, then it prints no `reseal` command naming the manifest.
- Given a manifest-backed feature `f` whose remediation is directed at `.docs/stories/f-old.md`, an unlisted file whose stem matches `f`, when the remediation redirect classifies the target, then the target is not the feature's own and remediation is redirected to the `plan` step as for any foreign protected path.
- Given a phase marker with no `own:` or `protect:` lines, as for a legacy feature or a marker written by an older engine, when a BUILD session stages its own-stem `.docs/plans/f.md`, then the pre-commit hook applies today's stem rule and accepts it.

### Done When
- [ ] Seal tests assert the sealed path set and the self-amendment or refusal outcome for each listed case.
- [ ] Phase-marker tests assert the exact `own:`, `protect:` and `allow:` lines for a manifest-backed `build` step and `remediate` step.
- [ ] Pre-commit hook tests run the generated hook against staged listed, unlisted same-stem, foreign, exact-entry suffix and marker-without-lines cases and assert accept or reject with the named path.
- [ ] Docs write guard tests assert exact matching for a file entry and prefix matching for a directory entry.
- [ ] Reseal tests assert acceptance of a listed protected-kind path outside the five folders and refusal of the manifest naming `register-artifact`; a recovery-hint test asserts no reseal command names the manifest.
- [ ] Remediation redirect tests assert own versus redirected classification for the listed plan and the unlisted same-stem file.

## Story 4: Gate invalidation and rebase handling use the manifest's files

**Requirement:** #3418 desired outcome: for a spec with a manifest, gate invalidation and rebase handling treat exactly the files the manifest lists as that feature's artifacts, wherever those files live under `.docs/`

As the engine, I want rebase and redispatch to reopen gates when, and only when, a document the feature owns changed so that a moved or renamed artifact still reopens its gates and another feature's same-stem file does not.

### Acceptance Criteria

#### Happy Path
- Given a manifest-backed feature whose listed stories file `.docs/f/review/stories.md` changed in a rebase delta, when gate invalidation is classified, then the prd_audit and architecture_review_as_built document surfaces are invalidated.
- Given a manifest-backed feature whose manifest changed in a rebase delta, when gate invalidation is classified, then the manifest is treated as a changed review input and the document surfaces are invalidated.
- Given a manifest-backed feature whose listed coherence document cites `adr-2026-01-01-x`, when that ADR changes in a delta, then the document surfaces are invalidated as they are today.
- Given a manifest-backed feature whose listed `.docs/f/review/stories.md` changed in a rebase delta, when the gate invalidation report describes the prd_audit input surface, then the declared surface and the matched paths both include `.docs/f/review/stories.md`.

#### Negative Paths
- Given a manifest-backed feature `f` and a delta that changes only `.docs/stories/f.md`, a same-stem file the manifest does not list, when gate invalidation is classified, then no document surface is invalidated.
- Given a manifest-backed feature and a delta that changes only another feature's `.docs/plans/g.md`, when gate invalidation is classified, then no document surface is invalidated.
- Given a rebase conflict whose only conflicting paths are `.docs/f/manifest.json` and `.docs/stories/x.md`, when the docs keep-both resolver runs, then it declines the conflict, so no `manifest~ours.json` or `manifest~theirs.json` file is written.
- Given a rebase conflict that includes `.docs/f/manifest.json`, when conflict resolution continues past the keep-both tier, then no model-driven resolution tier is dispatched, and the rebase stops as needs-human with a reason naming `.docs/f/manifest.json` and the recovery of taking the base branch's manifest and re-running `register-artifact`.
- Given a rebase conflict on `.docs/stories/x.md` alone, an add/add conflict, when the docs keep-both resolver runs, then it keeps both sides exactly as today.
- Given a manifest-backed feature whose base tip changed another feature's `.docs/stories/g.md`, when the pre-rebase seal check runs, then it is tolerated as base-inherited, as it is today.
- Given a legacy feature `f` and a delta that changes `.docs/stories/f.md`, when gate invalidation is classified, then the document surfaces are invalidated exactly as today through the same-stem rule.

### Done When
- [ ] Gate-invalidation tests assert the invalidated surfaces for each listed delta with and without a manifest.
- [ ] A keep-both resolver test asserts the manifest conflict is declined, with no `~ours` or `~theirs` file on disk, and the plain stories add/add conflict is kept both.
- [ ] A conflict-resolution test asserts a manifest conflict dispatches no model-driven tier and stops with a needs-human reason naming the manifest.
- [ ] A gate-invalidation report test asserts the declared prd_audit surface includes the listed path.

## Story 5: build_review scopes a manifest-backed feature's artifacts from the manifest

**Requirement:** #3418 desired outcome: for a spec with a manifest, build_review scope treats exactly the files the manifest lists as that feature's artifacts, wherever those files live under `.docs/`

As the engine, I want build_review to grade the feature's own artifact changes and to never treat the manifest or listed artifacts as production code so that review scope follows the manifest.

### Acceptance Criteria

#### Happy Path
- Given a manifest-backed feature whose branch changed its manifest and its listed plan, when build_review inputs are assembled, then the graded diff includes the plan change and excludes `.docs/<slug>/manifest.json`.
- Given a manifest-backed feature whose branch changed `src/x.ts`, `test/x.test.ts` and its listed `.docs/f/review/stories.md`, when the testQuality preflight classifies paths, then `src/x.ts` is production, `test/x.test.ts` is a test, and the stories path is neither, so it is not restored for the counterfactual.

#### Negative Paths
- Given a manifest-backed feature whose branch changed another feature's `.docs/specs/g.md`, when build_review inputs are assembled, then that path remains in the graded diff.
- Given a manifest-backed feature whose branch changed the manifest only, when the testQuality preflight runs, then the manifest is not classified as production.
- Given a legacy feature whose branch changed `.docs/plans/f.md`, when build_review inputs are assembled and the preflight classifies paths, then the graded diff and the production classification are exactly as today.

### Done When
- [ ] build_review input tests assert the graded diff's path set for each listed case.
- [ ] testQuality preflight tests assert the classification of each listed path with and without a manifest.

## Story 6: The operator registers an artifact added after land

**Requirement:** #3418 desired outcome: an in-scope artifact a feature legitimately adds after land is registered in the manifest and is then visible to manifest-backed readers

As the operator, I want one audited command that registers an artifact added after land so that a legitimate addition clears its drift stop and every manifest-backed reader sees it.

### Acceptance Criteria

#### Happy Path
- Given a halted feature `f` whose worktree has an unlisted `.docs/stories/extra.md`, when the operator runs `ai-conductor register-artifact --slug f --kind stories --path .docs/stories/extra.md --reason "split story file"` from a terminal, then the manifest lists the entry, one engine commit that the pre-commit hook does not refuse contains the stories file and the re-rendered manifest, and the command exits 0.
- Given that registration, when the seal is next inspected, then the manifest and `.docs/stories/extra.md` raise no violation, and the next BUILD step entry reports no drift.
- Given that registration, when the stories for `f` are resolved through the manifest, then `.docs/stories/extra.md` is among the returned files.
- Given that registration, when the feature's `.pipeline/events.jsonl` is read, then it contains one `feature_artifacts_registered` event with slug `f` and the added `{kind, path}` entry.
- Given the same command with `--clear-halt`, when registration succeeds, then the feature's HALT marker is cleared.

#### Negative Paths
- Given the command run without an interactive terminal, as from a provider subprocess, when it starts, then it exits non-zero, changes no file, and records `feature_artifact_registration_refused` with condition `requires an interactive terminal`.
- Given a blank `--reason`, when the command runs, then it exits non-zero naming the missing rationale and changes no file.
- Given `--slug g` with no `.worktrees/g`, when the command runs, then it exits non-zero naming the unknown feature worktree.
- Given a path that does not exist in the worktree, when the command runs, then it exits non-zero naming the missing path and leaves the manifest unchanged.
- Given a path that is already listed, when the command runs, then it exits non-zero naming the duplicate entry.
- Given `--kind coherence` for `.docs/stories/extra.md`, when the command runs, then it exits non-zero naming the kind mismatch with `stories`.
- Given `--kind plan` for a manifest that already lists a plan, when the command runs, then it exits non-zero naming the second plan entry.
- Given a path under `.docs/shipped/`, `.docs/halted/`, `.docs/plan-review/` or `.docs/release-waivers/`, or outside `.docs/`, when the command runs, then it exits non-zero naming the path as not registrable.
- Given a malformed manifest, when the command runs, then it exits non-zero with the parser's named failure and writes no manifest.
- Given the commit fails after the manifest was rendered, when the command exits, then the worktree's manifest and seal are byte-identical to their state before the command.
- Given an unlisted, unsealed `.docs/stories/extra.md`, when the operator runs `ai-conductor reseal --slug f --path .docs/stories/extra.md`, then reseal still refuses the path as not sealed and registers nothing.

### Done When
- [ ] CLI tests assert the commit contents, the manifest bytes, the seal entries and the persisted event for a successful registration.
- [ ] CLI tests assert each refusal's exit code, its named condition, an unchanged manifest and seal, and a persisted refusal event where the terminal check fails.
- [ ] A test asserts that the command registers no step definition and is dispatched before the pipeline starts.

## Story 7: Pruning a shipped feature retires its manifest

**Requirement:** #3418 desired outcome: pruning a shipped feature removes or retires its manifest along with its files, so no stale manifest stays on the default branch

As the operator, I want `docs-prune` to select a shipped feature's files from its manifest and remove the manifest with them so that the default branch keeps no manifest for a pruned feature.

### Acceptance Criteria

#### Happy Path
- Given a shipped feature `f` whose manifest on `origin/main` lists `plan`, `coherence`, `track`, `complexity`, `stories` and `decision` entries, when `docs-prune` selects files, then the selection is the plan, coherence, track and complexity entries plus `.docs/f/manifest.json`, together with `f`'s halted, plan-review and retro records found by today's stem rule.
- Given that selection is committed, when `origin/main` is read afterwards, then `.docs/f/manifest.json` is absent and the stories and decision files remain.
- Given a pruned manifest-backed feature whose listed plan was `.docs/f/machine/plan.md`, when the shipment audit needs its plan, then the plan path is read from the manifest at the deleting commit's parent and the plan is read from that commit.

#### Negative Paths
- Given a shipped feature whose manifest on `origin/main` is malformed, when `docs-prune` selects files, then that stem is skipped with reason `malformed-manifest` naming the manifest file, the `decide_artifacts_pruned` event records that skip, and the other stems are still selected.
- Given a shipped feature `f` whose manifest lists `.docs/plans/f.md`, while `.docs/coherence/f.md` exists on `origin/main` but is not listed, when `docs-prune` selects files, then `.docs/coherence/f.md` is not selected.
- Given an open pull request that modifies `.docs/f/manifest.json`, when `docs-prune` runs, then the whole selection for `f` is deferred with reason `open-pr-modifies`.
- Given a shipped legacy feature with no manifest, when `docs-prune` selects files, then the selection is exactly today's stem-matched set.
- Given a pruned feature whose deleting commit is not reachable from the commit being read, when the shipment audit needs its plan, then the row is classified `unresolved` with reason `shipment-plan-pruned` as today.

### Done When
- [ ] Prune selection tests assert the exact selected path set for each listed tree with and without a manifest.
- [ ] A pruned-plan lookup test asserts the plan read from the parent commit's manifest path.
