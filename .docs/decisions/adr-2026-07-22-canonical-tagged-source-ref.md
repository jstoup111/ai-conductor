# ADR: Canonical tagged source-ref module (GitHub refs + Jira keys)

Status: APPROVED
Date: 2026-07-22
Feature: generalize-source-ref-parsing-formatting-to-suppor (intake jstoup111/ai-conductor#847, refs #774)

## Context

Work-item reference parsing exists in 5 divergent implementations:
`parseSourceRef` (`engine/engineer/issue-ref.ts:30`, canonical), `SLUG_REF_RE`
(`engine/engineer/intake/label-sync.ts:70`), `parseRef`
(`engine/engineer/issue-dep-migration.ts:207`), `parseIssueRef`
(`engine/backlog-priority.ts:295`), and a github.com **URL** parser also named
`parseIssueRef` (`engine/pr-labels.ts:85`). Beyond those implementations, the
canonical `parseSourceRef` has 7 production consumers (`artifacts.ts`,
`gate-writeback.ts`, `intake-marker.ts`, `blocker-resolver.ts`,
`intake/file-issue.ts`, `intake/github-issues.ts`, plus `issue-ref.ts`'s own
formatters). The source ref is the intake ledger's idempotency key
(`source + NUL + sourceRef`, `intake/ledger.ts:80`, per
adr-012-durable-intake-ledger-sole-dedup-authority) and travels through intake
markers (`Source-Ref:` in `.docs/intake/<slug>.md`).

Jira ticket keys (`PROJ-123`) cannot be represented at any parse site today; a
partial retrofit would corrupt ledger idempotency or silently drop writebacks.

## Decision

Create one canonical module `engine/engineer/source-ref.ts` owning both
grammars, exporting a discriminated union:

```ts
type WorkRef =
  | { kind: 'github'; repo: string; number: string }
  | { kind: 'jira'; key: string };

parseWorkRef(ref: string | undefined | null): WorkRef | null
formatWorkRef(ref: WorkRef): string          // lossless round-trip
```

**Grammar (locked):**
- GitHub: current `parseSourceRef` semantics, byte-for-byte — lenient repo
  segment (any non-empty prefix before the LAST `#`), strict digits after.
  Every GitHub ref contains `#`.
- Jira: `^[A-Z][A-Z0-9]+-\d+$` (Jira Cloud default project-key grammar:
  uppercase alphanumeric key starting with a letter, ≥2 chars, then `-digits`).
  A Jira key can never contain `#` or `/`, so the two grammars are disjoint and
  the tag is derivable from the string alone. Server-side custom key patterns
  (e.g. underscores) are out of scope until a Jira adapter exists; the grammar
  constant is the single place to widen.

**Migration strategy (compat shim):** `parseSourceRef` remains exported from
`issue-ref.ts` with its exact current signature and behavior, reimplemented as
`parseWorkRef(...) → kind === 'github' ? {repo, number} : null`. GitHub-only
consumers keep calling it unchanged — a Jira ref yields `null` → their existing
non-fatal no-op path. Only ref-agnostic sites migrate to `parseWorkRef`.

**Per-consumer disposition:**

| Consumer | Disposition |
|---|---|
| `intake-marker.ts:51` (marker validity) | **Jira-aware** → `parseWorkRef` (marker must carry Jira refs losslessly) |
| `artifacts.ts:2386` (marker read-back) | **Jira-aware** → `parseWorkRef` |
| `gate-writeback.ts:248` | GitHub-only shim (gh comment no-ops on Jira) |
| `blocker-resolver.ts:97,142` | GitHub-only shim |
| `intake/file-issue.ts:176` | GitHub-only shim |
| `intake/github-issues.ts:276` | GitHub-only shim (GitHub adapter by definition) |
| `issue-ref.ts` formatters (`formatIssueRef`, `injectIssueRef`, `closeIssueOnImplementationMerge`) | GitHub-only (Closes/Refs are GitHub grammar) |
| `label-sync.ts` (`SLUG_REF_RE`) | delegate to module; GitHub-narrow (gh labels API) |
| `issue-dep-migration.ts:207` (`parseRef`) | delete copy; GitHub-only shim |
| `backlog-priority.ts:295` (`parseIssueRef`) | delegate + owner/repo split helper in the module |
| `intake/backfill.ts:111` (`parseRef`) | delete copy; GitHub-only shim *(added 2026-07-22 by conflict-check — 6th parser found by sweep)* |
| `pr-labels.ts:85` (URL parser) | keeps its github.com **URL** parse (different input domain); adopts the shared `{repo, number}` return shape only |
| `intake/ledger.ts:80` | **untouched** — key stays an opaque string (already Jira-safe) |

## Alternatives considered

- **Backend-adapter ref operations (extend ADR-009 port):** purest seam for full
  #774, but over-built with no Jira adapter existing; forces adapter plumbing
  into pure functions. The tagged module slots under a future adapter unchanged.
- **Validation-only (`isValidRef`):** leaves parsers divergent; fails the
  consolidation outcome.
- **Prefixed refs (`jira:PROJ-123`):** explicit tag, but breaks lossless
  round-trip of existing ledger entries and markers; the grammars are already
  disjoint so a prefix adds migration cost for no disambiguation gain.

## Consequences

### Positive
- One grammar owner; Jira support at every ref-agnostic site with zero behavior
  change at GitHub-only sites (shim is provably equivalent).
- Ledger dedup, intake markers, and writebacks round-trip Jira refs losslessly.
- A future JiraAdapter (#774) replaces the `kind: 'jira'` no-ops with API calls
  without touching the grammar or any call site's parse.

### Negative
- Two parse entry points (`parseWorkRef` + compat `parseSourceRef`) until all
  GitHub-only sites are eventually migrated; acceptable — the shim is one line
  and delegation is total.
- Jira Server custom key patterns unsupported until widened (documented above).

## Evidence

- Ledger key never parsed: `intake/ledger.ts:80` (verified by read).
- All five parser implementations and seven `parseSourceRef` consumers verified
  by grep/read on 2026-07-22 in this worktree.
- Grammar disjointness: GitHub parse requires `#` (`issue-ref.ts:33-35`); Jira
  grammar excludes `#`/`/` — verified from the parser source plus Atlassian's
  documented default key format (inferred for Server custom patterns, which are
  explicitly out of scope).
