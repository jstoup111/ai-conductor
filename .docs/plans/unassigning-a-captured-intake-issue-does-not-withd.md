# Implementation Plan: Unassigning a captured intake issue does not withdraw it from claim

**Date:** 2026-11-15
**Design:** none (technical track, Tier S — see `.docs/track/unassigning-a-captured-intake-issue-does-not-withd.md`)
**Stories:** .docs/stories/unassigning-a-captured-intake-issue-does-not-withd.md
**Conflict check:** Not required (Tier S)

## Summary

Make `compose claim` serve a `github-issues` candidate only while the machine owner is among the
issue's current assignees, skipping (and reporting) unassigned or unreadable candidates without
touching their ledger entry or inbox position. Three tasks: the not-assigned skip and its claim
wiring, the preserved assigned and reassignment paths, and the assignment-unknown skip.

## Technical Approach

- **Verified current behavior (local main `5d2f96421a`).**
  - The `claim` case of `dispatchEngineer` (`src/conductor/src/engine/engineer-cli.ts`) wraps the file queue with `createDeliveryGuardedQueue(queue, ledger, { gh, logger: { info: (msg) => printErr(msg) }, config })` and hands it to `claimUnblocked`. In production `claimUnblocked` is given `resolveBands`, so it drains every pending envelope through the guard's `claim()` until it returns `null`, then releases everything it did not serve.
  - The guard's `claim()` first runs `reapStaleClaimed()` (stale `claimed` ledger entries → `pending`, plus a synthetic `[reaped stale claim]` envelope). `compose unclaim` and `compose requeue --stale` likewise move the ledger to `pending` and enqueue a `[recovered stale claim]` envelope (`enqueueRecoveredEnvelope`). Every one of these candidates reaches the guard's healthy path (ledger `pending`/`unseen` or absent), which is the only branch of `innerClaim` that returns a candidate to the caller.
  - In that healthy path, a `github-issues` candidate with a parseable `sourceRef` is probed with `getIssueState`; `closed` forgets the ledger entry and acks the envelope (`Dropped closed issue <ref>`), anything else is served. Nothing reads assignment.
  - The guard already has a hold path: `held.push(candidate); return innerClaim();`. Held candidates are released back to the inbox (`queue.release`) when the underlying queue returns `null`, with no ledger write; `reconcileStrandedClaims` at the start of the next claim also releases any `.claimed` envelope whose ledger entry is `pending`.
  - `createGithubIntakeAuthorization` in `src/conductor/src/engine/engineer/intake/github-issues.ts` has a private `currentAssignees` read: `gh issue view <n> -R <repo> --json assignees` through `runTrackerRead`, returning a lowercase login `Set`, or `null` when the call throws, the payload has no `assignees` array, or any entry lacks a string login.
  - The machine owner is `resolveDaemonOwner(await readMachineOwnerConfig(), gh, cwd)` (`spec_owner` from the user config, else the `gh api user` login, else `{ resolved: false }`), lowercased by `normalizeOwnerId`. `DispatchEngineerOpts.intakeResolveActor` is the existing test seam for it (used by `forget` and `migrate-issue-deps`).
- **Selected design (approach A in the track marker).**
  - Export the read as `readIssueAssignees(gh, cwd, repository, number): Promise<Set<string> | null>` from `github-issues.ts` with today's exact parse rules; `currentAssignees` delegates to it so write-back authorization is unchanged.
  - Add `resolveOwner?: () => Promise<OwnerResolution>` to `DeliveryGuardDeps`. The guard resolves the owner at most once per `claim()` call (a resolver throw counts as unresolved), never caching across calls.
  - In the healthy path, after the closed-issue probe and only for a parseable `github-issues` candidate when `resolveOwner` is supplied: unresolved owner → hold and log `Skipped <ref>: assignment unknown (machine owner unresolved)`; `readIssueAssignees` returns `null` → hold and log `Skipped <ref>: assignment unknown (assignees read failed)`; the lowercase owner id is not in the set → hold and log `Skipped <ref>: not assigned to machine owner <owner>`; otherwise serve as today. A closed issue keeps today's forget-and-drop and never reaches the assignment check.
  - In the `claim` case, pass `resolveOwner: opts.intakeResolveActor ?? (async () => resolveDaemonOwner(await readMachineOwnerConfig(), gh, process.cwd()))`, mirroring the `migrate-issue-deps` default.
- **Pattern-source for the hold:** the guard's existing unknown-PR-state arm (`logger.info(...); held.push(candidate); return innerClaim();`). Reuse it; add no new release or ledger path.
- **Telemetry:** stderr lines through the guard's existing `logger`, like `Dropped closed issue <ref>`. Not a new channel (`.agents/skills/event-spine/SKILL.md` step 1: no watcher, sidecar, ledger, or IPC is added). The claim JSON output shape is unchanged.
- **Test seam:** drive the real `dispatchEngineer({ kind: 'claim' })` against a real `createFileQueue` and `createLedger` in a scratch engineer dir, faking only `gh` (answering the priority-label read, the `blocked_by` read, the `--json state` probe, and the `--json assignees` read) and the owner through `intakeResolveActor`, except where a task says to exercise the default resolver. Search hint: `test/acceptance/intake-claim-closed-issue-guard.acceptance.test.ts` and `test/engine/engineer/engineer-cli-claim-stale-reap.acceptance.test.ts` show the fake-`gh` and seeding shapes.

## Prerequisites

- None.

## Tasks

### Task 1: Claim skips and reports a github-issues candidate not assigned to the machine owner
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/engine/engineer/engineer-cli-claim-assignment-guard.test.ts` through `dispatchEngineer({ kind: 'claim' })` with `intakeResolveActor` returning `{ resolved: true, id: 'owner' }` and a fake `gh` whose `--json assignees` answer is configurable per issue (pattern: the fake-`gh` shape in `intake-claim-closed-issue-guard.acceptance.test.ts`, matched loosely on `issue view`, distinguishing the `assignees` and `state` reads by their `--json` value):
   - (a) One pending open issue `o/a#1` with assignees `[{"login":"someone-else"}]`: printed output is exactly `{"kind":"claim","empty":true}`, exit code 0, and exactly one stderr line equal to `Skipped o/a#1: not assigned to machine owner owner`.
   - (b) After (a): the ledger entry is `pending` with the same `attempts` as seeded, the queue's `list()` contains the envelope and `listClaimed()` does not, and no claim record file exists for `o/a#1` in the engineer dir.
   - (c) A ledger entry `claimed` with `claimedAt` two days old and no envelope, for an unassigned open issue: claim does not serve it and stderr contains `Skipped o/a#1: not assigned to machine owner owner`.
   - (d) The same unassigned issue recovered first by `dispatchEngineer({ kind: 'unclaim', sourceRef })` and, in a separate scratch dir, by `dispatchEngineer({ kind: 'requeue', stale: true })`: the following claim does not serve it and stderr contains the not-assigned skip line in both cases.
   - (e) Two unlabeled pending issues, unassigned `o/a#1` received before assigned `o/a#2`: claim serves `o/a#2` and stderr contains the not-assigned skip line for `o/a#1`.
   - (f) An issue whose state probe answers `CLOSED` and whose assignees are empty: the ledger entry is gone, the envelope is gone, output is `{"kind":"claim","empty":true}`, stderr contains `Dropped closed issue o/a#1` and no `not assigned` line.
2. Verify RED.
3. Implement:
   - In `github-issues.ts`, export `readIssueAssignees(gh, cwd, repository, number)` holding `currentAssignees`' body verbatim (same `runTrackerRead` call and parse rules) and make `currentAssignees` delegate to it.
   - In `delivery-guard.ts`, add `resolveOwner?` to `DeliveryGuardDeps`, resolve once per `claim()` call, and add the not-assigned check after the closed-issue probe in the healthy path, reusing the unknown-PR-state hold shape (`logger.info(...); held.push(candidate); return innerClaim();`). For this task a `null` read or unresolved owner may also hold; Task 3 fixes their wording.
   - In `engineer-cli.ts`'s `claim` case, pass `resolveOwner` as described in Technical Approach.
4. Run the existing claim-path suites named under Files. Where a suite now fails only because its fake `gh` does not answer the assignees read, inject `intakeResolveActor` with a fixed owner and have its fake answer `--json assignees` with that owner assigned; change no assertion.
5. Verify GREEN; commit "fix(intake): claim skips github issues no longer assigned to the machine owner".

**Done when:**
- [test] `engineer-cli-claim-assignment-guard.test.ts` asserts that `dispatchEngineer` claim, via the delivery guard's new assignment check, prints exactly `{"kind":"claim","empty":true}` and returns 0 for a lone unassigned open issue, with exactly one stderr line `Skipped o/a#1: not assigned to machine owner owner` naming the reference, the reason, and the owner login.
- [test] The same test asserts that after the skip the guard's hold-and-release left the ledger entry `pending` with its seeded `attempts`, the envelope in the queue's pending `list()` and absent from `listClaimed()`, and no claim record file for that reference.
- [test] The same file asserts that an unassigned issue entering claim through each of the stale-claim reap, `unclaim`, and `requeue --stale` paths is not served and produces the not-assigned skip line for that reference.
- [test] The same file asserts that with an unassigned issue received before an assigned issue in the same band, claim serves the assigned issue and still prints the not-assigned skip line for the unassigned one.
- [test] The same file asserts that a closed, unassigned issue has its ledger entry and envelope removed, prints `{"kind":"claim","empty":true}`, and logs `Dropped closed issue o/a#1` with no `not assigned` line.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/github-issues.ts` — export `readIssueAssignees`; `currentAssignees` delegates
- `src/conductor/src/engine/engineer/intake/delivery-guard.ts` — `resolveOwner` dep; serve-time assignment check
- `src/conductor/src/engine/engineer-cli.ts` — pass the machine-owner resolver into the claim guard
- `src/conductor/test/engine/engineer/engineer-cli-claim-assignment-guard.test.ts` — new entry-point suite
- `src/conductor/test/engine/engineer/engineer-cli-intake.test.ts` — fake `gh` answers the assignees read
- `src/conductor/test/engine/engineer/engineer-cli-claim-delivery-guard.test.ts` — same
- `src/conductor/test/engine/engineer/engineer-cli-claim-stale-reap.acceptance.test.ts` — same
- `src/conductor/test/engine/engineer/engineer-cli-claim-record.test.ts` — same
- `src/conductor/test/engine/engineer/engineer-cli-launch-intake.test.ts` — same
- `src/conductor/test/engine/engineer/engineer-cli-claim-strand-recovery.test.ts` — same
- `src/conductor/test/engine/engineer/engineer-cli-claim-strand-scope.test.ts` — same
- `src/conductor/test/engine/engineer/engineer-cli-claim-strand-faults.test.ts` — same
- `src/conductor/test/engine/engineer/engineer-cli-claim-lease-contention.test.ts` — same
- `src/conductor/test/acceptance/intake-claim-closed-issue-guard.acceptance.test.ts` — same
- `src/conductor/test/acceptance/dependency-ordered-intake-and-dispatch.test.ts` — same
- `src/conductor/test/acceptance/harden-intake-ledger-durability.acceptance.test.ts` — same

**Dependencies:** none

### Task 2: Assigned and reassigned issues are claimed exactly as before
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write tests in `engineer-cli-claim-assignment-guard.test.ts` (same harness as Task 1):
   - (a) Run claim with `o/a#1` unassigned, then flip the fake's assignees to `[{"login":"owner"}]` and run claim again against the same queue and ledger with no ledger edit between: first output is `{"kind":"claim","empty":true}`, second output's `kind`, `text`, `source`, and `sourceRef` equal the envelope's, and the ledger entry moved `pending` → `claimed`.
   - (b) Assignees `[{"login":"someone-else"},{"login":"owner"}]`: served.
   - (c) Assignees `[{"login":"Owner"}]` with `intakeResolveActor` returning id `OWNER`: served (comparison lowercases both sides).
   - (d) Only owner-assigned issues pending: the printed object deep-equals `{ kind: 'claim', text, body: text, source, sourceRef, inbound }` built from the envelope; the ledger entry deep-equals the seeded entry with only `status` changed to `claimed` (plus whatever timestamp fields `ledger.transition` stamps today), with `attempts` unchanged; the claim record file parses to exactly `{ sourceRef, body: text, inbound }` (the shape `persistClaimRecord` writes today); and stderr has no line containing `not assigned` or `assignment unknown`.
   - (e) A pending `claude-session` envelope with no ledger entry: served, and the fake `gh` recorded no call containing `--json` `assignees`.
2. Verify RED. If Task 1's implementation already satisfies a case, it passes immediately and this task commits only those tests; fix only cases that fail (for example lowercase the resolved owner id in the guard for (c)).
3. Verify GREEN; commit "test(intake): assigned and reassigned issues are claimed as before".

**Done when:**
- [test] `engineer-cli-claim-assignment-guard.test.ts` asserts that two `dispatchEngineer` claims with the fake assignees flipped to the owner between them print empty then a served claim whose `kind`, `text`, `source`, and `sourceRef` match the envelope, and the ledger entry goes `pending` to `claimed` with no ledger write by the test in between.
- [test] The same file asserts that the guard serves an issue co-assigned to the owner and another user, and an issue whose GitHub login differs from the resolved owner id only in letter case.
- [test] The same file asserts that with only owner-assigned issues pending, the printed claim deep-equals the pre-change `{ kind, text, body, source, sourceRef, inbound }` object, the ledger entry deep-equals the seeded entry differing only in `status` set to `claimed` and the timestamp fields today's `ledger.transition` stamps, with `attempts` unchanged, the claim record parses to exactly `{ sourceRef, body, inbound }`, and stderr has no `not assigned` or `assignment unknown` line.
- [test] The same file asserts that a pending `claude-session` envelope is served and the fake `gh` recorded no `--json assignees` call.

**Files likely touched:**
- `src/conductor/test/engine/engineer/engineer-cli-claim-assignment-guard.test.ts` — preserved-path cases
- `src/conductor/src/engine/engineer/intake/delivery-guard.ts` — only if a case fails

**Dependencies:** Task 1

### Task 3: An unreadable assignment or unresolved owner is reported as unknown and kept pending
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `engineer-cli-claim-assignment-guard.test.ts`:
   - (a) The fake's assignees read throws for `o/a#1`; in a second case it returns `{"assignees":[{"name":"x"}]}` (an entry with no string login); in a third it returns `OPEN`. Each: output `{"kind":"claim","empty":true}`, exactly one stderr line `Skipped o/a#1: assignment unknown (assignees read failed)`, ledger `pending` with seeded `attempts`, envelope pending.
   - (b) No `intakeResolveActor` injected, `AI_CONDUCTOR_USER_CONFIG_DIR` pointed at an empty scratch dir (no `spec_owner`), and the fake `gh` throwing for `api user`: output empty, exactly one stderr line `Skipped o/a#1: assignment unknown (machine owner unresolved)`, ledger `pending`, envelope pending.
   - (c) After (a)'s throwing case, re-run claim with the read answering `[{"login":"owner"}]`: served.
   - (d) Across (a) through (c), the fake `gh` recorded no `issue comment`, `issue edit`, `issue close`, or `api` write call, and the ledger still holds an entry for `o/a#1` after each skip.
2. Verify RED.
3. Implement in `delivery-guard.ts`: distinguish the unresolved-owner and `null`-read holds from the not-assigned hold with the two `assignment unknown` messages above, both reusing the existing hold shape and writing nothing to the ledger.
4. Verify GREEN; commit "fix(intake): claim reports an unknown assignment and keeps the issue pending".

**Done when:**
- [test] `engineer-cli-claim-assignment-guard.test.ts` asserts that for a throwing assignees read, a payload entry with no string login, and a non-JSON payload, `dispatchEngineer` claim prints `{"kind":"claim","empty":true}` and exactly one stderr line `Skipped o/a#1: assignment unknown (assignees read failed)`.
- [test] The same file asserts that through the default `resolveDaemonOwner` chain, with no `spec_owner` in the `AI_CONDUCTOR_USER_CONFIG_DIR` config and a failing `gh api user`, claim prints empty and exactly one stderr line `Skipped o/a#1: assignment unknown (machine owner unresolved)`.
- [test] The same file asserts that after each assignment-unknown skip the ledger entry still exists as `pending` with its seeded `attempts` and the envelope is in the pending `list()`, and that a following claim with an owner-assigned answer serves the issue.
- [test] The same file asserts that the fake `gh` recorded no comment, label, close, assignee, or other write call across the unknown-assignment runs.

**Files likely touched:**
- `src/conductor/src/engine/engineer/intake/delivery-guard.ts` — assignment-unknown messages
- `src/conductor/test/engine/engineer/engineer-cli-claim-assignment-guard.test.ts` — unknown-assignment cases

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──┬──▶ Task 2
         └──▶ Task 3
```

## Integration Points

- After Task 1: the production entry point `dispatchEngineer({ kind: 'claim' })` (`ai-conductor compose claim`) reaches the delivery guard's assignment check with the machine-owner resolver wired in, for pending, reaped, and recovered candidates alike.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the inbox holds one pending `github-issues` envelope for an open issue whose current assignees do not include the machine owner, when `compose claim` runs, then it prints `{"kind":"claim","empty":true}` and exits 0. | 1 | "prints exactly `{"kind":"claim","empty":true}` and returns 0 for a lone unassigned open issue" | diff-local |
| Story 1 happy: Given that skip, when claim finishes, then stderr contains one line naming the issue reference and stating it was skipped because it is not assigned to the machine owner, naming the owner login. | 1 | "with exactly one stderr line `Skipped o/a#1: not assigned to machine owner owner` naming the reference, the reason, and the owner login" | diff-local |
| Story 1 happy: Given an unassigned open issue whose ledger entry was `claimed` past the stale-claim window, when `compose claim` reaps it back to `pending`, then claim does not serve it and stderr reports the same not-assigned skip for that reference. | 1 | "an unassigned issue entering claim through each of the stale-claim reap, `unclaim`, and `requeue --stale` paths is not served and produces the not-assigned skip line for that reference" | diff-local |
| Story 1 happy: Given an unassigned open issue that `compose unclaim` or `compose requeue --stale` returned to `pending`, when `compose claim` runs, then claim does not serve it and stderr reports the same not-assigned skip for that reference. | 1 | "an unassigned issue entering claim through each of the stale-claim reap, `unclaim`, and `requeue --stale` paths is not served and produces the not-assigned skip line for that reference" | diff-local |
| Story 1 negative: Given the inbox holds an unassigned issue received before an assigned issue in the same priority band, when `compose claim` runs, then it serves the assigned issue and still reports the not-assigned skip for the unassigned one. | 1 | "claim serves the assigned issue and still prints the not-assigned skip line for the unassigned one" | diff-local |
| Story 1 negative: Given a skipped issue, when claim finishes, then its ledger entry is still `pending` with an unchanged `attempts` count, its inbox envelope is pending (not `.claimed`, not deleted), and no claim record is written for it. | 1 | "left the ledger entry `pending` with its seeded `attempts`, the envelope in the queue's pending `list()` and absent from `listClaimed()`, and no claim record file for that reference" | diff-local |
| Story 1 negative: Given an issue that is both closed and unassigned, when `compose claim` runs, then it is forgotten and dropped exactly as a closed issue is today, and no not-assigned skip is reported for it. | 1 | "a closed, unassigned issue has its ledger entry and envelope removed, prints `{"kind":"claim","empty":true}`, and logs `Dropped closed issue o/a#1` with no `not assigned` line" | diff-local |
| Story 2 happy: Given an issue that a previous `compose claim` skipped as not assigned, when the operator is reassigned and `compose claim` runs again, then claim serves that issue with the same `kind`, `text`, `source`, and `sourceRef` output as any served claim and its ledger entry becomes `claimed`. | 2 | "print empty then a served claim whose `kind`, `text`, `source`, and `sourceRef` match the envelope, and the ledger entry goes `pending` to `claimed`" | diff-local |
| Story 2 happy: Given a pending issue whose current assignees include the machine owner and another user, when `compose claim` runs, then claim serves it. | 2 | "the guard serves an issue co-assigned to the owner and another user" | diff-local |
| Story 2 happy: Given a pending issue assigned to the machine owner where the GitHub login and the resolved owner differ only in letter case, when `compose claim` runs, then claim serves it. | 2 | "an issue whose GitHub login differs from the resolved owner id only in letter case" | diff-local |
| Story 2 negative: Given only issues assigned to the machine owner are pending, when `compose claim` runs, then the served issue, its output, its ledger transition, and its claim record are the same as before this change, and stderr contains no not-assigned or assignment-unknown skip line. | 2 | "the printed claim deep-equals the pre-change `{ kind, text, body, source, sourceRef, inbound }` object, the ledger entry deep-equals the seeded entry differing only in `status` set to `claimed` and the timestamp fields today's `ledger.transition` stamps, with `attempts` unchanged, the claim record parses to exactly `{ sourceRef, body, inbound }`, and stderr has no `not assigned` or `assignment unknown` line" | diff-local |
| Story 2 negative: Given a pending envelope from a source other than `github-issues`, when `compose claim` runs, then no assignment read is made for it and it is served as today. | 2 | "a pending `claude-session` envelope is served and the fake `gh` recorded no `--json assignees` call" | diff-local |
| Story 3 happy: Given a pending open issue whose assignees read fails (the `gh` call throws or returns output that is not a JSON object with an assignees array of logins), when `compose claim` runs, then claim does not serve it and stderr contains one line naming the issue reference and stating its assignment is unknown. | 3 | "prints `{"kind":"claim","empty":true}` and exactly one stderr line `Skipped o/a#1: assignment unknown (assignees read failed)`" | diff-local |
| Story 3 happy: Given the machine owner cannot be resolved (no `spec_owner` and no `gh` login), when `compose claim` runs with a pending `github-issues` issue, then claim does not serve it and stderr reports the assignment as unknown because the owner is unresolved. | 3 | "with no `spec_owner` in the `AI_CONDUCTOR_USER_CONFIG_DIR` config and a failing `gh api user`, claim prints empty and exactly one stderr line `Skipped o/a#1: assignment unknown (machine owner unresolved)`" | diff-local |
| Story 3 negative: Given an assignment-unknown skip, when claim finishes, then the ledger entry is still `pending` with unchanged attempts and the envelope is pending, so a later claim with a readable assignment serves it. | 3 | "the ledger entry still exists as `pending` with its seeded `attempts` and the envelope is in the pending `list()`, and that a following claim with an owner-assigned answer serves the issue" | diff-local |
| Story 3 negative: Given an assignment-unknown skip, when claim finishes, then the ledger still holds an entry for that reference and no GitHub write (comment, label, close, or assignee change) was made. | 3 | "the fake `gh` recorded no comment, label, close, assignee, or other write call across the unknown-assignment runs" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
