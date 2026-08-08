# ADR: Repo-wide ADR conformance is a once-per-pass discovery precondition, reported per slug

**Date:** 2026-08-08
**Status:** APPROVED (operator-approved 2026-08-08)
**Deciders:** Engineer (DECIDE phase, #662), operator-confirmed
**Feature:** adr-approval-gate-before-build
**Issue:** jstoup111/ai-conductor#662
**Relates to:** `adr-2026-08-08-single-adr-approval-parser-three-rungs.md` (defines the parser this
ADR consumes; does NOT supersede it)

## Context

The companion ADR establishes rung 2: daemon discovery must refuse to dispatch a build when the
ADR corpus is non-conforming. Implementing it runs into three concrete facts about how discovery
actually works — all verified by reading and measuring the current code.

1. **Discovery cannot enumerate the decisions directory.** `BacklogTreeSource`
   (`backlog-tree-source.ts`) exposes exactly `listPlanFiles()`, `listShippedFiles()`, and
   `readFile(relPath)`. There is no generic directory listing. **Verified (100%)** — a repo-wide
   ADR scan is not expressible against today's interface.
2. **Reads are one subprocess each.** `readFile` is `git show <base>:<path>`, and
   `listShippedFiles` is `git ls-tree --name-only <base>:.docs/shipped`. **Measured:** 238
   sequential `git show` invocations take **0.90s** on this repo. Acceptable once per discovery
   pass; not acceptable multiplied by the candidate count, since the eligibility block runs inside
   a `for` loop over every merged spec.
3. **The read model is per-slug but the condition is repo-wide.** `BlockedSpecItem` is
   `{ slug, reason, remedy }` with a closed `reason` union, persisted to `.daemon/blocked.json` and
   rendered per feature on the dashboard. A non-approved ADR is not a property of any one spec.

## Options Considered

### Option A: Evaluate the ADR corpus inside the per-candidate loop
- **Pros:** Simplest diff — drops in beside the existing `stories-not-approved` check.
- **Cons:** Re-reads the entire corpus once per candidate. At the measured 0.90s per scan, a
  backlog of 10 candidates spends ~9s of subprocess time per poll, on a check whose answer is
  identical for every candidate.

### Option B: Evaluate once per pass, treat as a pass-level abort
- **Pros:** Cheapest; one scan per poll.
- **Cons:** Produces no per-slug row, so the dashboard shows nothing and the operator sees an idle
  daemon with no explanation — violating the repo's "every dispatch outcome leaves an operator
  lever" precedent (`adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever`).

### Option C: Evaluate once per pass, report per slug (chosen)
- **Pros:** One scan per poll, and every blocked feature still gets a row with a remedy.
- **Cons:** N identical rows when the corpus is bad; the log needs care to avoid N-fold spam.

## Decision

**Adopt Option C**, with these commitments:

1. **Extend `BacklogTreeSource` with `listAdrFiles(): Promise<string[]>`**, implemented as
   `git ls-tree --name-only <base>:.docs/decisions` filtered to `adr-*.md`, catching failure and
   returning `[]` exactly as `listShippedFiles` does. Only three files reference the interface
   (`backlog-tree-source.ts`, `shipped-record.ts`, `daemon-backlog.ts`), so the extension is cheap.
   **An empty result passes** — a repo with no ADRs has nothing to check and must stay buildable.
2. **Evaluate the corpus exactly once per discovery pass, hoisted out of the per-candidate loop.**
   The result is computed before the loop and consulted inside it. This is a correctness-relevant
   performance decision, not an optimization: fact 2 above makes the naive placement quadratic in
   backlog size.
3. **Report per slug** by adding `'adr-not-approved'` to the `BlockedSpecItem` reason union. The
   `remedy` names the specific offending ADR file and the status it carries, so the operator can act
   without re-deriving the scan.
4. **Log once per pass, not once per slug.** The existing `warnOnce` discipline is keyed so a bad
   corpus produces one log line naming the offending ADRs, while the per-slug rows still populate
   `blocked.json`.

## Consequences

### Positive
- Rung 2 becomes expressible and cheap: one added `git ls-tree` plus one corpus scan per poll.
- Every blocked feature carries a dashboard row and a concrete remedy, preserving the operator lever.
- `listAdrFiles` on the tree source is reusable by any future base-branch ADR check.

### Negative
- **One non-conforming ADR stalls the entire backlog.** This is the direct and intended consequence
  of the operator's repo-wide scope choice, and it is the sharpest cost of this design: a single
  stray status blocks every feature, not merely the one that introduced it. It is accepted
  deliberately — a non-approved ADR means the project's architectural record is not trustworthy, so
  building *anything* against it is the wrong default. The mitigation is entirely in
  legibility: the offending file and its actual status appear in both the log line and every
  blocked row's remedy, so the fix is a one-line edit the operator can find immediately. Recovery
  requires no daemon restart — the next pass re-reads the corpus.
- N identical remedies appear in `blocked.json` when the corpus is bad. Accepted as the cost of
  keeping the read model per-slug.
- The `git show`-per-file cost remains linear in corpus size. At 239 ADRs and 0.90s it is
  comfortable; if the corpus grows several-fold this should move to a single batched read
  (`git cat-file --batch`). Not done now — it would be unmeasured complexity.

### Follow-up Actions
- [ ] Add `listAdrFiles()` to `BacklogTreeSource` and its git-backed implementation
- [ ] Hoist the corpus scan above the candidate loop in `discoverBacklog`
- [ ] Add `'adr-not-approved'` to the `BlockedSpecItem` reason union with a file-naming remedy
- [ ] Key `warnOnce` per pass so a bad corpus logs once, not once per candidate
- [ ] Cover the empty-corpus-passes case explicitly in tests
