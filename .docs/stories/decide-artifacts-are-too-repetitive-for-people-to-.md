**Status:** Accepted

# Stories: per-feature artifact manifest and one lookup (#3405, spec 1 of 3)

Technical track. Sources: `.docs/track/decide-artifacts-are-too-repetitive-for-people-to-.md`,
`adr-2026-10-24-per-feature-artifact-manifest`, and the 2026-10-24 amendment to
`adr-2026-07-28-feature-aware-artifact-resolution` D3.

Terms:
- **Manifest:** `.docs/<slug>/manifest.json`, where `<slug>` is the feature's plan stem.
- **In-scope kind:** `plan`, `stories`, `prd`, `track`, `complexity`, `conflicts`, `coherence`, `coherence-waiver`, `architecture`, `intake`, `applicability` or `decision`.
- **Feature-scoped kind:** an in-scope kind other than `decision` and `architecture`. ADRs and architecture documents are read today as a repository-wide corpus, and that read does not change.
- **Legacy resolution:** what a reader returns today, for a feature with no manifest.

## Story 1: The manifest has one strict, deterministic format

**Requirement:** Track scope (spec 1): a per-feature manifest listing the feature's artifact files

As the engine, I want one strict manifest format so that every reader gets the same typed answer and the file cannot carry anything but the artifact list.

### Acceptance Criteria

#### Happy Path
- Given `.docs/f/manifest.json` with `schemaVersion` 1, `slug` `f`, one `plan` entry and entries of other in-scope kinds whose paths are under `.docs/`, when it is parsed, then every entry is returned with its kind and path.
- Given the same set of entries supplied in two different orders, when each is rendered, then both renderings are byte-identical and list entries sorted by kind, then by path.
- Given a manifest with two `decision` entries under `.docs/decisions/`, when it is parsed, then both entries are returned.

#### Negative Paths
- Given a manifest with `schemaVersion` 2, when it is parsed, then parsing fails naming the unsupported schema version.
- Given a manifest entry with kind `notes`, when it is parsed, then parsing fails naming the unknown kind `notes`.
- Given a manifest with a top-level `updatedAt` field, or an entry with a field other than `kind` and `path`, when it is parsed, then parsing fails naming the unknown field.
- Given a manifest entry whose path is `src/x.md` or `.docs/../x.md`, when it is parsed, then parsing fails naming the path as outside `.docs/`.
- Given a `decision` entry whose path is `.docs/plans/x.md`, when it is parsed, then parsing fails naming the path as outside `.docs/decisions/`.
- Given `.docs/f/manifest.json` whose `slug` is `g`, when it is parsed, then parsing fails naming both `f` and `g`.
- Given a manifest with no `plan` entry, or with two, when it is parsed, then parsing fails naming the plan entry count.
- Given a manifest file that is not valid JSON, when it is parsed, then parsing fails naming the manifest path.

### Done When
- [ ] Parser and renderer tests cover each listed manifest and each rejection, asserting the named reason.

## Story 2: Readers resolve a feature's artifacts through its manifest

**Requirement:** Track scope (spec 1): one engine lookup through the manifest, with today's resolution unchanged when there is no manifest

As any engine reader of a feature artifact, I want to ask the manifest first so that, once a feature has one, where its files live is data rather than a naming convention.

### Acceptance Criteria

#### Happy Path
- Given feature `f` with a manifest listing `stories` at `.docs/stories/f.md`, when a reader resolves `f`'s stories, then it returns `.docs/stories/f.md`.
- Given feature `f` with a manifest listing `stories` at `.docs/f/2-stories.md` and a legacy `.docs/stories/f.md` also present, when a reader resolves `f`'s stories, then it returns `.docs/f/2-stories.md`.
- Given feature `f` with no manifest, when each routed reader resolves each feature-scoped kind, then it returns the same file or files it returned before this change.
- Given feature `f` with a manifest whose entries point at the same paths legacy resolution finds, when each routed reader resolves each feature-scoped kind, then it returns the same file or files as with no manifest.
- Given feature `f` with a manifest listing `stories` at `.docs/stories/f.md` and a plan whose `**Stories:**` line names `.docs/stories/other.md`, when a reader resolves `f`'s stories, then it returns `.docs/stories/f.md`.
- Given feature `f` with a manifest listing one `decision` and one `architecture` entry, when the `architecture_review` or `architecture_diagram` step resolves its artifacts for `f`, then it returns the same files it returns with no manifest.
- Given feature `f` with a manifest and a plan-review record in the worktree, when the `plan_review` step resolves its artifacts for `f`, then it returns the same record it returns with no manifest.

#### Negative Paths
- Given feature `f` with a manifest that lists no `prd` entry and a file `.docs/specs/f.md` present, when a reader resolves `f`'s PRD, then it returns no file.
- Given feature `f` with a manifest that fails to parse and legacy files present, when a reader resolves any feature-scoped kind for `f`, then it fails naming the manifest path and the parse failure, and returns no legacy file.
- Given features `a` and `b` each with a manifest, when a reader resolves `a`'s plan, then it returns `a`'s listed plan and never `b`'s.
- Given feature `f` with a manifest listing `coherence` at a path absent from the tree, when a reader resolves `f`'s coherence, then its result names that listed path as missing and it does not fall back to legacy resolution.

### Done When
- [ ] Resolver tests cover manifest hit, manifest miss, no manifest, malformed manifest and missing listed path for every feature-scoped kind.
- [ ] Parity tests assert every routed reader, and the repository-scoped and plan-review resolutions, return the same files with no manifest and with a manifest pointing at legacy paths.

## Story 3: Composer land writes the manifest

**Requirement:** Track scope (spec 1): land writes the manifest for every new spec

As the operator landing a spec, I want land to record the spec's artifact files in a manifest so that every new spec carries one without anyone hand-writing it.

### Acceptance Criteria

#### Happy Path
- Given a composer worktree whose authored `.docs` change set holds the plan, stories, track, complexity, conflicts, coherence, the feature architecture document and one amended ADR, when land runs, then the land commit contains `.docs/<slug>/manifest.json` listing each file under its kind and the ADR as a `decision` entry.
- Given land writes the intake marker for an intake idea, when land completes, then the manifest lists the marker as `intake`.
- Given a worktree landed once and unchanged since, when land runs again, then the manifest bytes are unchanged.
- Given land adds entries to the manifest, when land completes, then one `feature_artifacts_registered` event is emitted naming the slug and each added kind and path.
- Given a plan-review record exists in the worktree, when land runs, then the manifest does not list it.

#### Negative Paths
- Given an unchanged worktree landed a second time, when land completes, then no `feature_artifacts_registered` event is emitted.
- Given the change set deletes an ADR, when land runs, then the manifest has no `decision` entry for it.
- Given a worktree landed once whose complexity file was then deleted, when land runs again, then the manifest no longer lists the complexity file.
- Given a manifest already in the worktree that lists a path missing from the tree, fails to parse, or names a different slug, when land runs, then land replaces it with a manifest built from the current change set.

### Done When
- [ ] Land tests assert the committed manifest's entries, idempotent bytes, event emission, and that a re-land rebuilds the manifest from the current change set.

## Story 4: Daemon discovery finds and reads specs through manifests

**Requirement:** Track scope (spec 1): daemon discovery finds specs by manifest as well as by today's paths

As the daemon, I want to discover merged specs from their manifests so that, once specs carry one, discovery reads where their files are from data rather than from today's folder names.

### Acceptance Criteria

#### Happy Path
- Given the default branch holds `.docs/f/manifest.json` listing the plan, stories, coherence, complexity, track and intake at today's paths, when discovery runs, then `f` is a candidate and each of those is read from its listed path.
- Given the default branch holds both `.docs/f/manifest.json` and `.docs/plans/f.md`, when discovery runs, then `f` appears once.
- Given the default branch holds no manifest, when discovery runs, then its candidates, blocked items and warnings are identical to before this change.

#### Negative Paths
- Given the default branch holds a manifest for `f` that fails to parse, when discovery runs, then `f` is blocked with reason `malformed-manifest` and a remedy naming the manifest path, and every other candidate is processed.
- Given a manifest-backed tier M feature whose manifest lists no `coherence` entry, when discovery runs, then `f` is blocked as `missing-coherence`, as a legacy feature without a coherence file is today.
- Given a shipped, processed or parked feature `f` whose manifest remains on the default branch and fails to parse, when discovery runs, then `f` is skipped as today and is not reported as `malformed-manifest`.
- Given the default branch holds a manifest for `f` whose listed plan is absent from the tree, when discovery runs, then `f` is not a candidate and no blocked item or warning is reported for it.

### Done When
- [ ] Discovery tests over a prefetched tree assert manifest candidates, path-based reads, de-duplication, legacy parity, skip ordering and each blocked reason.
