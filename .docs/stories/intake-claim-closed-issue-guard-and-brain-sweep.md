**Status:** Accepted

# Stories: intake claim closed-issue guard + brain reconciliation sweep

Technical track. Acceptance criteria below are the definition of done. Design reference:
`.docs/decisions/adr-2026-07-22-intake-closed-issue-reconciliation.md`.

Shared vocabulary:
- **Envelope** — a durable inbox item (`inbox/*.json`) with `source` and `sourceRef`.
- **github-issues envelope** — `source === 'github-issues'`, `sourceRef` shaped `owner/repo#n`.
- **`getIssueState(repo, issue)`** — returns `'open' | 'closed' | null`; `null` on any `gh`
  failure (non-zero exit, network, auth, unparseable).
- **forget** — `ledger.forget(source, sourceRef)` (removes the entry; no-op if absent).

---

## Story: Claim delivers an open github issue unchanged

**Requirement:** TR-1 (claim guard — happy path)

As the engineer claim path, I want an open github issue to be delivered exactly as today,
so that the guard adds no regression to the normal flow.

### Acceptance Criteria

#### Happy Path
- Given the oldest unblocked candidate is a `github-issues` envelope whose `sourceRef` issue
  is OPEN, when `claim()` runs, then `getIssueState` returns `'open'` and the envelope is
  returned to the caller unchanged (ledger entry NOT forgotten, inbox envelope NOT dropped).
- Given the delivered envelope, when the caller `ack`s and transitions it, then the ledger
  entry advances to `claimed` exactly as before this feature.

#### Negative Paths
- Given a `github-issues` envelope whose issue is OPEN but `getIssueState` is invoked, when
  the probe issues its `gh` call, then the guard makes at most one issue-state probe per
  candidate (no repeated probing of the same envelope within one `claim()`).
- Given the candidate is a `pending` github-issues envelope (the pre-fix passthrough seam at
  `delivery-guard.ts:136`), when `claim()` runs, then the issue-state probe IS reached for it
  (a `pending` github-issues envelope is no longer delivered without a probe).

### Done When
- [ ] An open github-issues `pending` candidate is delivered by `createDeliveryGuardedQueue.claim()` and its ledger entry is unmodified.
- [ ] A unit test asserts the probe runs for a `pending` github-issues envelope (guarding the `:136` passthrough regression).
- [ ] No behavior change for the caller when the issue is open.

---

## Story: Claim never hands out a closed github issue

**Requirement:** TR-2 (claim guard — closed issue dropped + continue scan)

As the engineer claim path, I want a closed github issue to be reconciled and skipped, so
that no operator DECIDE cycle is ever spent on a dead issue (the #538 failure).

### Acceptance Criteria

#### Happy Path
- Given the claimed candidate is a `github-issues` envelope whose issue is CLOSED, when
  `claim()` runs, then the guard calls `ledger.forget(source, sourceRef)`, `queue.ack`s the
  inbox envelope (drops it), and continues scanning via the next-candidate path — the closed
  envelope is NEVER returned to the caller.
- Given a closed candidate followed by an open candidate, when `claim()` runs, then the closed
  one is forgotten+dropped and the OPEN one is returned.

#### Negative Paths
- Given the closed candidate is the only/last item in the queue, when `claim()` runs, then it
  forgets+drops the closed entry and returns `null` ("nothing to claim") cleanly — no crash,
  no exception surfaced to the caller.
- Given the inbox envelope file was already deleted by a concurrent writer, when the guard
  `ack`s it, then an `ENOENT` is treated as benign (the drop is considered done) and scanning
  continues — consistent with the existing benign-race handling in the guard.
- Given the ledger entry was already absent (already forgotten), when the guard forgets it,
  then it is a no-op and the drop+continue still proceeds.

### Done When
- [ ] A closed github-issues candidate is never returned from `claim()`; a test asserts `ledger.forget` + `queue.ack` were called and the next candidate (or `null`) is returned.
- [ ] A test covers "closed is the last candidate → `claim()` returns `null` without throwing".
- [ ] `ENOENT` on the drop is swallowed as benign; scanning continues.

---

## Story: Unknown issue state fails safe (never drop on uncertainty)

**Requirement:** TR-3 (claim guard — fail-safe on null)

As the engineer claim path, I want an unconfirmed issue state to be treated as still-open, so
that a transient GitHub/`gh` failure can never silently discard a live issue.

### Acceptance Criteria

#### Happy Path
- Given a `github-issues` candidate whose `getIssueState` returns `null` (gh non-zero exit,
  network error, or unparseable output), when `claim()` runs, then the envelope is delivered
  as if OPEN — the ledger entry is NOT forgotten and the inbox envelope is NOT dropped.

#### Negative Paths
- Given `getIssueState` throws rather than returning, when the guard probes, then the throw is
  caught and mapped to the same fail-safe "treat as open, deliver" outcome (no candidate is
  dropped on an exception).
- Given a `null` result, when `claim()` returns the envelope, then no ledger mutation occurred
  (assert store bytes unchanged) — an unknown state has zero side effects.

### Done When
- [ ] A test with `getIssueState` → `null` asserts the envelope is delivered and the ledger is untouched.
- [ ] A test with `getIssueState` throwing asserts the same fail-safe delivery (no drop, no mutation).

---

## Story: Non-github-issues envelopes bypass the issue probe

**Requirement:** TR-4 (claim guard — source scoping)

As the engineer claim path, I want only `github-issues` envelopes to be issue-probed, so that
other intake sources keep their exact current behavior.

### Acceptance Criteria

#### Happy Path
- Given a candidate whose `source` is not `github-issues` (or has no parseable `owner/repo#n`
  `sourceRef`), when `claim()` runs, then NO `getIssueState` call is made and the candidate
  follows its existing (pre-feature) delivery/guard path unchanged.

#### Negative Paths
- Given a `github-issues` envelope whose `sourceRef` does not parse into `owner/repo` + numeric
  issue, when `claim()` runs, then the probe is skipped (treated as un-probeable → delivered,
  never dropped) and a diagnostic is logged — a malformed ref never causes a wrongful drop.

### Done When
- [ ] A test asserts a non-github-issues candidate reaches delivery with zero `getIssueState` calls.
- [ ] A test asserts a malformed `sourceRef` is delivered (not dropped) with the probe skipped.

---

## Story: sourceRef parses into repo + issue number

**Requirement:** TR-5 (sourceRef parsing)

As the guard and the sweep, I want `sourceRef` (`owner/repo#n`) parsed into the `(repo, issue)`
pair `getIssueState` expects, so that the probe targets the correct issue.

### Acceptance Criteria

#### Happy Path
- Given `sourceRef` = `jstoup111/ai-conductor#538`, when parsed, then `repo` = `jstoup111/ai-conductor`
  and `issue` = `538`, and `getIssueState('jstoup111/ai-conductor', '538')` is invoked.

#### Negative Paths
- Given `sourceRef` with no `#` (e.g. `jstoup111/ai-conductor`), when parsed, then it is
  reported un-parseable and the probe is skipped (fail-safe deliver, per TR-4).
- Given `sourceRef` with a non-numeric fragment after `#` (e.g. `owner/repo#abc`), when parsed,
  then it is reported un-parseable and the probe is skipped.

### Done When
- [ ] A parse unit test covers the valid case and both malformed cases.
- [ ] The parse is shared/consistent between the claim guard and the brain sweep.

---

## Story: Brain sweep reconciles closed pending issues out of the ledger + inbox

**Requirement:** TR-6 (brain sweep — happy path)

As the brain intake loop, I want a periodic sweep that removes closed pending issues, so that
the ledger/inbox stay clean between claims without operator action.

### Acceptance Criteria

#### Happy Path
- Given the ledger has `pending` github-issues entries A (issue closed), B (issue open), C
  (issue closed), when `reconcileClosedIssues` runs on a brain tick, then A and C are forgotten
  and their inbox envelopes dropped, B is untouched, and the returned summary reports
  `{ scanned: 3, forgotten: 2 }` (or equivalent counts).
- Given the sweep is wired into `intakeTick`, when a brain tick fires, then the sweep runs as
  part of that tick (observable via the summary/log line).

#### Negative Paths
- Given an entry whose inbox envelope file is already gone, when the sweep drops it, then the
  `ENOENT` is benign and the entry is still forgotten from the ledger (ledger and inbox
  converge, not diverge).
- Given the ledger file does not yet exist, when the sweep runs, then it treats the store as
  empty and returns a zero-count summary without error.

### Done When
- [ ] A test asserts closed pending entries are forgotten + their inbox envelopes dropped, open ones untouched, with correct summary counts.
- [ ] A test asserts the sweep is invoked from `intakeTick` on a tick.
- [ ] Missing inbox file / missing ledger file are handled without throwing.

---

## Story: Brain sweep touches only pending entries

**Requirement:** TR-7 (brain sweep — status scoping)

As the brain sweep, I want to reconcile only `pending` (unclaimed) entries, so that entries a
claim is actively working (`claimed`/`routed`/`deciding`) or already `done`/`needs-manual` are
never disturbed.

### Acceptance Criteria

#### Happy Path
- Given ledger entries with statuses `pending` (issue closed), `claimed` (issue closed),
  `routed` (issue closed), `done` (issue closed), when the sweep runs, then ONLY the `pending`
  entry is forgotten; `claimed`, `routed`, and `done` entries are left exactly as-is.

#### Negative Paths
- Given a `claimed` entry whose issue is closed (work in flight), when the sweep runs, then it
  is NOT forgotten — the sweep never yanks an entry out from under an in-progress claim.
- Given only non-`pending` entries exist, when the sweep runs, then it makes zero `forget`
  calls and returns a zero-forgotten summary.

### Done When
- [ ] A test with mixed statuses asserts only `pending` closed entries are forgotten.
- [ ] A test asserts a `claimed` closed entry is preserved (in-flight protection).

---

## Story: Brain sweep is resilient and fail-safe per entry

**Requirement:** TR-8 (brain sweep — resilience + fail-safe)

As the brain sweep, I want a per-entry try/catch and null-safe handling, so that one bad
issue lookup never aborts the whole reconciliation batch and no entry is dropped on an
unconfirmed state.

### Acceptance Criteria

#### Happy Path
- Given three pending closed entries where the middle entry's `getIssueState` throws, when the
  sweep runs, then the first and third are still forgotten, the middle is left intact, and the
  summary records the error count without failing the batch (exit/return non-fatal).
- Given a pending entry whose `getIssueState` returns `null` or `'open'`, when the sweep runs,
  then that entry is left untouched (only explicit `'closed'` triggers a forget).

#### Negative Paths
- Given every entry's `getIssueState` returns `null` (GitHub fully unreachable), when the sweep
  runs, then it forgets nothing and returns a zero-forgotten summary — a total outage causes no
  data loss.
- Given a `forget` write fails for one entry, when the sweep continues, then remaining entries
  still reconcile and the failure is recorded in the summary (batch not aborted).

### Done When
- [ ] A test injects a throwing `getIssueState` mid-batch and asserts the other entries still reconcile + error is counted.
- [ ] A test asserts `null`/`open` entries are never forgotten.
- [ ] A test asserts a total `null` outage forgets nothing.

---

## Story: Brain sweep supports dry-run

**Requirement:** TR-9 (brain sweep — dry-run)

As an operator, I want a dry-run mode, so that I can see what the sweep WOULD forget without
mutating the ledger or inbox.

### Acceptance Criteria

#### Happy Path
- Given pending entries with closed issues, when `reconcileClosedIssues` runs with
  `{ dryRun: true }`, then the summary reports the entries that WOULD be forgotten, but the
  ledger file and inbox are byte-for-byte unchanged afterward (no `forget`, no `ack`).

#### Negative Paths
- Given `dryRun: true` and a closed entry, when the sweep runs, then a subsequent `ledger.get`
  still returns that entry (proving no mutation occurred).

### Done When
- [ ] A test asserts `dryRun: true` reports would-forget counts and leaves ledger + inbox unchanged.

---

## Story: Reopened issue re-ingests cleanly after being forgotten

**Requirement:** TR-10 (forget disposition — reopen re-ingestion)

As the intake system, I want a forgotten (closed) issue that is later reopened to be captured
again, so that `forget` (rather than a terminal status) is the correct disposition.

### Acceptance Criteria

#### Happy Path
- Given issue `owner/repo#N` was forgotten by the guard or sweep (no ledger entry, no inbox
  envelope), when the issue is reopened and the next poll runs `gh issue list --state open`,
  then `ledger.known(source, ref)` returns false and the issue is re-recorded `pending` and
  re-enqueued — it flows through intake normally again.

#### Negative Paths
- Given the issue remains closed, when the next poll runs, then `--state open` never lists it,
  so it is not re-ingested (no resurrection of a still-closed issue).
- Given the issue is reopened but still carries an `engineer:handled` label from a prior route,
  when poll runs, then existing label-based skip semantics apply unchanged (this feature does
  not alter `engineer:handled` handling).

### Done When
- [ ] A test asserts a forgotten-then-reopened issue is re-ingested (`ledger.known` false → re-recorded).
- [ ] A test asserts a still-closed issue is not re-ingested.
