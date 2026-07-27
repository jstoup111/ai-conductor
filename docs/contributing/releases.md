# Releases

How a change in this repository becomes a tagged release: the `VERSION` file, the CHANGELOG contract,
what CI does on merge to `main`, and the two fail-closed gates a harness self-build must clear before its
PR opens. For contributors preparing a PR.

## VERSION

`VERSION` is a single line holding a semver triple. Two things validate it:

- Integrity check 9a requires `^[0-9]+\.[0-9]+\.[0-9]+$`. See [validation](validation.md).
- The release workflow re-reads it and hard-fails on a missing file or a non-semver value.

There is no manual release script. CI bumps the patch digit itself after every release. A MAJOR or MINOR
bump happens by editing `VERSION` directly in the PR, so reviewers see the semver decision in the diff.
Present the proposed bump for approval before opening the PR.

### Version freeze

This repository sets `harness_self_host.version_freeze` in `.ai-conductor/config.yml`. While the worktree
`VERSION` equals the frozen value, the self-host VERSION approval gate self-satisfies. A feature that
actually changes `VERSION` still HALTs for operator approval. This is a self-host arrangement specific to
this repo, not default harness behavior — see [self-hosting](../guides/self-hosting.md).

## Semver rules

| Bump | Applies to |
| --- | --- |
| MAJOR | A breaking change to skill contracts, the `bin/conduct` CLI, or the `settings.json` schema. |
| MINOR | A new skill, a new hook, a new gate, an additive HARNESS.md rule. |
| PATCH | A bug fix, wording, non-behavioral cleanup. |

## The CHANGELOG `[Unreleased]` contract

`CHANGELOG.md` must contain a literal `## [Unreleased]` header. Integrity check 9b enforces its presence;
check 9c enforces that every `vX.Y.Z` tag has a matching `## [X.Y.Z]` section.

### When an entry is required

A changelog entry is required **only** when the PR contains a notable reader-visible implementation
change. These add nothing:

- non-notable implementation changes,
- specification-only changes,
- documentation-only changes,
- changes with no implementation at all.

An empty `[Unreleased]` is a successful no-release path: no changelog rewrite, no VERSION bump, no tag,
no release commit, no GitHub Release.

This eligibility policy is specific to this repository's custom-step configuration. Consumer projects
without it follow the global harness release convention unchanged.

### How "empty" is decided

`.github/scripts/release-unreleased-state.sh` makes the call deterministically. It fails hard when
`CHANGELOG.md` is missing or has no exact `## [Unreleased]` line, then awk-scans the first Unreleased
block for a line that is both non-blank and does not start with `### `. Bare `### Added` subheadings
therefore do **not** count as content. It emits `release_pending=true` or `release_pending=false`.

Note the asymmetry: the CI scripts read only the *first* `[Unreleased]` block, while the release gate's
`extractUnreleasedBody` gathers across consecutive Unreleased sections until the first versioned
`## [x.y.z]` heading, tolerating duplicates.

The release gate does **not** require `[Unreleased]` to be non-empty. `release-gate.ts:359-362` states it
directly: integrity owns CHANGELOG structure, and the gate reads the body only for the migration-block
check — ordinary release content may be empty.

## What CI does on merge to main

`.github/workflows/release.yml` triggers on `push` to `main` and is skipped when the head commit message
contains `[skip ci]`, so its own release commit does not recurse. It holds `contents: write`.

1. **Checkout** with `fetch-depth: 0`.
2. **Classify pending release content** — runs `.github/scripts/release-unreleased-state.sh` and captures
   `release_pending`.
3. **Read VERSION** — hard-fails on a missing file or a non-semver value; exports `version` and
   `tag=v$version`.
4. **Skip if the tag exists** — `git rev-parse refs/tags/$tag`.
5. **Rewrite CHANGELOG and bump VERSION** — only when `release_pending == 'true'` and the tag does not
   exist. Awk extracts the `[Unreleased]` body to `/tmp/release-body.md`; a python3 snippet replaces the
   first `## [Unreleased]` with `## [Unreleased]` followed by `## [X.Y.Z] - <UTC today>`, raising
   `SystemExit` if the marker is absent; then `VERSION` is bumped to the next patch.
6. **Commit, tag, push** — as `github-actions[bot]`, committing `CHANGELOG.md` and `VERSION` with the
   message `chore(release): vX.Y.Z [skip ci]`, creating an annotated tag, and pushing both `main` and the
   tag.
7. **Create the GitHub Release** — `gh release create <tag> --title <tag> --notes-file /tmp/release-body.md`.

Steps 5 through 7 are all gated on `release_pending == 'true'`. An empty `[Unreleased]` merges cleanly and
produces no release.

## The self-host release gate

`src/conductor/src/engine/self-host/release-gate.ts` composes two fail-closed sub-gates that a harness
self-build must clear at finish, **before a PR opens**. `runReleaseArtifactGate` HALTs on the first
failure with that gate's distinct reason and does not consult later gates; the caller must not open a PR
when the verdict is not ok. Each failure writes `.pipeline/HALT`.

### Sub-gate 1: the integrity suite

Runs `test/test_harness_integrity.sh` with a 120-second default budget. All three failure modes HALT and
none can be mistaken for a pass:

| Condition | Reason |
| --- | --- |
| Script not found | "refusing to open a PR without running it" |
| Timed out | "treated as failure, not an indefinite block" |
| Non-zero exit | HALT naming the exit code |

### Sub-gate 2: the migration block

A change touching a canonical breaking surface requires a runnable migration block in the CHANGELOG's
`[Unreleased]` body. Uncertainty fails closed.

#### Canonical breaking surfaces

Reproduced verbatim from `release-gate.ts:139-144`:

```ts
export const CANONICAL_BREAKING_SURFACES = [
  'bin/conduct CLI',
  'skill symlink targets',
  'hook wiring',
  'settings.json schema',
] as const;
```

`classifyBreakingSurfaces` inspects the destination path of every changed file and, for `R` (rename) or
`C` (copy) statuses, the original path as well — so a move into *or* out of a surface is caught on either
side.

| Path predicate | Surface |
| --- | --- |
| `p === 'bin/conduct'` | `bin/conduct CLI` |
| `p === 'bin/install'` | `skill symlink targets` |
| `p.startsWith('hooks/')` or `p.includes('/hooks/')` | `hook wiring` |
| `/(^\|\/)settings(\.local)?\.json$/.test(p)` | `settings.json schema` |
| `p.startsWith('skills/')` **and** status starts with `D` or `R` | `skill symlink targets` |

Adding a skill is additive and non-breaking. Deleting or renaming one changes symlink targets and is
breaking.

A `null` change set — one the gate could not determine — returns
`{ breaking: false, uncertain: true, surfaces: [] }` and is treated as requiring a migration block.

#### What counts as a migration block

```ts
const MIGRATION_SECTION_RE = /(?:^|\n)###?\s+Migration\s*\n([\s\S]*?)(?=\n##\s|$)/;
const MIGRATION_FENCE_RE = /```bash migration\s*\n[\s\S]*?```/;
```

A ```` ```bash migration ```` fence inside a `## Migration` (or `### Migration`) section. These mirror
`bin/migrate`'s own regexes, so "runnable" means exactly what `bin/migrate` will execute when a consumer
updates past this version.

## Waivers

When the path-based classifier flags a breaking surface but the actual edit is internal-only — deleting a
private helper, with no consumer-visible CLI, hook, or schema change — a migration block is the wrong
artifact. Commit a waiver instead.

Do **not** waive when the edit changes actual CLI, hook, or schema *behavior*. That always needs a real
migration block.

### File format

Write the file at `.docs/release-waivers/<plan-stem>.md`:

```text
Waives: <comma-separated canonical surface names>

Rationale: <non-empty prose — why this is internal-only>
```

The parser is strict, and every rejection makes the whole waiver malformed rather than partially valid:

| Condition | Result |
| --- | --- |
| No `Waives:` line | Malformed |
| No `Rationale:`, or a whitespace-only rationale | Malformed |
| An empty surface list after comma-splitting and trimming | Malformed |
| Any surface name not a verbatim member of `CANONICAL_BREAKING_SURFACES` | Malformed |

Surface names must match the four strings above exactly. An unknown name is never silently accepted.

### Coverage

`uncovered = surfaces.filter(s => !parsed.surfaces.includes(s))`. Any classified surface the waiver does
not list HALTs, naming the gap. Partial coverage is not partial credit — the waiver must list every
touched breaking surface.

### Freshness

The waiver must appear in this change set: a file under `.docs/release-waivers/` ending in `.md` whose
git status starts with `A` or `M`. A waiver merged by a prior feature can never satisfy a later one.

When no waiver appears in the diff, the gate still probes the conventional path
`.docs/release-waivers/self-host-release-gate-bin-conduct-breaking-surfac.md`, because the composed gate
is not told which feature is building and has no directory-listing seam. A file found there but absent
from the diff produces the not-fresh HALT: "a waiver merged by a prior feature can never satisfy a new
breaking change set; commit the waiver in this diff."

### Uncertain change sets are unwaivable

When `classifyBreakingSurfaces` returns `uncertain: true`, `runReleaseArtifactGate` writes the migration
HALT and returns without ever consulting the waiver path — an undeterminable diff cannot prove freshness,
so it never even mentions that a waiver exists.

## Pull request expectations

`.github/pull_request_template.md` carries five sections: **Summary**, **Changelog**, **Migration**
(answer it even when the answer is `none`), **Documentation**, and **Test plan**. Its checkboxes are:

- Canonical affected documentation updated, or not applicable
- README landing-page contract updated, or not affected
- `test/test_harness_integrity.sh` passes
- Manually verified affected skill, hook, or CLI

All work happens on a feature branch; never commit directly to `main`.
