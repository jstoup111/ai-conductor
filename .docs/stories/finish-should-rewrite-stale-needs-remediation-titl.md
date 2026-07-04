**Status:** Accepted

# Stories: finish-time rehabilitation of reused needs-remediation halt PRs

Technical track (no PRD). Source: jstoup111/ai-conductor#271 +
`adr-2026-07-03-halt-pr-rehabilitation-at-finish` (APPROVED). Tier M — full
per-criterion negative paths.

---

## Story 1: /finish–/pr rewrites the stale halt-PR presentation

**Requirement:** ADR Decision 1 (skill owns presentation)

As an operator, I want a remediated feature's reused PR to carry a normal
title and body after finish so that the merged PR is indistinguishable from a
never-halted feature's PR.

### Acceptance Criteria

#### Happy Path
- Given a feature branch whose open PR is titled
  `needs-remediation: <branch> — manual remediation required` with the halt
  boilerplate body, when the finish flow completes with choice `pr`, then the
  PR's title is a conventional feature title (under 72 chars, imperative, no
  `needs-remediation:` prefix) and the body is the standard PR body (why /
  what changed / testing), with no "opened automatically after an
  irrecoverable daemon HALT" text remaining.
- Given the same setup, when the rewrite runs, then the PR's existing comment
  thread (including the birth-side failure-reason comment) is unchanged —
  halt history is preserved in comments, never in the body.

#### Negative Paths
- Given the branch's open PR was NOT born as a halt PR (normal title, no
  `needs-remediation` label, not draft), when finish completes, then the
  existing `/pr` update path runs as today and no rehabilitation-specific
  edit occurs (no title churn, no label calls).
- Given the halt PR's body already contains a `Closes owner/repo#N` line
  (e.g. a human added it), when the body is regenerated, then the resulting
  body still references `owner/repo#N` exactly once (no duplicate Closes).

### Done When
- [ ] `skills/finish/SKILL.md` Option 2 and `skills/pr/SKILL.md` contain an
      explicit halt-PR rehabilitation step (detect `needs-remediation:` title
      prefix on the existing PR → full `gh pr edit --title --body` rewrite).
- [ ] A finish run against a halt-born PR leaves `gh pr view --json title`
      with no `needs-remediation:` prefix and a body free of the halt
      boilerplate sentence.

---

## Story 2: finish completion gate fails while the recorded PR presentation is stale

**Requirement:** ADR Decision 3 (gate enforces presentation)

As the daemon operator, I want the finish step to fail its completion check
while the recorded PR still announces `needs-remediation:` so that skill
non-adherence is caught by bounded retries instead of shipping a stale PR.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/finish-choice` = `pr` and a recorded `pr_url` whose PR
  title has no `needs-remediation:` prefix, when the finish completion check
  runs, then the step passes (existing finish-choice/pr_url semantics
  unchanged).
- Given a recorded PR whose title starts with `needs-remediation:`, when the
  completion check runs, then the step FAILS with a reason that names the
  stale title (so the retry session knows exactly what to fix).

#### Negative Paths
- Given `gh pr view` exits non-zero (network down, auth expired), when the
  completion check runs, then the check logs a warning and PASSES (fail-open:
  a gh outage never blocks a ship).
- Given `gh pr view` returns unparseable JSON, when the completion check
  runs, then the check treats it as a read failure: warn + pass (never
  throws, never fails the step on malformed output).
- Given finish-choice is `merge-local`, `keep`, or `discard` (no `pr_url`),
  when the completion check runs, then no `gh` call is made at all and
  existing behavior is unchanged.
- Given the skill never rewrites the title, when the step retries exhaust the
  existing per-step cap, then the feature HALTs with the stale-presentation
  reason (bounded burn — no infinite retry loop).

### Done When
- [ ] The finish completion check in `src/conductor/src/engine/artifacts.ts`
      reads `title` via `gh pr view --json` only when choice=`pr` and a
      `pr_url` exists, and fails ONLY on a successful read showing a
      `needs-remediation:` title prefix.
- [ ] Unit tests with an injected gh runner cover: clean pass, stale-title
      fail, gh-error pass-with-warn, malformed-JSON pass-with-warn, and
      no-gh-call for non-pr choices.

---

## Story 3: engine step deterministically flips ready, clears the label, and injects Closes

**Requirement:** ADR Decision 2 (engine owns mechanics)

As the daemon operator, I want the mechanical PR-state fixes to run
deterministically after finish so that they never depend on session behavior.

### Acceptance Criteria

#### Happy Path
- Given a shipped feature whose recorded PR is draft, carries the
  `needs-remediation` label, and whose backlog item carries a `sourceRef`,
  when the post-run rehabilitation step executes, then the PR is flipped to
  ready (`gh pr ready`), the `needs-remediation` label is removed via the
  REST helper (`removeLabel` in `pr-labels.ts`), and the body contains
  `Closes owner/repo#N` exactly once (via `injectIssueRef`).
- Given the PR state after rehabilitation, when the mergeable-sweep next
  ticks, then FR-12 no longer suppresses the `mergeable` label for this PR
  (the label can be added when the PR is mergeable).

#### Negative Paths
- Given the recorded PR shows no halt signal (clean title, no
  `needs-remediation` label), when the step executes, then it is a no-op
  returning a `'not-halt-pr'` outcome and issues zero gh mutations — even
  when the PR is a draft (e.g. a `pr_timing: early-draft` build PR, #199);
  draft status alone never triggers rehabilitation (conflict-check
  2026-07-03, Option 1).
- Given `gh pr ready` fails (e.g. 403), when the step executes, then the
  failure is logged as a warning, the remaining mechanics (label clear,
  Closes) STILL run, the outcome is `'partial'`, and the finish step's
  success is unaffected (warn-only — never blocks the ship).
- Given the label removal fails via REST, when the step executes, then the
  warn-only semantics above apply identically (no throw, other mechanics
  unaffected).
- Given the backlog item has NO `sourceRef` (hand-authored spec), when the
  step executes, then no Closes injection is attempted (existing
  `no-source-ref` gating) while ready-flip and label clear still run.
- Given the step already ran once (PR ready, label gone, Closes present),
  when it runs again (re-kick / repeated finish), then every mutation is
  idempotent: no duplicate Closes line, label removal of an absent label is
  tolerated, ready-flip of a ready PR is a no-op — final PR state is
  byte-identical.
- Given the `pr_url` records a PR that was deleted/closed externally, when
  the step executes, then gh read errors are logged and the outcome is
  `'gh-unavailable'` — the feature's done/shipped status is unchanged.

### Done When
- [ ] New engine module exports `rehabilitateHaltPr` with injected gh runner,
      returning a discriminated outcome
      (`'not-halt-pr' | 'rehabilitated' | 'partial' | 'gh-unavailable'`).
- [ ] `daemon-cli.ts` post-run tail invokes it beside (or absorbing)
      `closeIssueOnImplementationMerge` for items with a recorded `pr_url`.
- [ ] Unit tests with injected runners cover every negative path above; an
      acceptance test drives halt → remediate → finish and asserts the final
      PR state (ready, unlabeled, Closes exactly once, clean title).

---

## Story 4: detection is stateless and observable-state-only

**Requirement:** ADR Decision 4

As a maintainer, I want halt-PR origin derived only from observable PR state
so that no new local ledger/marker can drift from reality.

### Acceptance Criteria

#### Happy Path
- Given any recorded PR, when rehabilitation or the gate evaluates it, then
  the halt determination uses only `title` / `labels` from
  `gh pr view --json` (`isDraft` is read solely to decide whether a ready-flip
  is still needed once a halt signal is established) — grep confirms no new
  `.pipeline/` or `.daemon/` marker is read or written for this purpose.

#### Negative Paths
- Given a PR that a human already partially rehabilitated (title fixed by
  hand, label still present — the PR #249 case), when the step runs, then
  only the remaining stale facets are fixed (label cleared, ready flipped if
  draft) and the hand-written title is NOT overwritten (the gate passes on a
  clean title; the skill rewrite only triggers on the stale title prefix).

### Done When
- [ ] No new persistent marker/ledger file is introduced by this feature
      (verified in code review; test asserts detection from injected PR
      state alone).

---

Suggested next: `/conflict-check`.
