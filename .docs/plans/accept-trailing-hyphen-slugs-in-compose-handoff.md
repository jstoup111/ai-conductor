# Implementation Plan: Accept trailing-hyphen slugs in compose handoff

**Date:** 2026-09-28
**Stories:** .docs/stories/accept-trailing-hyphen-slugs-in-compose-handoff.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the change narrows one branch-name check to the existing generator's output grammar and alters no other feature's contract.

## Summary

Two bounded tasks deliver #2697. Task 1 defines the spec slug grammar once, beside the generator that produces it. Task 2 makes the `compose handoff` branch check consume that grammar and proves both acceptance of generated trailing-hyphen branches and refusal of non-canonical branches through the production publication composition. Generator output, existing stems, and other slug consumers are unchanged.

## Technical Approach

`slugify` in `spec-branch.ts` produces an empty string or lowercase alphanumeric words joined by single hyphens, with at most one trailing hyphen left by the 50-character slice, and never a leading hyphen. Export a predicate `isSpecSlug(slug: string): boolean` from the same module that returns true exactly when the slug is 1 to 50 characters and matches `^[a-z0-9]+(?:-[a-z0-9]+)*-?$`. Keep the pattern and the 50-character bound as named module constants shared with `slugify`, so the generator's slice length and the grammar's bound cannot drift apart.

In `engineer-cli.ts`, `featureMarkerForSpecBranch` keeps its `spec/` prefix match but captures the whole remainder and validates it with `isSpecSlug`; when the prefix is absent or the predicate fails it throws the unchanged message `engineer handoff: branch "<branch>" is not a canonical spec/<slug> branch.`. The returned marker path and every downstream use of the branch string stay byte-for-byte identical. Because `initialSpecPublication` calls this before returning, and the `handoff` CLI case builds the publication before `openSpecPr` runs, refusal still precedes every push and PR mutation.

The generator is deliberately not changed: existing trailing-hyphen stems and branches must keep working, and `compose land` re-derives the stem from the same idea text, so trimming would change slugs mid-flight for no benefit.

Tests follow the write-tests skill. Task 1 is a pure unit test. Task 2 extends the existing handoff test file, which already drives the production `initialSpecPublication` plus production `openSpecPr` with injected git and GitHub fakes and a mocked machine-owner read; it runs no real git, GitHub, LLM, or conductor.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, the grammar-over-generator approach, and both stories on 2026-09-28 (delegated).
- Verified: `src/conductor/src/engine/engineer/spec-branch.ts` exports `slugify`, which slices to 50 characters after stripping leading and trailing hyphens, so a trailing hyphen can survive only from the slice.
- Verified: `src/conductor/src/engine/engineer/worktree-authoring.ts` builds the branch as `spec/` plus `slugify(idea)`, and `src/conductor/src/engine/engineer/land-spec.ts` derives the feature slug with the same `slugify`.
- Verified: `src/conductor/src/engine/engineer-cli.ts` `featureMarkerForSpecBranch` uses `/^spec\/([a-z0-9]+(?:-[a-z0-9]+)*)$/` and throws the not-a-canonical-spec-branch message; it is called only from the exported `initialSpecPublication`.
- Verified: the `handoff` CLI case in `engineer-cli.ts` constructs `initialSpecPublication` before calling `openSpecPr`, so the check precedes all remote mutation.
- Verified: `src/conductor/test/engine/engineer/handoff.test.ts` already imports `initialSpecPublication` and asserts the guarded push, PR create, and PR edit timeline through production `openSpecPr`; no test currently covers the refusal branch.
- Verified: no test file exists for `spec-branch.ts`; the new file is introduced by Task 1.
- Scope check: consumer-facing engine behavior with no rule or docs placement; no skill addition; provider-agnostic. Event-spine: no event or report is added or changed.
- Verify-claims verdict: CLEAR. Every path and symbol above was read on the worktree base.

## Tasks

### Task 1: Define the spec slug grammar beside the generator
**Story:** Story 2
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/spec-branch.ts, src/conductor/test/engine/engineer/spec-branch.test.ts (new)
**Dependencies:** none

**Steps:**
1. Create the new unit test file. Table-test `isSpecSlug`: accept a single word, a hyphenated slug, a slug with one trailing hyphen, and an exactly-50-character slug; reject the empty string, an uppercase character, a leading hyphen, a double hyphen, two trailing hyphens, a slash, and a 51-character slug.
2. Add a generator agreement test: for a fixed idea list including the #1354 idea text (which truncates to a trailing hyphen), an idea that fits exactly 50 characters, and ordinary short ideas, every non-empty `slugify` output satisfies `isSpecSlug`, and the #1354 output ends in a hyphen.
3. Establish RED, then add the shared length constant and pattern plus the exported `isSpecSlug` in `spec-branch.ts`, and make `slugify` slice with the shared constant.
4. Run the file through ai-conductor scoped-run and commit.

**Done when:**
1. `isSpecSlug` accepts the single-word, hyphenated, single-trailing-hyphen, and exactly-50-character fixtures and rejects the empty, uppercase, leading-hyphen, double-hyphen, two-trailing-hyphen, slash, and 51-character fixtures, as asserted by the table test.
2. The generator agreement test asserts every `slugify` output in the fixed idea list satisfies `isSpecSlug` and that the #1354 idea output ends in a hyphen.
3. `slugify` returns byte-identical output for every idea in the fixed list compared with its expected literal values, proving the generator is unchanged.

### Task 2: Make compose handoff consume the shared grammar
**Story:** Story 1
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer-cli.ts, src/conductor/test/engine/engineer/handoff.test.ts
**Dependencies:** 1

**Steps:**
1. In the handoff test file, add a case that builds the branch as `spec/` plus `slugify` of the #1354 idea text, constructs the publication with production `initialSpecPublication` using the existing recording git and GitHub fakes and mocked machine owner, and runs production `openSpecPr`. Assert the publication resolves, the committed-record read targets the intake marker named by that exact slug, and the guarded push, PR create, and PR edit run with the unmodified branch name.
2. Add a case for a generated slug without a trailing hyphen asserting the same publication is accepted.
3. Add a table case for `other/foo`, `spec/`, `spec/Foo`, `spec/-foo`, `spec/foo--bar`, `spec/foo--`, `spec/foo/bar`, and `spec/` plus a 51-character slug: `initialSpecPublication` throws exactly the current not-a-canonical-spec-branch message naming the branch, and the recording git and GitHub fakes hold zero calls.
4. Establish RED for the trailing-hyphen case, then change `featureMarkerForSpecBranch` to match the `spec/` prefix, capture the remainder, and validate it with `isSpecSlug`, leaving the thrown message and returned marker unchanged.
5. Run the handoff test file through ai-conductor scoped-run and commit.

**Done when:**
1. Through production `initialSpecPublication` and `openSpecPr`, the trailing-hyphen branch from `slugify` of the #1354 idea resolves to an opened PR, the git fake reads the intake marker named by that exact slug, and push, PR create, and PR edit record the unmodified branch.
2. A generated branch without a trailing hyphen is accepted through the same production composition and reads its own intake marker.
3. Each of the eight listed non-canonical branches makes `initialSpecPublication` throw the exact current not-a-canonical-spec-branch message naming that branch, with zero git and zero GitHub calls recorded.
4. `featureMarkerForSpecBranch` contains no inline slug regular expression and delegates slug validation to `isSpecSlug`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an idea whose generated slug is truncated to end in a hyphen, when `compose handoff` runs for the `spec/` branch built from that slug, then the branch is accepted and the publication reads the intake marker named by that exact slug. | 1, 2 | "Through production `initialSpecPublication` and `openSpecPr`, the trailing-hyphen branch from `slugify` of the #1354 idea resolves to an opened PR, the git fake reads the intake marker named by that exact slug, and push, PR create, and PR edit record the unmodified branch." | diff-local |
| Story 1 happy: Given an idea whose generated slug does not end in a hyphen, when `compose handoff` runs for its `spec/` branch, then the branch is accepted exactly as before. | 2 | "A generated branch without a trailing hyphen is accepted through the same production composition and reads its own intake marker." | diff-local |
| Story 1 negative: Given a generated slug that ends in a hyphen, when the initial publication pushes and opens the PR, then the guarded push, PR create, and PR edit all run with the unmodified branch name and no hyphen is trimmed or added. | 1, 2 | "Through production `initialSpecPublication` and `openSpecPr`, the trailing-hyphen branch from `slugify` of the #1354 idea resolves to an opened PR, the git fake reads the intake marker named by that exact slug, and push, PR create, and PR edit record the unmodified branch." | diff-local |
| Story 2 happy: Given the shared slug grammar, when it is checked against a slug with a single trailing hyphen, then it is accepted while the same slug with a leading hyphen is rejected. | 1 | "`isSpecSlug` accepts the single-word, hyphenated, single-trailing-hyphen, and exactly-50-character fixtures and rejects the empty, uppercase, leading-hyphen, double-hyphen, two-trailing-hyphen, slash, and 51-character fixtures, as asserted by the table test." | diff-local |
| Story 2 negative: Given a branch with another prefix, an empty slug, an uppercase character, a leading hyphen, a double hyphen, two trailing hyphens, a nested path segment, or a slug longer than 50 characters, when `compose handoff` builds its initial publication, then it throws the current not-a-canonical-spec-branch message naming the branch before any git or GitHub call is made. | 2 | "Each of the eight listed non-canonical branches makes `initialSpecPublication` throw the exact current not-a-canonical-spec-branch message naming that branch, with zero git and zero GitHub calls recorded." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the pure grammar and generator-agreement unit proof. Task 2 owns the integration proof at the `compose handoff` publication boundary: production `initialSpecPublication` composed with production `openSpecPr`, which is exactly what the `handoff` CLI case runs, with faithful git and GitHub fakes at the third-party boundary. No new aggregate or external-service test is required. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2

Small tier: architecture and coherence artifacts are skipped. No ADR is created or amended.
