# Stories: pr-labels uses structured gh-error detection for not-found PRs

Status: Accepted

Source issue: jstoup111/ai-conductor#148

These stories specify the behavior of the not-found classifier in
`src/conductor/src/engine/pr-labels.ts` (`isNotFoundError`, `prMergeState`) and its
effect on the mergeable sweep's prune decision. Acceptance criteria are
Given/When/Then and are the authority for this technical-track fix (no PRD).

---

## Story 1 — A genuinely-gone PR is classified NOTFOUND via a structured signal (happy path)

**As** the mergeable-label sweep
**I want** a genuinely-gone PR detected from gh's structured GraphQL not-found signal
**So that** its watch-registry entry is pruned reliably, independent of English
wording or locale.

### Scenario 1a: GraphQL NOT_FOUND on a missing PR → NOTFOUND

- **Given** `gh pr view <url> --json …` rejects with an `ExecFileException` whose
  exit code is non-zero and whose `stderr` carries gh's GraphQL not-found signal
  (`Could not resolve to a PullRequest` / GraphQL error type `NOT_FOUND`),
- **When** `prMergeState` classifies the error,
- **Then** `isNotFoundError` returns `true` from the **structured** fields
  (`err.stderr`/`err.code`), not from an `err.message` substring guess,
- **And** `prMergeState` returns the `NOTFOUND_SENTINEL` (state `'NOTFOUND'`).

### Scenario 1b: the sweep prunes the NOTFOUND entry (contract preserved)

- **Given** `prMergeState` returns state `'NOTFOUND'` for a watched entry,
- **When** `sweepMergeableLabels` processes it,
- **Then** the entry is pruned from the watch registry (same as `MERGED`/`CLOSED`),
  with the existing drop-logging behavior unchanged — `mergeable-sweep.ts` needs no
  logic change because the `NOTFOUND`/`UNKNOWN` state contract is preserved.

---

## Story 2 — A transient or ambiguous error keeps the PR (negative path / fail-safe)

**As** an operator
**I want** an uncertain error to keep the PR in the watch registry
**So that** a live PR is never mis-pruned on a transient failure.

### Scenario 2a: transient failure → UNKNOWN → kept

- **Given** `gh pr view` rejects with a transient error (auth failure, network
  timeout, rate limit, `could not resolve host`) whose structured fields do **not**
  carry the gh GraphQL not-found signal,
- **When** `prMergeState` classifies it,
- **Then** `isNotFoundError` returns `false`,
- **And** `prMergeState` returns the `ERROR_SENTINEL` (state `'UNKNOWN'`),
- **And** `sweepMergeableLabels` KEEPS the entry (pushed to survivors) and retries it
  next sweep cycle.

### Scenario 2b: empty/ambiguous stderr never prunes

- **Given** an `ExecFileException` with a non-zero exit code but empty or ambiguous
  `stderr` (no recognizable structured not-found signal),
- **When** it is classified,
- **Then** the result is `UNKNOWN` (kept), never `NOTFOUND` — exit code alone must
  not prune, because `gh` exits `1` for both gone and transient failures.

---

## Story 3 — Wording/locale drift no longer flips the classification (negative path / regression)

**As** a harness maintainer
**I want** classification to survive a gh version or locale wording change
**So that** the DNS-substring class of bug (patched once in PR #145) cannot recur.

### Scenario 3a: reworded transient message with an old fragment does not prune

- **Given** a transient error message that happens to contain a fragment that the old
  `NOT_FOUND_PATTERNS` would have substring-matched (e.g. a message containing
  `"not found"` in an unrelated context) but whose structured GraphQL signal is
  absent,
- **When** it is classified,
- **Then** the result is `UNKNOWN` (kept) — the classifier keys off the structured
  gh not-found signal, not loose English fragments.

### Scenario 3b: reworded not-found message still prunes

- **Given** a genuinely-gone PR whose human-readable gh message is reworded across gh
  versions, but whose GraphQL error type / `Could not resolve to a PullRequest`
  structured signal is unchanged,
- **When** it is classified,
- **Then** the result is `NOTFOUND` (pruned) — the durable structured signal, not the
  prose, drives the decision.
