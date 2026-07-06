**Status:** Accepted

# Stories: Halt-PR presentation reliability (ai-conductor#274)

Technical track — acceptance criteria derived from the technical intent + the approved ADR
`adr-2026-07-05-halt-pr-presentation-reliability.md` (decisions D1–D5). Requirements are cited as
the ADR decision they realize (D1–D5). All behavior sits behind the injected `GhRunner` seam and is
unit-testable with the existing `makeFakeGh` pattern; a fake `gh` can be scripted to fail/succeed
per attempt.

> **Coordination with #271** (see `.docs/conflicts/2026-07-05-halt-pr-reliability.md`): the D5
> marker-strip at finish and #271's finish-time body regeneration MUST be the **same** body write,
> never two conflicting writes. The D1 body marker is an **invisible HTML comment** (machine anchor),
> distinct from #271's human-facing halt history, which stays in comments.

---

## Story: Escalation guarantees label + draft + body marker via verify-after-write

**Requirement:** D2, D1

As the daemon, when I open a halt PR, I want its `needs-remediation` label, draft status, and body
marker to be confirmed-present before I move on, so that a halt PR never presents as a mergeable
feature PR.

### Acceptance Criteria

#### Happy Path
- Given a feature has irrecoverably halted and a PR is created fresh, when escalation runs
  `ensureHaltPresentation(prUrl)`, then a follow-up read of the PR reports `isDraft: true`, its
  `labels` include `needs-remediation`, and its body contains `<!-- conductor:needs-remediation -->`.
- Given `ensureHaltPresentation` has just written all three attributes, when it re-reads the PR and
  all three are confirmed, then it returns a `confirmed` result without further retries.

#### Negative Paths
- Given the REST label add returns an error on the first attempt but the PR is otherwise reachable,
  when `ensureHaltPresentation` re-reads and sees the label missing, then it retries the label add
  (bounded, with backoff) and returns `confirmed` once the re-read shows the label present.
- Given the draft-set call succeeds but the label add is rejected on every attempt within the bounded
  retry count (sustained rate-limit), when the retries are exhausted, then `ensureHaltPresentation`
  returns an `unconfirmed` result and does NOT throw (the escalation continues to post its failure
  comment; the PR is left for the reconciliation sweep).
- Given the label write itself uses the GitHub API, when it is issued, then it uses the REST endpoint
  form (`gh api ... repos/OWNER/REPO/issues/N/labels`) and never `gh pr edit --add-label` (PR #172).
- Given the PR cannot be read at all (network error / NOTFOUND sentinel from `prMergeState`), when
  `ensureHaltPresentation` runs, then it returns `unconfirmed` without throwing and logs the reason.

### Done When
- [ ] `ensureHaltPresentation(runGh, cwd, prUrl, log)` exists in the `pr-labels.ts` seam, takes an
      injected `GhRunner`, and never throws.
- [ ] After a successful call the PR read-back shows all three: `isDraft:true`, `needs-remediation`
      label, body marker present — asserted in a unit test with a fake `gh`.
- [ ] A fake `gh` scripted to fail the label add once then succeed produces a `confirmed` result
      (retry proven), and one scripted to fail it every attempt produces `unconfirmed` (no throw).
- [ ] The label write argv is the REST `gh api .../issues/N/labels` form (asserted on recorded argv).

---

## Story: Reused ready PR is converted to draft

**Requirement:** D3

As the daemon, when a halt escalation reuses an already-open **ready** PR for the branch, I want it
converted to draft, so that reusing a ready feature PR does not leave a halt PR mergeable
(the #268/#269 root cause).

### Acceptance Criteria

#### Happy Path
- Given `findOrCreatePr` returned an existing OPEN PR that is currently `isDraft:false`, when
  `ensureHaltPresentation` runs, then it issues `gh pr ready --undo <url>`, and the read-back shows
  `isDraft:true`.
- Given the reused PR is already `isDraft:true`, when `ensureHaltPresentation` runs, then it does
  NOT issue a redundant `--undo` (idempotent — no-op on the already-draft attribute).

#### Negative Paths
- Given the reused ready PR also lacks the `needs-remediation` label and body marker, when
  `ensureHaltPresentation` runs, then all three (draft, label, marker) are asserted and confirmed —
  not only the draft conversion.
- Given `gh pr ready --undo` returns an error (e.g. transient), when the bounded retry still cannot
  confirm `isDraft:true`, then the call returns `unconfirmed` without throwing and leaves the PR for
  the sweep.

### Done When
- [ ] A fake `gh` returning a reused non-draft OPEN PR results in a recorded `gh pr ready --undo`
      call and a confirmed `isDraft:true` read-back.
- [ ] A fake `gh` returning an already-draft reused PR records NO `--undo` call (idempotence proven).

---

## Story: needs-remediation marker is written into the PR body as the durable anchor

**Requirement:** D1

As the reconciliation sweep, I want every halt PR to carry `<!-- conductor:needs-remediation -->` in
its body/description, so that halt PRs are enumerable even when their label and draft status were
lost.

### Acceptance Criteria

#### Happy Path
- Given a halt PR is opened or reused, when `ensureHaltPresentation` runs, then the PR body contains
  the marker `<!-- conductor:needs-remediation -->` exactly once.
- Given a halt PR body already contains the marker (reuse / repeated HALT), when
  `ensureHaltPresentation` runs again, then the marker is NOT duplicated (idempotent body write).

#### Negative Paths
- Given the reused PR already has human-authored body text, when the marker is added, then the
  existing body text is preserved and the marker is appended (no clobber of the description).
- Given the existing per-HALT **comment** marker path (`upsertComment`), when the body marker is
  added, then the comment marker still carries the human-facing failure reason (body marker and
  comment marker are distinct and both present).

### Done When
- [ ] The PR body write is idempotent: two consecutive `ensureHaltPresentation` calls yield exactly
      one marker occurrence in the body (asserted with a fake `gh` that echoes body state).
- [ ] The failure-reason **comment** (existing `upsertComment` behavior) is unchanged and still posted.

---

## Story: reconcileHaltPrs sweep heals open PRs missing label or draft

**Requirement:** D4

As the daemon, on startup and on each idle tick, I want to enumerate open PRs carrying the body
marker and re-assert their draft + label, so that PRs broken before this code shipped or by another
checkout (#268/#269) self-heal.

### Acceptance Criteria

#### Happy Path
- Given two open PRs carry the body marker — one draft+labeled, one non-draft+unlabeled — when
  `reconcileHaltPrs` runs, then the broken one ends up `isDraft:true` + `needs-remediation` labeled,
  and the already-correct one is untouched (idempotent no-op).
- Given the sweep is wired into `runDaemon`, when the daemon starts and on each idle tick, then
  `reconcileHaltPrs` is invoked (via the injected dep hook), alongside the existing mergeable sweep.

#### Negative Paths
- Given a marked PR is missing ONLY the label (already draft), when the sweep runs, then it adds the
  label and does NOT redundantly issue a draft conversion.
- Given a marked PR is missing ONLY draft status (already labeled), when the sweep runs, then it
  converts to draft and does NOT redundantly re-add the label.
- Given `gh pr list` fails or returns empty, when `reconcileHaltPrs` runs, then it is a best-effort
  no-op that does not throw and does not abort daemon startup.
- Given an open PR does NOT carry the body marker, when the sweep enumerates, then that PR is skipped
  (a normal ready feature PR is never converted to draft or labeled).
- Given a marked PR write is rate-limited during the sweep, when `ensureHaltPresentation` returns
  `unconfirmed`, then the sweep continues to the next PR and the unhealed PR is retried on the next
  tick (convergent, non-throwing).

### Done When
- [ ] `reconcileHaltPrs({projectRoot, log, runGh})` exists, enumerates open PRs via
      `gh pr list --json number,url,body,isDraft,labels --state open` (bounded by `--limit`), filters
      to body-marker carriers, and calls `ensureHaltPresentation` on each non-conforming PR.
- [ ] It is invoked from `runDaemon` startup and the idle tick through an injected dep hook (proven
      by a daemon test that counts sweep invocations with a fake).
- [ ] A fake `gh` with a marked broken PR + a marked correct PR + an unmarked ready PR results in:
      the broken one healed, the correct one untouched (no writes), the unmarked one skipped.
- [ ] A fake `gh` whose `pr list` throws yields a non-throwing no-op (daemon startup unaffected).

---

## Story: Removal-on-finish verifies clearance and strips the body marker

**Requirement:** D5

As the daemon, when a halted feature is successfully remediated and finished, I want the
`needs-remediation` label removed, the PR flipped to ready, and the body marker stripped — all
confirmed — so that a finished PR is clean and is never re-halted by the reconciliation sweep.

### Acceptance Criteria

#### Happy Path
- Given a finished PR that carried the label, draft, and body marker, when the finish clear path runs
  with verify-after-write, then a read-back confirms the `needs-remediation` label is absent, the PR
  `isDraft:false` (ready), and the body marker is removed.
- Given the finish clear path has removed the body marker, when `reconcileHaltPrs` next runs, then
  the finished PR is NOT enumerated (no marker) and is therefore never converted back to draft or
  re-labeled.

#### Negative Paths
- Given the label-remove call fails on the first attempt, when the clear path re-reads and still sees
  the label, then it retries (bounded) and confirms removal, or returns a `partial` result without
  throwing on exhaustion.
- Given the `gh pr ready` (flip-to-ready) call fails, when the re-read still shows `isDraft:true`,
  then the clear path retries bounded and reports `partial` on exhaustion (never throws).
- Given the body marker removal fails but label+ready succeeded, when the sweep next runs, then it
  finds the still-marked PR — but since it is ready + unlabeled the sweep re-asserts draft+label
  (a real risk); therefore the clear path MUST confirm marker removal, and this scenario asserts the
  clear path treats a residual marker as `partial` (surfaced), not silent success.

### Done When
- [ ] The finish clear paths (`daemon-runner.ts` clear-on-success and `rehabilitateHaltPr`) re-read
      after clearing and assert: no `needs-remediation` label, `isDraft:false`, body marker removed.
- [ ] A fake `gh` proves: after finish, `reconcileHaltPrs` enumerates zero PRs for that branch
      (marker gone → not re-halted).
- [ ] A fake `gh` scripted to fail label-remove once then succeed produces a confirmed-clean result
      (retry proven); scripted to fail every attempt produces `partial` without throwing.
