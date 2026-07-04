# Implementation Plan: Engineer Claim Delivery Guard (#243)

**Date:** 2026-07-04
**Design:** adr-2026-07-04-claim-time-delivery-evidence-guard.md (APPROVED) + architecture-review-2026-07-04-engineer-claim-delivery-guard.md
**Stories:** .docs/stories/engineer-claim-delivery-guard.md (Status: Accepted)
**Conflict check:** Clean as of 2026-07-04 (.docs/conflicts/engineer-claim-delivery-guard.md)
**Complexity:** M (.docs/complexity/engineer-claim-delivery-guard.md)

## Summary

Stop `engineer claim` from re-dispatching intake entries that already carry delivery
evidence, record evidence on every handoff outcome, and add an `engineer resolve`
recovery primitive. 14 TDD tasks in `src/conductor` (vitest; run via
`rtk proxy npx vitest run`).

## Technical Approach

- **New module `src/conductor/src/engine/engineer/intake/delivery-guard.ts`** exporting
  `createDeliveryGuardedQueue(queue, ledger, deps)` — a decorator implementing the
  `DependencyClaimQueue` surface (`claim`/`release`) that `claimUnblocked` consumes.
  Its `claim()` loops over the inner queue's candidates and applies the ADR rules per
  candidate before surfacing one:
  - no ledger entry, or status `unseen`/`pending` → serve (healthy path, zero friction);
  - `prUrl` recorded → `verifyPrState(prUrl)` via the injected gh runner
    (`gh pr view <url> --json state,mergedAt`, same probe as `maybeReopen`):
    `open`/`merged` → `ledger.transition(…,'done')` preserving evidence, inner
    `ack()` (unlink-ENOENT tolerated as success), log heal, continue;
    `closed-unmerged` → below-cap: `ledger.reopen()` then serve; at-cap:
    `needs-manual` + ack + continue (reuses `REOPEN_ATTEMPTS_CAP`, exported from
    `github-issues.ts`); `unknown` (lookup failed) → hold the envelope aside, continue,
    and release all held envelopes back before returning (mirrors `claimUnblocked`'s
    held-list pattern so the walk cannot livelock on the same candidate);
  - status beyond `pending` with no `prUrl` → duplicate of in-flight work: ack (drop),
    entry untouched, log names `engineer forget <ref>` as the re-open path.
  - Any guard-side ledger write failure → do NOT serve that candidate; report stderr;
    leave the envelope pending (fail-safe).
- **Wiring:** the `claim` case in `engineer-cli.ts` wraps its file queue with the guard
  before handing it to `claimUnblocked`. Dependency-walk semantics are untouched.
- **Handoff evidence:** in the `handoff` case, both non-`pr-opened` outcomes (openSpecPr
  throw → local-commit, and `pr-skipped`/no-remote) gain an advisory ledger write when
  `--source-ref` is present: read the entry, re-`transition` to its CURRENT status with
  `{branch}` meta (evidence without lifecycle change). Failure → stderr, exit unchanged.
- **`engineer resolve <sourceRef> --pr-url <url> [--branch <b>]`:** new CLI case +
  dispatch-parser entry + usage line. Validates `--pr-url` is `http(s)://…` before any
  write; absent entry → `{kind:'resolve', found:false}` exit 0; otherwise
  `transition('done', {prUrl, branch?})` and echo `{sourceRef, priorStatus, prUrl,
  branch}` for operator verification. Naturally idempotent.
- **Sequencing:** guard module first (pure, DI'd, unit-testable), then CLI wiring, then
  the independent handoff + resolve changes, docs last.

## Prerequisites

None — no schema/migration; ledger already carries `branch`/`prUrl`/`attempts`.
`npm install` in the worktree's `src/conductor` (per-worktree install).

## Tasks

### Task 1: delivery-guard module skeleton + PR-state probe
**Story:** TR-1 (all guard stories — shared infrastructure)
**Type:** infrastructure
**Steps:**
1. Write failing tests for `verifyPrState(gh, url)`: gh returns `{state:'OPEN'}` → `open`; `{state:'MERGED'}`/`mergedAt` set → `merged`; `{state:'CLOSED', mergedAt:null}` → `closed-unmerged`; gh throws / unparseable stdout → `unknown`.
2. RED. 3. Implement `delivery-guard.ts` with the probe + module types. 4. GREEN. 5. Commit.
**Files:** `src/engine/engineer/intake/delivery-guard.ts`, `…/delivery-guard.test.ts` (new)
**Dependencies:** none

### Task 2: guard passthrough for healthy candidates
**Story:** "Closed-unmerged … " negative path (no false positives) + "In-flight duplicate" negative path (`pending` serves)
**Type:** happy-path
**Steps:**
1. Failing tests: `createDeliveryGuardedQueue` serves a candidate with no ledger entry (non-recording source) and one at `pending`, byte-identical envelope, no ledger writes, no gh calls.
2. RED. 3. Implement the decorator loop + passthrough branch. 4. GREEN. 5. Commit.
**Files:** `delivery-guard.ts`, `delivery-guard.test.ts`
**Dependencies:** Task 1

### Task 3: auto-heal delivered entries (open/merged) and keep walking
**Story:** "Delivered entry is never re-served" happy paths
**Type:** happy-path
**Steps:**
1. Failing tests: entry `claimed`+`prUrl`, PR OPEN → entry becomes `done` (branch/prUrl preserved), inner ack called, next candidate served (or null). Repeat for MERGED, and for stuck statuses `routed` and `deciding`.
2. RED. 3. Implement heal branch. 4. GREEN. 5. Commit.
**Files:** `delivery-guard.ts`, `delivery-guard.test.ts`
**Dependencies:** Task 2

### Task 4: heal-path failure tolerance (ENOENT ack race, ledger write failure)
**Story:** "Delivered entry" negative paths
**Type:** negative-path
**Steps:**
1. Failing tests: (a) inner ack throws ENOENT → treated as success, walk continues; (b) ledger.transition throws → candidate NOT served, envelope left pending (released), stderr log emitted, claim() still returns (next candidate or null).
2. RED. 3. Implement tolerance + fail-safe. 4. GREEN. 5. Commit.
**Files:** `delivery-guard.ts`, `delivery-guard.test.ts`
**Dependencies:** Task 3

### Task 5: closed-unmerged keeps FR-39/40 semantics
**Story:** "Closed-unmerged spec PR keeps re-eligibility semantics"
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: CLOSED-unmerged with attempts<cap → `ledger.reopen` called (attempts+1) and envelope served; attempts≥cap → entry `needs-manual`, envelope acked, parking logged, next candidate returned. Export `REOPEN_ATTEMPTS_CAP` from `github-issues.ts` and assert the guard uses it (no second constant).
2. RED. 3. Implement. 4. GREEN. 5. Commit.
**Files:** `delivery-guard.ts`, `delivery-guard.test.ts`, `github-issues.ts` (export only)
**Dependencies:** Task 3

### Task 6: unknown PR state fails safe with no sticky state
**Story:** "PR-state lookup failure fails safe" (all criteria)
**Type:** negative-path
**Steps:**
1. Failing tests: gh throws → candidate held + released back (still pending after claim() returns), no ledger mutation, log contains sourceRef; only-candidate case → claim() yields null (CLI then reports empty/all-blocked); follow-up claim with healthy gh heals the same entry (no sticky skip).
2. RED. 3. Implement held-list release. 4. GREEN. 5. Commit.
**Files:** `delivery-guard.ts`, `delivery-guard.test.ts`
**Dependencies:** Task 3

### Task 7: in-flight duplicate envelope dropped, entry untouched
**Story:** "In-flight duplicate envelope is dropped without touching the entry"
**Type:** negative-path
**Steps:**
1. Failing tests: entry `claimed` (no prUrl) + envelope → envelope acked, ledger entry deep-equal unchanged, log line includes `engineer forget <sourceRef>`; after an operator `forget` + re-record, a fresh envelope serves normally.
2. RED. 3. Implement drop branch. 4. GREEN. 5. Commit.
**Files:** `delivery-guard.ts`, `delivery-guard.test.ts`
**Dependencies:** Task 2

### Task 8: wire the guard into the claim CLI case
**Story:** TR-1 (integration — "Done When" bullets asserting CLI JSON output)
**Type:** happy-path (integration point)
**Steps:**
1. Failing test in the engineer-cli suite: seed ledger `claimed`+`prUrl` (gh stub OPEN) + duplicate inbox envelope; run the CLI claim dispatch; assert stdout `{"kind":"claim","empty":true}`, ledger `done`, inbox empty. Second test: healthy `pending` entry still claims normally through the wrapped queue (dependency-walk regression).
2. RED. 3. Wrap the queue with `createDeliveryGuardedQueue` in the `claim` case, injecting the existing `gh` runner + printErr logger. 4. GREEN. 5. Commit.
**Files:** `engineer-cli.ts`, engineer-cli test file
**Dependencies:** Tasks 3–7

### Task 9: handoff local-commit fallback records branch evidence
**Story:** "Handoff records delivery evidence on the local-commit fallback" happy path + no-sourceRef negative
**Type:** happy-path
**Steps:**
1. Failing tests: handoff with `--source-ref` and openSpecPr injected to throw → ledger entry gains `branch: <branch>` with status unchanged, stdout kind `local-commit`; same for the `pr-skipped` outcome; without `--source-ref` → no ledger write attempted.
2. RED. 3. Implement advisory evidence write on both non-pr-opened outcomes (read entry → transition to current status with `{branch}` meta). 4. GREEN. 5. Commit.
**Files:** `engineer-cli.ts`, engineer-cli test file
**Dependencies:** none (parallel to guard tasks)

### Task 10: handoff evidence-write failure surfaced; pr-opened regression
**Story:** "Handoff records delivery evidence" negative paths
**Type:** negative-path
**Steps:**
1. Failing tests: (a) ledger write throws during local-commit fallback → exit 0, stderr contains the failure; (b) pr-opened path still ends `done`+`prUrl`+`branch` (reportDone regression).
2. RED. 3. Implement try/catch + stderr report. 4. GREEN. 5. Commit.
**Files:** `engineer-cli.ts`, engineer-cli test file
**Dependencies:** Task 9

### Task 11: `engineer resolve` argument parsing + usage
**Story:** "`engineer resolve` …" negative paths (missing/malformed `--pr-url`)
**Type:** negative-path (infrastructure)
**Steps:**
1. Failing tests: dispatch parser recognizes `resolve <sourceRef> --pr-url <url> [--branch <b>]`; missing `--pr-url` → exit 1 + usage on stderr, no ledger write; `--pr-url not-a-url` → exit 1 + validation message, no write; `resolve` appears in the usage/help text.
2. RED. 3. Implement parser entry + validation. 4. GREEN. 5. Commit.
**Files:** `engineer-cli.ts`, engineer-cli test file
**Dependencies:** none

### Task 12: `engineer resolve` happy path, idempotency, found:false
**Story:** "`engineer resolve` marks an entry delivered" happy paths + absent-ref negative
**Type:** happy-path
**Steps:**
1. Failing tests: stranded `claimed`+branch entry → resolve → entry `done` with given prUrl, branch preserved (or overridden by `--branch`), JSON echoes `{sourceRef, priorStatus, prUrl, branch}`; re-run → unchanged, exit 0; unknown ref → `{kind:'resolve', found:false}` exit 0.
2. RED. 3. Implement the case handler. 4. GREEN. 5. Commit.
**Files:** `engineer-cli.ts`, engineer-cli test file
**Dependencies:** Task 11

### Task 13: resolve → claim integration (the two halves compose)
**Story:** "`engineer resolve`" Done-When integration bullet
**Type:** happy-path (integration point)
**Steps:**
1. Failing test: strand an entry (`claimed`, no prUrl) with a duplicate envelope; run `resolve` with a prUrl (gh stub OPEN); then run claim → duplicate healed/dropped via the TR-1 guard, `empty:true`, entry `done`.
2. RED. 3. (Wiring should already satisfy — fix any seam mismatch.) 4. GREEN. 5. Commit.
**Files:** engineer-cli test file
**Dependencies:** Tasks 8, 12

### Task 14: docs + changelog
**Story:** "Docs and changelog track the new behavior"
**Type:** infrastructure
**Steps:**
1. Document the claim-time guard (auto-heal, fail-safe skip, duplicate drop + `forget` path) and `engineer resolve` (flags + recovery example) in `README.md` and `src/conductor/README.md`.
2. Add CHANGELOG `[Unreleased]`: **Fixed** — claim re-dispatch of delivered/stranded intake entries (#243); **Added** — `engineer resolve` recovery subcommand + local-commit evidence recording.
3. Verify documented flows against actual CLI behavior (run the commands). Commit.
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** Tasks 8, 10, 12

## Task Dependency Graph

```
T1 → T2 → T3 → T4
      │     ├─→ T5
      │     └─→ T6
      └─→ T7
T3..T7 → T8 ─┐
T9 → T10     ├─→ T13 → T14
T11 → T12 ───┘      (T10 also → T14)
```

## Integration Points

- After Task 8: end-to-end guarded claim runs against a seeded ledger/inbox via the CLI.
- After Task 13: full strand-and-recover cycle (`handoff failure → resolve → claim heals`)
  verifiable end-to-end.

## Coverage Check

| Story criterion | Task(s) |
|---|---|
| Delivered (open/merged, incl. routed/deciding) never served, healed, envelope dropped | 3, 8 |
| Healed entry stays done / never re-offered | 3, 13 |
| ENOENT ack race tolerated | 4 |
| Heal ledger-write failure → not served, envelope kept | 4 |
| Closed-unmerged below cap → reopen + serve | 5 |
| Closed-unmerged at cap → needs-manual, not served | 5 |
| Healthy pending / non-recording source unchanged | 2, 8 |
| gh lookup failure → skip, no sticky state, recovery next run | 6 |
| In-flight duplicate dropped, entry untouched, forget logged | 7 |
| forget re-capture path still works after drop | 7 |
| Local-commit + pr-skipped record branch evidence; status unchanged | 9 |
| No sourceRef → no ledger write | 9 |
| Evidence-write failure → stderr, handoff still succeeds | 10 |
| pr-opened regression (done+prUrl+branch) | 10 |
| resolve happy/override/echo, idempotent, found:false | 12 |
| resolve missing/malformed --pr-url rejected pre-write; in help | 11 |
| resolve+claim compose | 13 |
| READMEs + CHANGELOG | 14 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (explicit tasks 4, 5, 6, 7, 10, 11)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
