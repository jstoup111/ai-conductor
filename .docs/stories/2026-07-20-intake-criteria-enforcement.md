**Status:** Accepted

# Stories: Intake criteria enforcement + unsized-backlog backfill (#695)

**Track:** technical (no PRD — derived from issue #695 intent)
**Feature area:** `conduct-ts engineer` intake capture + claim path
(`src/conductor/src/engine/engineer/intake/*`, `backlog-priority.ts`)

---

## Context

Intake captures every open issue assigned to the operator and enqueues it as a
pending Envelope, but it never verifies that an issue meets the **intake
criteria** before that Envelope becomes dispatchable to the idea→spec loop:

- a **priority** label (`priority: critical|high|medium|low`),
- a **size** label (`size: S|M|L`), and
- **dependency-linking** — the issue has been triaged for blockers so its
  `blocked_by` set is authoritative (an issue with genuinely no dependencies is
  fine; an un-triaged one is not).

Because nothing enforces this, "stray" un-criteria'd issues accumulate: at
filing, **100 of 107** open issues had no size label and **3** had no priority
(#691, #678, #677). The `size: S|M|L` and `priority: …` labels already exist in
the repo; what is missing is (a) a guard that keeps an un-criteria'd issue out of
the dispatchable set and flags it for triage, and (b) a one-time backfill pass
for the existing unsized backlog. Sizing is human judgment — the backfill
**proposes** and a human **confirms**; nothing auto-labels.

Design tenet (CLAUDE.md "deterministic where possible"): the machine mechanically
stamps the flag and blocks dispatch; an LLM is dispatched only for the sizing
judgment in the backfill, never to enforce the rule.

---

## Story: Newly-captured issues missing size/priority are flagged for triage

**Requirement:** FR-1

As an operator, I want every newly-captured issue that lacks a size or priority
label to be visibly flagged so that un-criteria'd issues can't accumulate
silently in the backlog.

### Acceptance Criteria

#### Happy Path
- Given an open assigned issue with **both** `priority: high` and `size: M`, when
  `poll()` captures it, then it is enqueued as today and **no** flag label is
  applied.
- Given an open assigned issue with **no** `size:` label (priority present or
  not), when `poll()` captures it, then the `intake:needs-triage` label is
  applied to the issue (auto-created if absent, mirroring `engineer:handled`) and
  the capture still enqueues the Envelope (the idea is never dropped).
- Given a batch of captured issues, when any are missing criteria, then `notify()`
  surfaces them to the operator distinctly from ready-to-dispatch captures (the
  operator is told *which* issues need triage and *what* is missing).

#### Negative Paths
- Given the `gh` label-apply call fails (outage/quota), when the flag is being
  written, then capture is unaffected — the failure is logged and swallowed
  (FR-37 advisory write-back parity); the missing flag is retried on a later poll,
  never blocking the tick.
- Given an issue that already carries `intake:needs-triage` from a prior poll,
  when it is re-observed still missing criteria, then no duplicate label write is
  attempted and no duplicate notification is emitted (idempotent, per the existing
  per-(sourceRef,status) de-dup discipline).
- Given an issue that was flagged and then gains `priority:` + `size:` labels,
  when it is next observed, then the `intake:needs-triage` label is removed
  (best-effort) so the flag reflects current criteria state.

### Done When
- [ ] A poll test with a fully-criteria'd issue asserts **no** flag label call and
  a normal enqueue.
- [ ] A poll test with an unsized issue asserts the `intake:needs-triage` label is
  applied AND the Envelope is still enqueued.
- [ ] A test asserts a failing label-apply is swallowed (capture still enqueues,
  one log line, no throw).
- [ ] A test asserts re-observing an already-flagged, still-incomplete issue makes
  no duplicate label/notify call.

---

## Story: Size labels parse to a closed S/M/L vocabulary

**Requirement:** FR-2

As the criteria gate, I want a single deterministic size parser so that the same
closed vocabulary decides "sized" everywhere and near-miss labels never count.

### Acceptance Criteria

#### Happy Path
- Given labels `['size: S']` → `'S'`; `['size: M']` → `'M'`; `['size: L']` →
  `'L'` (exact pattern `size: <S|M|L>`, one space, case-sensitive — mirrors
  `parsePriorityLabels`' contract).
- Given `['bug', 'size: L', 'priority: low']` → `'L'` (ignores unrelated labels).
- Given multiple size labels `['size: S', 'size: L']` → a single deterministic
  result (largest wins, mirroring priority's highest-rank rule); repeated calls
  are stable.

#### Negative Paths
- Given `['size: XL']`, `['size:M']` (no space), `['Size: S']` (wrong case),
  `['size: small']`, or `[]` → `undefined` (not sized). The real stray
  `priority:medium` (no space) label observed in the repo is the analogue this
  guards against.
- Given non-string junk mixed into the labels array → filtered, never throws.

### Done When
- [ ] A `parseSizeLabel` test covers each valid value, the multi-label
  largest-wins case, and the near-miss/empty/junk cases returning `undefined`.
- [ ] `grep` shows the size vocabulary is defined once (no duplicate S/M/L regex
  across modules); it lives beside `parsePriorityLabels` in `backlog-priority.ts`.

---

## Story: The claim gate defers issues that don't meet intake criteria

**Requirement:** FR-3

As an operator, I want `engineer claim` to skip an issue that lacks
priority/size/linking so that only dispatchable (criteria-complete) ideas reach
the idea→spec loop, and stalls are explained.

### Acceptance Criteria

#### Happy Path
- Given pending entries {A: `priority: high` + `size: M`; B: no `size:` label},
  when `claim` runs, then A is claimed and B is **deferred** — released back to
  the queue unchanged, no ledger write, no attempt increment (stateless deferral,
  identical to blocker deferral).
- Given every pending entry is missing at least one criterion, when `claim` runs,
  then the outcome is `needs-criteria` (a new kind, distinct from `empty` and
  `all-blocked`) listing each held entry and its missing criterion
  (`missing-size` / `missing-priority` / `missing-linking`) so an operator sees
  the queue is stalled on **triage**, not dependencies.
- Given an entry whose issue gains its missing `size: S` label after capture,
  when the next `claim` runs, then it is now dispatchable (labels are read at
  claim time — no re-poll, no restart).

#### Negative Paths
- Given a mix of criteria-incomplete and criteria-complete entries where the
  complete one is also blocked, when `claim` runs, then criteria and blocker
  deferrals compose: the incomplete entry is deferred for `missing-*` and the
  blocked entry for its blocker verdict; neither is dropped and both are surfaced.
- Given a criteria-incomplete entry with no `sourceRef` (no backing issue), when
  the gate evaluates it, then it takes the existing `no-issue` band and is treated
  as **not** subject to the criteria gate (no network call; parity with banding's
  `no-issue` handling) — it dispatches as today.
- Given an unexpected throw mid-walk, when the process exits, then every held
  envelope is released back (finally-block guarantee preserved) — the criteria
  gate never causes an entry to be lost.

### Done When
- [ ] A test with {complete, unsized} pending asserts the complete entry is
  claimed and the unsized entry remains pending afterward with unchanged ledger
  status/attempts.
- [ ] A test with all entries incomplete asserts a `needs-criteria` outcome
  enumerating each entry's missing criterion.
- [ ] A relabel-after-capture test asserts an entry becomes claimable once its
  size label appears between two claims.
- [ ] A crash-injection test asserts all drained envelopes are back in the inbox
  after an unexpected throw.

---

## Story: Criteria gating composes with priority banding without changing order

**Requirement:** FR-4

As an operator, I want criteria gating layered on top of priority banding so that
among criteria-complete entries the highest band is still served first, and the
gate only *removes* incomplete entries from candidacy.

### Acceptance Criteria

#### Happy Path
- Given pending {critical+sized, high+sized, medium **unsized**}, when `claim`
  runs, then the critical entry is served, the high entry is served next, and the
  medium entry is deferred as `missing-size` — banding order among complete
  entries is byte-identical to today.
- Given the criteria gate defers an entry, when the same band contains a complete
  entry, then within-band receivedAt-FIFO order is preserved for the entries that
  remain (stable sort untouched).

#### Negative Paths
- Given a criteria-complete `critical` entry that is **blocked**, when `claim`
  runs, then it defers on its blocker verdict (not on criteria) and the reported
  reason distinguishes `blocked` from `missing-*` — the operator can tell a
  dependency stall from a triage stall.
- Given the `createFileQueue` atomic-claim primitive, when this feature lands,
  then `queue.ts` is byte-identical to main (`git diff` empty) — the gate is
  layered in the claim walk, never in the queue primitive.

### Done When
- [ ] A test with {critical+sized, high+sized, medium-unsized} asserts service
  order critical→high and the medium entry deferred `missing-size`.
- [ ] A test asserts `blocked` vs `missing-*` reasons are reported distinctly.
- [ ] `git diff` shows `queue.ts` unchanged.

---

## Story: A label/API outage degrades the criteria gate to today's behavior

**Requirement:** FR-5

As an operator, I want a `gh` outage to never make the criteria gate strand the
whole backlog, so that intake fails open rather than blocking all dispatch on the
label source.

### Acceptance Criteria

#### Happy Path
- Given the label reader throws (transport error/quota) while resolving criteria,
  when `claim` runs, then the criteria gate is skipped for that invocation, claim
  proceeds on today's banding-fallback FIFO order, and exactly one warning line is
  emitted (parity with the existing priority-banding fail-open contract).

#### Negative Paths
- Given the reader throws after resolving some refs (partial failure), when
  `claim` runs, then NO partial criteria map is used — the gate falls back wholesale
  for that invocation (never a half-enforced gate that strands only some entries).
- Given a per-issue `not-found` (404, deleted issue), when criteria are resolved,
  then that is data, not an outage: the entry is treated as criteria-incomplete
  (`missing-*`) and deferred — it does **not** trip the outage fallback for the
  whole batch.

### Done When
- [ ] A test injects a throwing reader and asserts: claim still succeeds, criteria
  gate skipped, exactly one outage warning, selection matches today's FIFO
  fallback.
- [ ] A test asserts a 404 for one ref defers only that entry and does not
  fail-open the batch.

---

## Story: Backfill inventory enumerates and flags the existing unsized backlog

**Requirement:** FR-6

As an operator, I want a one-shot command that lists every open assigned issue
missing priority/size/linking and stamps each `intake:needs-triage`, so that the
~100-issue backlog gap is made visible and actionable without any sizing guess.

### Acceptance Criteria

#### Happy Path
- Given the open assigned backlog, when the inventory runs, then it reports a
  per-issue breakdown of which criteria each is missing (`missing-size` /
  `missing-priority` / `missing-linking`) plus a summary count, and applies
  `intake:needs-triage` to every incomplete issue (auto-creating the label once).
- Given the inventory is run twice, when the second run executes, then it is
  idempotent — already-flagged issues are not double-labeled and fully-criteria'd
  issues are never flagged.

#### Negative Paths
- Given a `gh` failure for one issue, when the inventory runs, then that issue is
  isolated (logged, skipped) and the rest of the backlog is still inventoried
  (per-issue isolation, FR-27 parity) — one bad issue never aborts the sweep.
- Given the inventory step, when it runs, then it applies **no** size/priority
  values and makes **no** sizing judgment — it only detects gaps and flags. (This
  is the deterministic half; judgment is FR-7.)

### Done When
- [ ] A test asserts the inventory reports each issue's missing-criteria set and a
  correct summary count against a fixture backlog.
- [ ] A test asserts `intake:needs-triage` is applied only to incomplete issues
  and the run is idempotent.
- [ ] A test asserts a failing single-issue `gh` call is isolated and the sweep
  completes for the rest.

---

## Story: Backfill triage proposes size/priority/links but never auto-applies

**Requirement:** FR-7

As an operator, I want the backfill to *propose* a size, priority, and any
dependency links per flagged issue and wait for my confirmation, so that sizing
judgment stays human and nothing is mislabeled autonomously.

### Acceptance Criteria

#### Happy Path
- Given a flagged issue, when the assisted-triage step runs, then it proposes a
  size (S/M/L), a priority band, and candidate `blocked_by` links derived from the
  issue text, and presents them for operator confirmation before any write.
- Given operator approval of a proposal, when confirmation is given, then the
  size/priority labels and links are applied (via the existing gh label/link
  write-back helpers), the `intake:needs-triage` label is cleared, and the issue
  becomes dispatchable on the next claim.

#### Negative Paths
- Given an autonomous/daemon run (no interactive operator), when the triage step
  reaches a proposal, then it does **not** apply labels — it writes a HALT with the
  proposal ledger (per the Correctness & Assumption Gate: "Autonomous/daemon: write
  a HALT with the assumption ledger — never silently pick the most likely value").
- Given the operator rejects or edits a proposal, when confirmation resolves, then
  only the operator-confirmed values are written — the model's proposal is a
  suggestion, never the source of truth.
- Given an issue whose text gives no basis for a size, when triage runs, then the
  step surfaces low confidence and defers to the operator rather than fabricating a
  size (no confident-guess labeling).

### Done When
- [ ] A test asserts the interactive path presents a proposal and applies labels
  **only** after explicit confirmation.
- [ ] A test asserts the autonomous path writes a HALT with the proposal ledger and
  applies nothing.
- [ ] A test asserts operator-edited values (not the model proposal) are what get
  written on confirmation.

---

## Story: Confirmed backfill clears the flag and re-admits the issue

**Requirement:** FR-8

As an operator, I want a confirmed triage to remove `intake:needs-triage` and make
the issue dispatchable, so that the backfill visibly drains and the enforcement
guard (FR-1/FR-3) keeps new strays from re-accumulating afterward.

### Acceptance Criteria

#### Happy Path
- Given a backfilled issue now carrying `priority:` + `size:` and confirmed
  linking, when the next `claim` runs, then it passes the criteria gate and is
  dispatchable, and `intake:needs-triage` has been removed.
- Given the whole flagged set is triaged, when the inventory is re-run, then it
  reports zero remaining incomplete issues (the backlog gap is closed).

#### Negative Paths
- Given the label-clear call fails after labels were applied, when the write
  completes partially, then the applied criteria still make the issue dispatchable
  and the stale flag is reconciled on the next poll/inventory (best-effort clear,
  never a hard failure).

### Done When
- [ ] A test asserts a triaged issue is dispatchable and its flag removed.
- [ ] A test asserts a failed flag-clear still leaves the issue dispatchable and
  the flag is reconciled on re-inventory.

---

## Notes

- **CLI output contract:** the `claim` JSON shape (`kind/text/source/sourceRef`)
  is preserved for `claim`/`empty`/`all-blocked`; `needs-criteria` is an
  additive outcome kind. Criteria-reason detail may appear in stderr logging.
- **Label vocabulary is already provisioned:** `size: S|M|L` and
  `priority: critical|high|medium|low` exist in the repo; this feature adds only
  the `intake:needs-triage` flag label (auto-created like `engineer:handled`).
- **Open design point for `/plan` + `/architecture-review`:** the precise
  machine-checkable signal for "linking enforced" — presence of a determinate
  `blocked_by` verdict vs. an explicit triaged marker. Stories treat an
  `indeterminate` blocker verdict as an outage (fail-open), and treat priority +
  size label presence as the enforced, deterministic signal; linking confirmation
  rides the same human triage pass. The ADR should settle whether a distinct
  linking marker is warranted.
