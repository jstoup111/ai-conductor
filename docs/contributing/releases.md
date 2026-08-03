---
title: Releases
parent: Contributing
nav_order: 3
---

# Releases

How a change in this repository becomes a tagged release: the `VERSION` file, the CHANGELOG contract,
what CI does on merge to `main`, and the two fail-closed gates a harness self-build must clear before its
PR opens. For contributors preparing a PR.

## VERSION

`VERSION` is a single line holding a semver triple. Two things validate it:

- Integrity check 9a requires `^[0-9]+\.[0-9]+\.[0-9]+$`. See [validation](validation.md).
- The release workflow re-reads it and hard-fails on a missing file or a non-semver value.

There is no manual release script, and an implementation PR never edits `VERSION` — it declares
`Release-Semver` (`major`, `minor`, or `patch`) in its release metadata instead. The bot-owned release
PR aggregates the highest declared impact across its candidates and computes the next `VERSION` itself.

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

### How an empty release set is decided

The release-PR maintainer creates a candidate only from complete, eligible merged-PR metadata. If it
has no candidate, no release PR exists to merge and publication is a no-op. The publisher also ignores
ordinary `main` pushes: it publishes only a merged `automation/release-pr` owned by the configured GitHub
App and carrying successful, head-bound release-candidate audit evidence.

The release gate does **not** require `[Unreleased]` to be non-empty. Integrity owns the changelog's
structure; the gate reads release metadata only for migration-block validation.

## What CI does on merge to main

`.github/workflows/release.yml` triggers on every `push` to `main`, serializes publication, then obtains a
narrowly scoped GitHub App token. It loads `runReleasePublisherAction`, which verifies all release authority
before any mutation:

1. The main commit must be the merge commit of the configured App-owned `automation/release-pr` into `main`.
2. That PR must have successful release-candidate audit evidence bound to its exact head.
3. The merged files must contain a matching `VERSION` and non-empty versioned `CHANGELOG.md` section.
4. Existing tag and GitHub Release state must match the approved artifact; retries create only a missing tag
   or release.

The publisher creates the annotated tag and GitHub Release through GitHub APIs. It never rewrites
`CHANGELOG.md`, bumps `VERSION`, creates a release commit, or pushes `main`. An ordinary merge or an empty
candidate set is ignored and produces no release.

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

A change touching a canonical breaking surface requires a runnable migration block in the
implementation PR's release metadata — the `## Migration` section of the PR body, parsed into
`ReleaseDisposition.migration` — not `CHANGELOG.md`. Uncertainty fails closed.

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

`.github/pull_request_template.md` carries five sections: **Summary**, **Release metadata**,
**Migration** (answer it even when the answer is `none`), **Documentation**, and **Test plan**. The
Release metadata section defaults to `Release-Disposition: no-note`; a notable reader-visible change
replaces it with `Release-Disposition: note` plus `Release-Category`, `Release-Semver`, and
`Release-Note`. A required check validates this section on every PR open/update. Its checkboxes are:

- Canonical affected documentation updated, or not applicable
- README landing-page contract updated, or not affected
- `test/test_harness_integrity.sh` passes
- Manually verified affected skill, hook, or CLI

All work happens on a feature branch; never commit directly to `main`.
