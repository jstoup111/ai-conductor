# ADR: Classify before spend — the release smoke gate runs once per release, not once per merge

**Date:** 2026-08-04
**Status:** APPROVED
**Feature:** no-release-time-smoke-or-eval-gate-releases-cut-wi (jstoup111/ai-conductor#1259)
**Related:** adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate (consumes its reserved
gate mode), adr-2026-08-01-bot-owned-release-pr (the publisher this gate wraps)

## Context

`.github/workflows/release.yml` runs no tests. Everything it needs to decide publication comes
from GitHub: the push event, the merged PR's provenance, a head-bound `release-candidate-audit`
check, and the committed `VERSION`/`CHANGELOG.md`. The operator's requirement is that a release
cannot be cut while the smoke tier is failing, that the check runs automatically right after the
release PR merges, that it blocks tagging, and that a blocked release is recoverable.

The binding constraint is cost. The smoke tier includes a live-agent leg that spends real LLM
tokens, and the operator's instruction is explicit: run it only before cutting a release, not
continuously. Two candidate placements fail that constraint outright:

- **`ci.yml` on every pull request** — a credentialed live run per PR.
- **`release-pr.yml` before the candidate audit** — that workflow re-runs on *every* merge to
  `main` to maintain the release candidate, so the live run recurs per merge.

`release.yml` itself is the only workflow that corresponds to a release event — but it also
triggers on every push to `main`, and only afterwards discovers that most of those pushes are
ordinary feature merges. Verified at `src/conductor/src/engine/release-publisher-action.ts:61-66`:
`runReleasePublisherAction` returns `{ state: 'ignored' }` for any push that is not the designated
bot release-PR merge. Placing an unconditional smoke step in that workflow would therefore charge
an LLM run on every merge to `main` — the same failure mode as the rejected placements.

## Decision

**Split a classify phase out of the publisher's existing pure prefix.** Export
`classifyReleasePublication` from `release-publisher-action.ts`. It performs exactly the
decision logic that already exists at lines 61-92 — event branch check, designated-PR provenance,
head-bound audit evidence, approved `VERSION`/`CHANGELOG.md` — and returns `ignored` / `rejected` /
`publishable` **without performing any mutation**. The mutating calls (lines 94-99,
`createAnnotatedTag` and `createRelease`) stay behind `runReleasePublisherAction`.

This is an extraction, not a redesign. The boundary already exists in the code; it simply is not
addressable from outside.

**`release.yml` becomes three ordered jobs:**

1. **classify** — calls `classifyReleasePublication`. GitHub API reads only, zero cost. Emits a
   `publishable` job output. On `ignored`, the workflow ends successfully and *nothing else runs*.
2. **smoke** — `needs: classify`, `if: publishable == 'true'`. Runs the full smoke tier, including
   the reusable live workflow in gate mode. This is the only step that spends tokens, and it is
   reached only on a genuine release.
3. **publish** — `needs: [classify, smoke]`, `if: publishable == 'true'`. Calls
   `runReleasePublisherAction` unchanged.

**Classify grants no authority.** The publish job re-derives every condition from GitHub rather
than trusting the classify job's output. Classify is a *cost gate*, not an *authority gate*: its
only job is deciding whether spending money is warranted. This keeps the security property that
publication authority derives solely from live GitHub evidence at the moment of publication
(adr-2026-08-01), and it removes any time-of-check/time-of-use gap between the two jobs. A
classify output that has gone stale can only cause a wasted smoke run or a `rejected` publish —
never an unauthorized tag.

**A smoke failure blocks the tag and the GitHub Release, and undoes nothing.** Because the tier
runs strictly before the publisher's first mutation, a failure leaves no partial state: the merge
stays on `main`, no tag exists, no Release exists.

**Recovery is re-running the same commit.** The publisher is already idempotent —
skip-if-tag-exists (lines 80-86, 94) and skip-if-release-exists (lines 89-92, 97). So after a
smoke failure the operator fixes forward and re-runs the workflow on the same SHA; classify runs
again, smoke runs again, and publication proceeds. Re-running a push-triggered run preserves
`github.sha`, so no new trigger surface is required. Should a fix require a code change, that
change merges normally, `release-pr.yml` refreshes the candidate, and the next release-PR merge
re-enters the same path.

## Alternatives considered

- **Gate on the release PR's `release-candidate-audit` check.** Rejected on cost:
  `release-pr.yml` re-runs on every merge to `main`, so the live run would recur per merge.
- **Full smoke on every pull request in `ci.yml`.** Rejected on cost and latency: a credentialed
  live run on every PR, for a signal only needed at release.
- **Smoke unconditionally at the top of `release.yml`.** Rejected: `release.yml` fires on every
  push to `main`, so this is per-merge spend wearing a release-shaped label.
- **Let the publish job trust classify's output instead of re-deriving.** Rejected: it would move
  publication authority into a job output, weakening adr-2026-08-01's provenance property for no
  gain, since re-deriving costs only API reads.
- **Pre-merge required check on the release PR.** Rejected: the operator asked for a check that
  runs automatically after merge and blocks tagging. A pre-merge check also cannot observe the
  merge commit that publication is bound to.

## Consequences

**Positive.** Exactly one paid smoke run per release. The gate sits on the only path that produces
a tag, so no release can be cut around it. No new authority surface and no TOCTOU window. A
blocked release requires no cleanup because no mutation has occurred.

**Negative.** A regression is detected at release time rather than at the PR that introduced it,
so the bisect surface is a whole release window. This is the accepted trade for not paying per
merge; it is the same trade adr-2026-08-02 made and named.

**Operational prerequisite (High impact).** Verified 2026-08-04: the repository's only Actions
secrets are `RELEASE_PR_APP_ID` and `RELEASE_PR_APP_PRIVATE_KEY`. `CLAUDE_CODE_OAUTH_TOKEN` is
**not provisioned**. Gate mode treats a missing credential as a failure by design
(adr-2026-08-02), so once this feature merges the first release will block until that secret
exists. That is correct behavior, not a defect — a release must never pass because its smoke tier
silently skipped — but it makes provisioning the secret a prerequisite of merging, not a
follow-up. The gate's failure output must name the missing secret explicitly so the remedy is
self-evident from the failed run.
