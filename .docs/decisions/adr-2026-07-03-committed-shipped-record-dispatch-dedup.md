---
status: APPROVED
date: 2026-07-03
approved: 2026-07-03
supersedes: none
amends: adr-013-daemon-main-advance-rekick
deciders: James Stoup
issues: "#204, #205"
---

# ADR: Committed Shipped Record as Dispatch-Dedup Authority

## Status
APPROVED (2026-07-03, operator-confirmed in engineer session).

## Context
The daemon's only defense against re-building a shipped spec is the **local**
`.daemon/processed/<slug>` ledger, keyed by the plan-file stem (a slug string).
Three replay incidents prove the key and the storage are both too weak:

1. **Renamed slug** — Phase 9.1 shipped (PR #82), then re-dispatched after a
   brain→engineer stem rename; the ledger had no entry under the new string.
2. **Unchanged slug, missing marker** — daemon-halt-reconciliation (PR #124)
   re-dispatched with its slug intact; ~13 pre-daemon shipped specs required a
   manual marker backfill (2026-07-02).
3. **Unchanged slug, no marker, active burn** — multi-operator-ownership-hardening
   (PR #183) re-dispatched 2026-07-03; its finish-time rebase produced conflicts
   that were "shipped code on main vs older draft", and `rekickSweep` re-kicked
   the parked duplicate on every base advance because it never consults
   `isProcessed` (#205).

The local ledger also violates the harness direction that features run in
isolated, disposable environments (EKS memo, 2026-06-30): any fresh clone or
second checkout starts with an empty `.daemon/` and would replay the entire
backlog. ADR-012 solved the analogous problem for the *intake* loop with a
durable ledger plus a **globally-visible anchor** (the GitHub label); the build
loop has no equivalent anchor today.

## Decision
1. **Shipped record, committed to the repo.** When the finish flow ships a
   feature, it writes `.docs/shipped/<stem>.md` and commits it **onto the
   implementation PR branch** before the PR is handed to the human. The record
   carries frontmatter: `slug`, `spec_hash` (SHA-256 over the canonicalized
   bytes of the plan file + its stories file as committed on the base branch),
   `pr` (implementation PR URL, or `local` for merge-local), and `shipped`
   (ISO date). The human merge that lands the code atomically lands the
   "this spec shipped" fact — no separate write, no daemon push to main.
2. **Discovery dedup precedence** in `discoverBacklog`, before the owner gate
   (cheapest check first, and dedup must never be maskable by gate config):
   a. local `.daemon/processed/<slug>` hit → skip (fast path, unchanged);
   b. `.docs/shipped/<stem>.md` exists on the base branch for the candidate's
      stem → skip and **repair the local cache** (write the missing marker);
   c. candidate's `spec_hash` matches ANY shipped record's `spec_hash` → skip,
      warn-once naming both stems (rename detected), repair the cache.
   Only a candidate passing all three proceeds to the owner gate and dispatch.
3. **`rekickSweep` consults `isProcessed`** (backed by ledger-or-shipped-record)
   before re-kicking a halted worktree; a processed slug is skipped with a
   one-time "shipped duplicate parked" log instead of the abort/clear/re-park
   cycle. This narrows adr-013's sweep (fewer re-kicks); it adds no dispatch.
4. **Local ledger demoted to cache.** `.daemon/processed/` keeps its format and
   fast-path role but is no longer the last line of defense; it is rebuilt
   opportunistically from shipped records (2b/2c) and its absence is never
   sufficient to dispatch.
5. **One-time backfill.** This feature's implementation PR includes
   `.docs/shipped/` records for every entry in the current ledger (16) plus the
   known shipped-but-unmarked specs (technical-assessment, phase-2-language-eval,
   pluggable-harness-architecture, phase-9.3-engineer-redesign, mermaid-renderer,
   harness-self-host-guardrails, multi-operator-ownership-hardening), hashes
   computed from current base-branch content.

## Consequences
- **Positive:** replay-proof across slug renames (hash), missing local state
  (committed record), and fresh clones/machines (record travels with the repo);
  rekick burn on shipped duplicates ends; aligns the build loop with ADR-012's
  "repo-visible anchor" pattern and the isolated-environment direction.
- **Negative / trade-offs:** one extra committed file per shipped feature
  (small, append-only); finish flow gains a marker-write step whose failure
  must degrade to today's behavior (cache-only) rather than block the ship;
  a spec that is both renamed AND content-edited after shipping evades the
  hash match — residual, logged, and no worse than today.
- **Explicitly out of scope:** intake dedup (ADR-012 unchanged), origin-side
  build *claims* for concurrent daemons (multi-operator Slice B territory),
  and any new dispatch path (ADR-001's no-dispatch keystone untouched).

## Alternatives Rejected
- **Local ledger + content-hash only** — fixes renames but not fresh-clone /
  cross-checkout replay; the 2026-07-02 backfill incident recurs.
- **Merged-PR probe via `gh` at discovery** — network + auth dependency on
  every poll, heuristic title/body matching, breaks offline.
- **Hash-only keying (no stem match)** — a post-ship doc edit to the spec would
  un-dedup it; stem-primary + hash-secondary covers both drift directions.
