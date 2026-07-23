# Architecture Review: Generalize source-ref parsing/formatting (GitHub + Jira)

**Date:** 2026-07-22
**Stories reviewed:** none yet — pre-stories full pass (technical track, tier M, lightweight mode)
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility:** pure TypeScript module + call-site edits; no new
  packages, services, or infrastructure. ✅
- **Prerequisites:** none — no migrations, no config. The Jira grammar constant
  is compile-time.
- **Integration surface:** touches 10 engine files but all within the
  `src/conductor/src/engine` boundary; no external API additions (Jira API is
  explicitly out of scope — `kind: 'jira'` no-ops at GitHub writeback sites).
- **Data implications:** none on disk. The ledger key (`ledger.ts:80`) is
  opaque and untouched — existing GitHub ledger entries and intake markers are
  byte-identical after the change (compat shim preserves `parseSourceRef`
  semantics exactly).
- **Performance risk:** none (string parsing).
- **Worktree isolation:** pure code change; no ports/services/shared state.

## Alignment

- **ADR-009 (intake adapter port):** respected — the Envelope contract and
  `source + sourceRef` idempotency key are unchanged; the module sits below the
  port, not beside it. A future JiraAdapter slots into the existing port and
  consumes the same module (verified against adr-009's locked mechanism).
- **ADR-012 (durable ledger as sole dedup authority):** respected — ledger
  never parses refs; untouched.
- **Domain boundaries:** consolidation *reduces* coupling: 4 duplicate parsers
  retire into one module under `engine/engineer/`; `pr-labels.ts` (URL domain)
  deliberately keeps its own parse to avoid conflating input domains.
- **Pattern consistency:** discriminated unions with exhaustive narrowing are
  the established idiom in this codebase; null→no-op for unusable refs is the
  existing contract at every consumer (verified at issue-ref.ts docblock).
- **New pattern?** The tagged WorkRef type is a new domain type crossing module
  boundaries → ADR created (adr-2026-07-22-canonical-tagged-source-ref).

## Domain Integrity

- Tagged union makes the backend explicit — no stringly-typed `kind` checks;
  invalid states (a "GitHub ref" without repo/number) unrepresentable.
- Exhaustive `kind` matching required at Jira-aware sites; GitHub-only sites
  use the narrowing shim, so no `default:` catch-alls are introduced.

## Wiring Surface

New production surfaces and where they are called from (design-time commitment):

- `engine/engineer/source-ref.ts` — `parseWorkRef`, `formatWorkRef`, `WorkRef`
  type, Jira grammar constant. Called from:
  - `engine/engineer/issue-ref.ts` — `parseSourceRef` reimplemented as the
    GitHub-narrowing shim (all 7 existing consumers reach the module through it
    unchanged: `artifacts.ts`, `gate-writeback.ts`, `intake-marker.ts`,
    `blocker-resolver.ts`, `intake/file-issue.ts`, `intake/github-issues.ts`,
    `daemon-cli.ts` via `closeIssueOnImplementationMerge`).
  - `engine/engineer/intake-marker.ts` + `engine/artifacts.ts` — migrate to
    `parseWorkRef` directly (Jira-aware marker write/read).
  - `engine/engineer/intake/label-sync.ts`, `engine/engineer/issue-dep-migration.ts`,
    `engine/backlog-priority.ts` — local parsers deleted, delegate to the module.
  - `engine/pr-labels.ts` — imports the `{repo, number}` shape only.
- No new CLI verbs, hooks, config keys, events, or jobs.

Early overlap scan (`conduct-ts overlap-scan` over all paths above):
**no overlap detected; no open blockers** (advisory, 2026-07-22).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Shim not byte-equivalent for some GitHub edge ref (e.g. `a/b#01`, nested `#`) | Technical | Low | High | Golden test: run old parseSourceRef vs shim over an edge-case corpus (leading zeros, multiple `#`, empty segments) — must be identical |
| Jira grammar too narrow (Server custom key patterns) | Technical | Medium | Low | Single grammar constant; documented out-of-scope in ADR; widen when a Jira adapter lands |
| A missed 6th parser implementation elsewhere | Technical | Low | Medium | Repo-wide grep for `#\\d`-style ref regexes + `lastIndexOf('#')` in stories' acceptance criteria |
| Jira-aware marker read-back (`artifacts.ts:2386`) changes behavior for malformed refs currently dropped | Data | Low | Medium | parseWorkRef returns null for anything matching neither grammar — same drop behavior; covered by tests |

## ADRs Created

- `adr-2026-07-22-canonical-tagged-source-ref.md` (DRAFT → pending operator
  approval; must be APPROVED before land)

## Conditions

None — clean APPROVED, subject to the ADR reaching APPROVED status (lifecycle
gate, not a review condition).
