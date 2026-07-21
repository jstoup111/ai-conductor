# Track: pr-labels uses structured gh-error detection for not-found PRs

Track: technical

## Why technical

This is a robustness fix in an internal engine module (`pr-labels.ts`'s not-found
classifier). No user-facing product surface, no PRD-worthy behavior — the acceptance
criteria are mechanical (distinguish a genuinely-gone PR from a transient error using
a structured signal, preserving the fail-safe "uncertain → keep" direction).
Acceptance criteria live in the stories, not a PRD.

## Context (verified against `main`)

The mergeable-label sweep prunes a PR from the per-repo watch registry when it is
gone. Today `pr-labels.ts` decides "gone vs transient" by lowercasing `err.message`
and substring-matching English fragments:

`NOT_FOUND_PATTERNS` (`src/conductor/src/engine/pr-labels.ts:225-232`):
`'not found'`, `'could not resolve to'`, `'no pull requests'`, `'404'`, `'no such'`.

`isNotFoundError` (`pr-labels.ts:234-237`) reads **only** `err.message` (lowercased)
and `.includes()`-matches those fragments. `prMergeState` (`pr-labels.ts:335-365`)
runs `gh pr view <url> --json state,mergeable,statusCheckRollup,labels`; its
`catch (err)` maps `isNotFoundError(err)` → `NOTFOUND_SENTINEL` (state `'NOTFOUND'`,
line 361) and everything else → `ERROR_SENTINEL` (state `'UNKNOWN'`, line 363).
Sentinels are defined at lines 204-210 and 217-223. The fail-safe direction is
already correct: uncertain → `UNKNOWN` → the sweep KEEPS and retries.

`mergeable-sweep.ts`'s `sweepMergeableLabels` (`src/conductor/src/engine/mergeable-sweep.ts:237`)
consumes only `state.state`: it prunes on `MERGED || CLOSED || NOTFOUND`
(lines 265-272 and again at the pre-escalation re-check, 311-323) and keeps `UNKNOWN`
(lines 276-280). It needs **no logic change** as long as the `NOTFOUND`/`UNKNOWN`
state contract is preserved.

The brittleness: a `gh` version/locale wording change could stop matching a
genuinely-gone PR (leak) or, worse, a live PR's transient error could contain a
matched fragment and be mis-pruned. A DNS edge (`could not resolve host` vs
`could not resolve`) was already patched once (PR #145) — the substring approach
keeps re-introducing this class.

**What structured signal is actually reachable (verified):** the production runner
(`makeProductionGh`, `pr-labels.ts:61-67`) uses `execFile('gh', …)`; on failure the
rejected error is a Node `ExecFileException` that carries `.code` (exit code) **and
`.stderr`** — both physically reachable at the `catch (err)` (line 355), but the code
only inspects `err.message`. `gh pr view --json` prints its GraphQL error
(`"Could not resolve to a PullRequest with the number N"`, type `NOT_FOUND`) to
**stderr as text**, not parseable JSON on stdout. Exit code alone is insufficient:
`gh` exits `1` for both gone and many transient failures — so the durable NOT_FOUND
signal must come from the GraphQL error text/type on stderr, not just `err.code`.

## Approaches considered

1. **Inspect the `ExecFileException`'s structured fields (`.stderr` + `.code`) and
   key off the gh GraphQL NOT_FOUND signal, keeping the fail-safe default (chosen).**
   Widen `isNotFoundError` to read `err.stderr`/`err.code` (not just `err.message`)
   and treat a not-found ONLY when the structured GraphQL error identifies a missing
   PullRequest (the stable `Could not resolve to a PullRequest`/`NOT_FOUND` GraphQL
   error type), gated by a non-zero exit code. Everything else — including an empty
   or ambiguous stderr — stays `UNKNOWN` (keep + retry). Preserves the existing
   `NOTFOUND`/`UNKNOWN` state contract, so `mergeable-sweep.ts` is untouched. Narrows
   the surface from five loose English fragments to one durable GraphQL signal.

2. **Add a dedicated `gh api graphql` probe to get a machine `type: NOT_FOUND`.**
   Rejected for this tier: a second network round-trip per uncertain PR, a new gh
   invocation shape, and more test surface — heavier than the defect warrants. The
   `--json` call already emits the GraphQL error text on stderr; reading that is
   enough. (Left as a noted future option if stderr parsing proves insufficient.)

3. **Keep substring matching but tighten the patterns further.** Rejected: same
   fragile class the issue is closing; a wording/locale change reopens it.

Decision: **Approach 1** — structured `ExecFileException` inspection keyed to the gh
GraphQL NOT_FOUND signal, fail-safe unchanged.
