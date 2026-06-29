# PRD: GitHub issue ↔ PR linkage + auto-close on implementation merge

**Status:** Approved
**Date:** 2026-06-29
**Tier:** M
**Source:** Operator report — issue #49 still OPEN after spec PR #53 and implementation PR #59 both merged in jstoup111/honeydew-or-handymando.

## Problem

The github-issues intake adapter turns an assigned issue into a **spec PR**, comments
"Routed to …" and "Spec PR opened: …" on the issue, and applies `engineer:handled`.
But two things never happen:

1. **No formal issue↔PR link.** Neither the spec PR nor the daemon's implementation PR
   references the originating issue with a GitHub linking keyword, so GitHub's
   "Development"/linked-PR sidebar stays empty.
2. **The issue is never closed.** Even after the daemon's implementation PR merges to
   the default branch, the issue stays OPEN (only labelled `engineer:handled`).

Root cause: the originating issue reference (`sourceRef = owner/repo#N`) lives only in the
intake ledger, keyed by `(source, sourceRef)`. It is threaded into write-back comments but
is **lost** before any PR body is composed. The daemon — which creates the *implementation*
PR that actually completes the work — has no access to it at all.

## Decision (operator-confirmed)

- The **implementation (daemon) PR** carries the closing keyword `Closes owner/repo#N`, so
  the issue auto-closes **when the real code merges** (not when the design/spec merges).
- The **spec PR** carries a **non-closing** reference (`Refs owner/repo#N`) so the issue
  links to the design work immediately without closing prematurely.
- If a spec PR is closed un-merged, the existing FR-39/40 re-eligibility logic already
  re-opens intake; using a *non-closing* ref on the spec PR keeps that behavior intact.

## Propagation mechanism

The issue origin must travel **with the spec**, because the daemon reads only committed
`.docs/` tree content from the default branch and never sees the ledger guaranteed.

`.docs/intake/<slug>.md` — a small committed artifact written at spec-authoring/land time
containing a single machine-readable line:

```
Source-Ref: owner/repo#49
```

- Written by both authoring paths: `landSpec` (live/interactive intake via `engineer land
  --source-ref`) and `runAuthoring` (autonomous). Committed in the same `git add .docs`.
- Read by the daemon in `discoverBacklog` (same base-branch tree read it already does for
  `.docs/complexity/<slug>.md`), parsed into `BacklogItem.sourceRef`.
- Absent / malformed → `sourceRef` is `undefined` and every downstream step is a no-op
  (full backward compatibility for non-intake, hand-authored specs).

## Functional Requirements

- **FR-1** When intake authors/lands a spec for an issue with a known `sourceRef`, the spec
  artifacts include a committed `.docs/intake/<slug>.md` carrying `Source-Ref: owner/repo#N`.
- **FR-2** The **spec PR** body includes a non-closing reference `Refs owner/repo#N` when a
  `sourceRef` is known; it does NOT include any closing keyword (Closes/Fixes/Resolves).
- **FR-3** The daemon resolves a backlog item's `sourceRef` from `.docs/intake/<slug>.md` on
  the base branch and carries it on `BacklogItem`.
- **FR-4** When the daemon's implementation PR is created for a feature with a known
  `sourceRef`, its body contains `Closes owner/repo#N`, so GitHub auto-closes the issue on
  merge to the default branch and shows the linked PR.
- **FR-5** All new behavior is gated on `sourceRef` being present and parseable. A spec with
  no intake origin (hand-authored, or a non-GitHub source) flows exactly as today.
- **FR-6** Issue-reference injection is **idempotent**: re-running handoff / re-editing a PR
  body never duplicates the `Refs`/`Closes` line.
- **FR-7** Failure to write back a reference (gh outage, no remote, unparseable ref) is
  **non-fatal** — it logs and continues, never rolling back a committed spec or a created PR
  (mirrors the existing FR-37 write-back contract).

## Out of scope

- Changing the FR-39/40 re-eligibility (reopen-on-unmerged-spec) behavior.
- Cross-repo auto-close (issue and PR are always in the same repo here).
- The interactive `/pr` skill used outside intake (it already may link issues by hand).
