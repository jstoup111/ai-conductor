# ADR: markdown is runtime source by default; only documentation paths are excluded

**Date:** 2026-08-13
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, intake #1535), operator-confirmed
**Relates to:**
`adr-2026-07-20-post-rebase-delta-aware-invalidation.md` (owns the gate-invalidation classifier this
predicate feeds),
`adr-2026-08-13-durable-base-advance-attribution.md` (the attribution mechanism that depends on this
fix to see the incident's own path)
**Supersedes:** nothing.
**Does not change:** which gates a given delta invalidates once classified, `GATE_SURFACE`, the
`isTestPath` convention, or any grader rubric.

## Context

Intake #1535's incident turned on the deletion of `agents/planner.md` from `main` mid-build. The
predicate that decides whether a changed path is runtime source excludes it (`rebase.ts:377-388`):

```ts
export function isCodeOrTestPath(path: string): boolean {
  const p = path.trim();
  if (!p) return false;
  if (p === 'CHANGELOG.md') return false;
  if (p.startsWith('.docs/')) return false;
  if (p.startsWith('docs/')) return false;
  if (/(^|\/)README(\.[A-Za-z]+)?$/i.test(p)) return false;
  if (/\.(md|mdx|txt|rst)$/i.test(p)) return false;
  return true;
}
```

The final line excludes **all** markdown, and nothing re-includes any.

The three preceding exclusions are **not** dead, though only one of them is fully live. Verified by
enumerating tracked files: `.docs/` and `docs/` catch three non-markdown paths the blanket rule
would miss — `.docs/audits/2026-07-25-durable-shipped-record-backfill.json`,
`.docs/coherence/.gitkeep`, and `docs/_config.yml`. The `README` rule covers an extensionless or
non-markdown README (none tracked today). Only `CHANGELOG.md` is genuinely subsumed. Confidence
100%, basis: verified by `git ls-files`.

This matters for the decision below: the inversion is not "resurrect dead lines", it is "remove the
blanket rule that swallowed everything the enumerated exclusions were already expressing
precisely".

The default is inverted for this harness. In this repository, markdown outside `.docs/` and `docs/`
is functional harness source, not prose:

- `agents/*.md` — 16 agent personas, loaded and dispatched by the engine.
- `skills/*/SKILL.md` — the skill catalog, with frontmatter the integrity suite parses.
- `tech-context/`, `templates/`, root `HARNESS.md` and `AGENT_INSTRUCTIONS.md`.

47 test files under `src/conductor/test/` reference `SKILL.md`, `agents/`, or `HARNESS.md` as data.
Confidence 100%, basis: verified by `grep -rln`. The incident is the proof: deleting one markdown
persona broke a test, which is definitionally what runtime source does and what documentation does
not.

### Consequences of the misclassification, beyond #1535

1. **Attribution cannot see the path.** `rebase_changed.changedPaths` carries
   `filterCodeOrTestPaths(changed)`, so `agents/planner.md` is absent and the base-advance join in
   the companion ADR would not have matched the incident it exists to explain.
2. **A false `noop`.** At `rebase.ts:774`, a delta whose paths are all excluded yields
   `{kind:'noop'}` — no invalidation, no event. A base advance that deletes only skills or personas
   is therefore recorded as "nothing changed" while the working tree really has lost those files,
   and every gate verdict that depended on them stays satisfied on stale evidence. Confidence 95%,
   basis: verified by code trace; not reproduced at runtime.

Both are the same bug seen from two angles: the harness does not believe its own source is source.

## Decision

**Invert the default. Documentation is an explicit, enumerated exclusion; everything else,
including markdown, is runtime source.**

`isCodeOrTestPath` excludes exactly:

- `.docs/` — committed DECIDE artifacts
- `docs/` — human-facing documentation
- `README` at any depth, any extension
- `CHANGELOG.md`

and classifies every other path as code/test, markdown included. The blanket
`\.(md|mdx|txt|rst)$` exclusion is removed; the four enumerated exclusions above become the whole
rule. Three of the four already carry live behavior today (see Context), so this narrows the
predicate rather than rewriting it.

`isTestPath` is unchanged, so `isRuntimeSourcePath` continues to mean "code/test and not a test
path" and the `GATE_SURFACE` partitions keep their present semantics.

### Why enumerate documentation rather than enumerate source

Enumerating source (`agents/`, `skills/`, `tech-context/`, …) fails closed in the wrong direction:
a harness directory added later is silently misclassified as prose, and the failure is invisible —
a gate quietly not invalidating. Enumerating documentation fails in the safe direction: an
unrecognized new path is treated as source, which at worst costs one re-verification lap. This is
the same reasoning `adr-2026-07-20` applies to an uncomputable delta, which it treats as
"code changed" rather than as a noop.

### Applicability beyond this repository

This is shipped engine code and the change is consumer-visible. The rule stays correct for an
ordinary consumer project: `docs/`, `README`, and `CHANGELOG.md` are documentation everywhere, and
a consumer's markdown outside those paths — a prompt file, a fixture, a template — is far more
likely to be load-bearing than prose. Where a consumer keeps prose outside `docs/`, the cost is a
re-verification lap, never an incorrect verdict.

## Assumptions

| Assumption | Confidence | Basis | Impact if wrong | Confirmation |
|---|---|---|---|---|
| Non-`.docs`/`docs` markdown in this repo is load-bearing | 100% | Verified — 47 test files read it; the incident broke a test by deleting one | — | — |
| Treating markdown as source does not make the `noop` path unreachably rare | 90% | Inferred — most base advances touch code regardless | More gate re-verification laps on doc-adjacent advances | Named as a Risk; measured in retro |
| No current consumer depends on markdown being excluded | 70% | Unverified — no consumer survey exists | A consumer sees extra invalidation laps after upgrading | Accepted: degrades to extra laps, never an incorrect verdict; carried as a release note |

## Alternatives considered

- **Leave the classifier alone; carry only the unfiltered delta** in the base-advance record. Fixes
  attribution for #1535 but leaves the false-`noop` bug and leaves every gate believing a persona
  deletion invalidates nothing. Rejected: it treats the symptom the companion ADR needs and leaves
  the cause.
- **Re-include specific directories** (`agents/`, `skills/`, `tech-context/`) while keeping the
  blanket markdown exclusion. Rejected for the fail-direction reason above — a new harness
  directory would be silently misclassified.
- **Make the exclusion list configurable per project.** Rejected as premature: no consumer has
  asked, and a config key is a durable contract to maintain for a rule that has one correct answer.

## Consequences

- A base advance touching `agents/**`, `skills/**`, `tech-context/**`, or root harness markdown now
  invalidates `build`/`test_suite`/`manual_test` and re-verifies them. This is the intended
  correction: those verdicts genuinely were stale before.
- Some advances previously classified `noop` now classify `changed`, so features rebase-and-
  re-verify slightly more often. This is the cost of the correction and is bounded by one lap.
- The change is consumer-visible engine behavior and carries a release note.

> **Amended 2026-08-22 by #1805:** prd_audit now runs on every feature/tier/track, judges stories' acceptance criteria as authority, declares .docs/stories and .docs/specs in its gate surface, grades findings PASS/FIXABLE/PLAN_GAP/OVER_SCOPE, and owns the only bounded plan-task kickback; reseal-rationale and scope-containment judgement move to its OVER_SCOPE grade (adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback).
