# ADR: The scoped-run verb ships without a migration block or waiver

**Date:** 2026-08-01
**Status:** APPROVED (operator-approved 2026-08-01)
**Deciders:** James Stoup (operator), engineer session
**Relates to:** intake jstoup111/ai-conductor#1173
**Depends on:** `adr-2026-08-01-engine-owned-scoped-test-invocation`
**Context for:** `adr-2026-07-06-migration-gate-waiver`

## Context

`adr-2026-08-01-engine-owned-scoped-test-invocation` introduces a `conduct-ts` verb for scoped test
runs and a new key in `.ai-conductor/config.yml`. `CLAUDE.md` requires a runnable `bash migration`
block in the PR body for any PR that changes the `bin/conduct` CLI or the `settings.json` schema,
with a `.docs/release-waivers/` waiver as the alternative when the self-host gate's path-based
classifier flags a surface that the actual edit does not touch.

The question is which of the three outcomes applies: migration block, waiver, or neither. Getting
this wrong is expensive in both directions — a missing migration HALTs the self-host release gate,
while an invented empty migration block is exactly what `adr-2026-07-06-migration-gate-waiver` was
written to prevent.

## Options Considered

### Option A: Author a migration block

- **Pros:** unconditionally satisfies the gate.
- **Cons:** the change is purely additive — a new verb and a new optional key. There is nothing for
  a migration to migrate, so the block would be empty ceremony of the kind the waiver ADR exists to
  stop. **Rejected.**

### Option B: Author a release waiver

- **Pros:** the sanctioned escape when the classifier over-flags.
- **Cons:** presupposes the classifier flags a surface. It does not — see the Decision. A waiver
  naming an untouched surface is noise, and `Waives:` entries must correspond to surfaces the change
  actually touches. **Rejected.**

### Option C: Neither, with an explicit constraint on the implementation

- **Pros:** correct for a purely additive change, and converts the reasoning into a checkable rule
  the plan can carry.
- **Cons:** correctness depends on the implementation honoring a path constraint, so the constraint
  must be stated where `/plan` will see it rather than left implicit.

## Decision

Choose **Option C**: this feature ships with **no migration block and no waiver**, subject to one
binding implementation constraint.

The self-host classifier (`src/conductor/src/engine/self-host/release-gate.ts:157-166`) matches
paths exactly:

| Rule | Surface flagged |
|---|---|
| `p === 'bin/conduct'` | `bin/conduct CLI` |
| `p === 'bin/install'` | `skill symlink targets` |
| `p.startsWith('hooks/') \|\| p.includes('/hooks/')` | `hook wiring` |
| `/(^\|\/)settings(\.local)?\.json$/` | `settings.json schema` |
| `p.startsWith('skills/')` **and** removed or renamed | `skill symlink targets` |

Against that table:

1. **The verb is implemented under `src/conductor/`** and registered in the existing dispatch in
   `src/conductor/src/index.ts`, alongside the sibling `test-suite` verb whose detection and
   dispatch sit at `src/index.ts:404-406`. No path under `src/conductor/` is in the table.

2. **BINDING CONSTRAINT — the implementation MUST NOT edit `bin/conduct`.** That exact path is the
   only trigger for the `bin/conduct CLI` surface. `bin/conduct` is a launcher; adding a verb does
   not require touching it. If implementation discovers a genuine need to modify it, this ADR no
   longer covers the change and the PR must carry a real migration block. `/plan` must carry this
   constraint as an explicit task condition.

3. **The new configuration key does not touch `settings.json`.** It lands in
   `.ai-conductor/config.yml`, which the `settings(\.local)?\.json$` pattern does not match, and it
   is additive and optional — an existing config without it stays valid
   (`adr-2026-08-01-engine-owned-scoped-test-invocation`, Decision 3).

4. **Skill and documentation edits are modifications, not removals.** Updating
   `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md` in place does not flag `skill symlink
   targets`, which requires a removed-or-renamed status under `skills/`. No skill is added or
   removed by this feature.

5. **No hook is touched.** The feature adds no file under `hooks/`, consistent with Option B being
   rejected in the prior ADR on feasibility grounds.

6. **The implementation writes neither `CHANGELOG.md` nor `VERSION`.** This is a notable
   reader-visible change — a new CLI verb and a new config key — but recording it is not the
   implementation branch's job. The bot-owned `automation/release-pr` is the sole writer of both
   files, maintained from merged-PR metadata, and the pipeline's `release-disposition` step derives
   the PR's release declaration on its own. An implementation branch that edits either file trips
   the release gate. That is independent of the migration question.

   *Amended 2026-08-07 (operator-authorized).* As approved on 2026-08-01 this item required an
   `[Unreleased]` entry as a planned task. The release process changed underneath it: #1265 moved
   `CHANGELOG.md`/`VERSION` ownership to the bot-owned release PR and replaced per-branch changelog
   edits with PR-body `Release-*` metadata. The gate no longer reads a changelog at all — the word
   does not appear in `release-gate.ts`. Building the item as originally written would have made
   the forbidden edit. The decision itself — no migration block, no waiver — is unchanged.

## Verify-Claims Ledger

### Claims

- **Verified (99%):** `CANONICAL_BREAKING_SURFACES` is exactly the four names at
  `release-gate.ts:139-144`, and the classifier's path rules are as tabulated at
  `release-gate.ts:157-166`. Read directly.
- **Verified (97%):** the `test-suite` verb is detected and dispatched from `src/index.ts:404-406`
  via `engine/test-suite-cli.ts`, establishing the additive registration pattern a sibling verb
  follows.
- **Verified (95%):** `p === 'bin/conduct'` is an exact-equality match, so neither `bin/conduct-ts`
  nor anything under `src/conductor/` flags that surface.
- **Verified (95%):** the `skills/` rule requires `status.startsWith('D')` or `startsWith('R')`
  (`release-gate.ts:157,165`), so in-place SKILL.md edits do not flag.

### Assumptions

- **A1 (confirmed by the constraint itself):** the implementation will not need to edit
  `bin/conduct`. Impact if wrong: the gate flags `bin/conduct CLI` and HALTs without a migration
  block. Mitigated by making it a binding, plan-carried constraint rather than a hope, and by the
  fact that the sibling `test-suite` verb was added the same way.

**Verdict:** CLEAR.

## Consequences

### Positive

- No empty migration block is invented, honoring `adr-2026-07-06-migration-gate-waiver`'s intent.
- The path constraint is explicit and checkable at review time rather than discovered at the gate.

### Negative

- The conclusion is coupled to the classifier's current path rules; if those broaden, this ADR must
  be revisited.
- `/plan` carries a constraint that has no test of its own — it is enforced by review and by the
  gate itself.
