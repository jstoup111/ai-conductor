# Stories — Phase 9.3b: GitHub-Issues Intake + Bidirectional Write-Back

**Source PRD:** `.docs/specs/2026-06-27-phase-9.3b-github-intake-writeback.md`
**Status:** Accepted
**Complexity:** Medium (full per-criterion negative paths)
**Test substrate:** vitest; all `gh` interactions injected/faked (no live network in unit tests).

> Framing: these are TypeScript module-behavior stories for `conduct-ts`. "Role" is the engineer
> core, the operator, or a future maintainer. Acceptance is asserted against module APIs, the
> on-disk inbox/ledger, and a faked `gh` client — not HTTP endpoints.

---

## Story 1: Define the async capture interface (`IntakeSource`)

**Requirement:** FR-25

As the engineer core, I want to depend on an `IntakeSource` capture abstraction (separate from
`IntakePort.report()`) so that adding a pull-based source is additive and the loop never imports a
concrete adapter.

### Acceptance Criteria
#### Happy Path
- Given the intake module, when I inspect the public API, then an `IntakeSource` interface exists
  exposing `poll(): Promise<Envelope[]>`, distinct from `IntakePort`.
- Given the engineer loop source, when I grep its imports, then it imports only the `IntakeSource`
  / `IntakePort` interfaces, never `github-issues` or `claude-session` concretes.
- Given the `claude-session` adapter, when I inspect it, then it does **not** implement
  `IntakeSource` (it remains synchronous) and still satisfies `IntakePort`.

#### Negative Paths
- Given a hand-written object missing `poll`, when type-checked against `IntakeSource`, then
  compilation/`parse` fails (the contract is enforced, not structural-by-accident).
- Given the loop module, when statically scanned, then it contains **zero** references to
  `github-issues` (loose-coupling guard mirrors the existing claude-session test).

### Done When
- [ ] `IntakeSource` interface exported from `intake/` with `poll(): Promise<Envelope[]>`.
- [ ] vitest: loop imports assert no concrete-adapter import (static guard passes).
- [ ] vitest: `claude-session` adapter is not an `IntakeSource`; still implements `IntakePort`.

---

## Story 2: Poll assigned issues across all registered repos

**Requirement:** FR-26

As the operator, I want the github-issues source to capture issues assigned to me across every
registered repo so that I can file ideas from anywhere and have them queued.

### Acceptance Criteria
#### Happy Path
- Given a fake `gh` returning two open issues assigned to `@me` in repos `o/a` and `o/b`, when
  `poll()` runs, then it returns two Envelopes with `source="github-issues"`,
  `sourceRef="o/a#1"` / `sourceRef="o/b#7"`, `text` = `title + "\n\n" + body`, and
  `hintRepo="o/a"` / `"o/b"`.
- Given the 9.2 registry lists repos `o/a` and `o/b`, when `poll()` runs, then `gh issue list
  --assignee @me --state open` is invoked once per registered repo and only those repos.
- Given an issue, when its Envelope is built, then `status="pending"` and `receivedAt` is a valid
  ISO-8601 timestamp (caller-injected for deterministic tests).

#### Negative Paths
- Given the registry is empty, when `poll()` runs, then it returns `[]` and invokes `gh` zero
  times (no crash).
- Given a repo returns a closed issue, when `poll()` runs, then no Envelope is produced for it
  (`--state open` honored; closed issues never enter the queue).
- Given two registered repos both contain issue number `#1`, when `poll()` runs, then the two
  Envelopes have distinct `sourceRef` (`o/a#1` vs `o/b#1`) — repo qualifies the key.

### Done When
- [ ] `poll()` reads the registry and calls the faked `gh` per repo with the assignee/open filter.
- [ ] vitest: Envelope fields (source, sourceRef, text, hintRepo, status, receivedAt) asserted.
- [ ] vitest: empty-registry and closed-issue cases produce no Envelopes.

---

## Story 3: Poll degrades gracefully on auth / availability failure

**Requirement:** FR-27

As the operator, I want a `gh` auth or per-repo access failure to fail loudly for that repo only,
without crashing my engineer launch or queuing blanks.

### Acceptance Criteria
#### Happy Path
- Given repo `o/a` is accessible and `o/b` returns a non-zero `gh` exit (not authenticated), when
  `poll()` runs, then Envelopes are returned for `o/a`, and `o/b`'s failure is reported as a clear
  error (repo + reason) and captures nothing for `o/b`.

#### Negative Paths
- Given `gh` is entirely unauthenticated (all repos error), when `poll()` runs, then it returns
  `[]`, surfaces a clear actionable error, and does **not** throw out of the engineer launch.
- Given a repo errors mid-batch, when `poll()` runs, then **no partial/blank Envelope** is emitted
  for that repo (failure ≠ empty Envelope).
- Given a transient `gh` error on `o/b`, when `poll()` runs, then `o/a`'s successful Envelopes are
  still returned (one repo's failure never voids another's results).

### Done When
- [ ] vitest: mixed success/failure across repos yields only the good repos' Envelopes + a logged
      error for the failed one.
- [ ] vitest: all-fail returns `[]` and does not throw.
- [ ] No code path converts a `gh` failure into a blank Envelope.

---

## Story 4: Reject empty issues at capture

**Requirement:** FR-28

As the engineer core, I want issues with no meaningful text excluded at capture so that blank
ideas never reach routing.

### Acceptance Criteria
#### Happy Path
- Given an issue with a title and empty body, when `poll()` runs, then an Envelope is produced
  with `text` = the title (non-empty content is sufficient).

#### Negative Paths
- Given an issue whose title **and** body are empty/whitespace, when `poll()` runs, then **no**
  Envelope is produced for it, and the skip is logged with the `sourceRef`.
- Given a whitespace-only composed `text`, when the Envelope would be built, then
  `EmptyEnvelopeTextError` semantics apply (reuse, not reinvent) and it is not enqueued.

### Done When
- [ ] vitest: title-only issue → Envelope; fully-empty issue → no Envelope + logged skip.
- [ ] Reuses the existing `EmptyEnvelopeTextError` path rather than a new error type.

---

## Story 5: Durable inbox behind a swappable `IntakeQueue`

**Requirement:** FR-29

As a future maintainer, I want all inbox access to go through a narrow `IntakeQueue` interface so
that a distributed-pool backend is a drop-in with zero adapter/loop changes.

### Acceptance Criteria
#### Happy Path
- Given the file-backed queue, when I enqueue an Envelope and construct a fresh queue over the same
  directory, then the Envelope is still present (durable across process restart).
- Given the queue module, when I inspect it, then `IntakeQueue` exposes `enqueue`, `claim`, `ack`,
  `release`, and the engineer loop depends on that interface only.

#### Negative Paths
- Given a corrupt/partial inbox file, when the queue loads, then it surfaces a clear error and does
  **not** silently drop other valid entries.
- Given the inbox directory does not yet exist, when `enqueue` runs, then it is created (no crash on
  first use).
- Given two enqueues of Envelopes with the same `sourceRef`, when the queue is read, then only one
  in-flight entry exists (dedup honored at the queue boundary, see Story 8).

### Done When
- [ ] `IntakeQueue` interface (`enqueue/claim/ack/release`) + file-backed impl under a dedicated dir.
- [ ] vitest: durability across a fresh queue instance over the same dir.
- [ ] vitest: corrupt-file surfaces error without nuking valid entries; missing-dir auto-creates.

---

## Story 6: Atomic claim prevents double-processing

> **Amended by #461** (`2026-07-10-priority-banded-intake-claim.md`,
> `adr-2026-07-10-intake-claim-priority-banding`): the queue primitive `claim()` still returns
> oldest-by-`receivedAt` (unchanged, asserted below), but the end-to-end `engineer claim`
> selection above the queue is now priority-band-first, oldest-first within a band. "Oldest"
> in Story 6/7 describes the primitive and pre-#461 CLI behavior respectively.

**Requirement:** FR-30

As the engineer core, I want the oldest pending Envelope claimed atomically before routing so that
two concurrent sessions never process the same idea, and a crash never strands an Envelope.

### Acceptance Criteria
#### Happy Path
- Given three pending Envelopes, when `claim()` is called, then it returns the **oldest** by
  `receivedAt` and marks it `claimed`.
- Given a claimed Envelope, when processing succeeds and `ack()` is called, then it transitions to
  `done` and is no longer claimable.

#### Negative Paths
- Given one pending Envelope and two concurrent `claim()` calls, when both run, then **exactly one**
  receives the Envelope and the other receives nothing (no double-claim).
- Given a claimed Envelope whose session crashes (no ack), when the claim is later inspected/reclaimed
  via `release()` or staleness, then it becomes claimable again (no permanent stuck item).
- Given the claim mechanism, when reviewed, then it is **independent of** `daemon-lock.ts` / the
  `O_EXCL` pidfile (FR-20 untouched — asserted by a no-import guard).

### Done When
- [ ] `claim` returns oldest-by-`receivedAt`; `ack`→done; `release`→reclaimable.
- [ ] vitest: concurrent double-claim yields exactly one winner.
- [ ] vitest: crash-without-ack path leaves the Envelope reclaimable.
- [ ] Static guard: intake/queue does not import `daemon-lock`.

---

## Story 7: Poll-on-launch wiring with chat fallback

**Requirement:** FR-31

As the operator, I want launching the engineer to poll, enqueue new work, and process the oldest
buffered idea — falling back to chat when the inbox is empty — so one launch advances one idea.

### Acceptance Criteria
#### Happy Path
- Given two new assigned issues and an empty inbox, when `conduct-ts engineer` launches, then it
  polls → enqueues both → claims and processes the **oldest** (one idea), leaving the other queued.
- Given a non-empty inbox after poll, when the session runs, then it processes exactly one Envelope
  and the per-idea "type `/quit` for the next" contract is preserved.

#### Negative Paths
- Given poll returns nothing **and** the inbox is empty, when the engineer launches, then it falls
  back to the existing interactive `claude-session` chat capture (no error, no idle hang).
- Given poll enqueues new work but every Envelope is already `claimed` by another session, when the
  launch processes, then it finds nothing claimable and falls back to chat (no double-processing).

### Done When
- [ ] Launch sequence = poll → ledger/dedup filter → enqueue → claim-oldest → process one.
- [ ] vitest: empty-inbox-after-poll falls back to chat capture.
- [ ] vitest: only one Envelope processed per launch.

---

## Story 8: Durable ledger + idempotent pull (capture exactly once)

**Requirement:** FR-33, FR-34

As the operator, I want a durable ledger so that an issue is captured exactly once no matter how
many times it is polled, even while it stays open and assigned.

### Acceptance Criteria
#### Happy Path
- Given issue `o/a#1` is captured (ledger has it as `pending`), when `poll()` runs again with the
  same issue still open+assigned, then **no** second Envelope is produced for `o/a#1`.
- Given the ledger, when an Envelope advances, then its entry records state transitions
  (`unseen→pending→claimed→routed→deciding→done`) plus `{branch, prUrl, attempts, timestamps}`,
  and survives process exit (re-read from disk returns the same state).

#### Negative Paths
- Given the in-memory idempotency guard alone (no ledger), when the process restarts, then it would
  forget — so the test asserts dedup survives a **fresh process** via the durable ledger.
- Given an issue `o/a#1` and an unrelated `o/b#1`, when both are polled, then both are captured
  (the composite `source+sourceRef` key does not collide across repos — no false-positive dedup).
- Given the same idea re-filed under a **new** issue number `o/a#2`, when polled, then it **is**
  captured (dedup keys on `sourceRef`, not text — no false-negative blocking of a legit new idea).

### Done When
- [ ] Durable ledger file keyed `source+sourceRef` with lifecycle + metadata fields.
- [ ] vitest: re-poll of a ledgered issue yields no new Envelope (across a fresh process).
- [ ] vitest: cross-repo same-number and re-filed-new-number cases both capture (no false dedup).
- [ ] **The ledger is the SOLE dedup authority:** the in-memory `intake/idempotency.ts` guard is
      removed and every call site (incl. the claude-session sync path) repointed to the ledger.
      grep confirms zero remaining references to the removed guard (no orphaned primitive).

> **Conflict resolution (2026-06-27):** the durable ledger supersedes the 9.3 in-memory
> idempotency guard. See `.docs/conflicts/2026-06-27-ledger-supersedes-idempotency-guard.md`.

---

## Story 9: GitHub `engineer:handled` label as distributed-ready anchor

**Requirement:** FR-35

As a future distributed pool, I want a globally visible `engineer:handled` marker on done issues so
that any worker (and the poll) can skip already-handled issues regardless of local state.

### Acceptance Criteria
#### Happy Path
- Given an Envelope reaches `done`, when finalized, then the adapter applies the `engineer:handled`
  label to the issue (creating the label in the repo if it does not exist).
- Given an issue already bearing `engineer:handled`, when `poll()` runs, then it is skipped even if
  the local ledger entry were absent (label is an independent skip signal).

#### Negative Paths
- Given the label does not exist in the repo, when finalizing, then it is auto-created then applied
  (no failure due to a missing label).
- Given the label is an **output** marker, when intake runs, then capture is still **assignee**-based
  and does **not** require any trigger label (the marker never becomes an intake filter).
- Given label application fails (perms), when finalizing, then per FR-37 it is non-fatal (see
  Story 11) and the ledger still records `done`.

### Done When
- [ ] `done` finalization applies (and auto-creates) `engineer:handled`.
- [ ] vitest: poll skips a labeled issue even with no ledger entry.
- [ ] vitest: intake remains assignee-based (label not consulted on capture).

---

## Story 10: Write-back progress comments via realized `report()`

**Requirement:** FR-36

As the operator, I want progress comments posted to the originating issue at `routed` and `done` so
that I can follow an idea's status without watching a terminal.

### Acceptance Criteria
#### Happy Path
- Given an Envelope transitions to `routed`, when `report(sourceRef, "routed", {repo})` runs, then a
  comment "Routed to `<repo>`" is posted to the issue.
- Given an Envelope transitions to `done`, when `report(sourceRef, "done", {prUrl})` runs, then a
  comment "Spec PR opened: `<url>`" is posted **and** the `engineer:handled` label applied.
- Given the `claude-session` adapter, when `report()` is called, then it remains a **no-op**.

#### Negative Paths
- Given an unknown `sourceRef` not parseable to `owner/repo#N`, when `report()` runs, then it errors
  clearly and posts nothing (no malformed `gh` call).
- Given a status with no defined write-back (`pending`/`deciding`), when `report()` runs, then it is
  a no-op comment-wise (only `routed`/`done` comment).

### Done When
- [ ] github adapter `report()` posts the routed/done comments + done label via faked `gh`.
- [ ] vitest: claude-session `report()` stays a no-op; unknown sourceRef errors without a `gh` call.

---

## Story 11: Write-back is non-fatal

**Requirement:** FR-37

As the operator, I want a failed write-back to never block or revert spec delivery, because the
spec PR is the real artifact and the comment is advisory.

### Acceptance Criteria
#### Happy Path
- Given the spec PR was opened successfully, when the `done` write-back comment fails (network),
  then spec delivery still reports success and the ledger still records `done`.

#### Negative Paths
- Given the issue was deleted between capture and `done`, when `report()` runs, then the failure is
  logged and swallowed (non-fatal); no exception propagates to abort the session.
- Given a permissions error applying the label, when finalizing, then delivery is unaffected and the
  error is logged with the `sourceRef`.

### Done When
- [ ] vitest: forced `gh` comment/label failure does not throw and does not revert `done`.
- [ ] All write-back failures are logged with the issue reference.

---

## Story 12: Idempotent write-back (no duplicate comments/labels)

**Requirement:** FR-38

As the operator, I want re-running `report()` for the same `(sourceRef, status)` to not spam the
issue with duplicate comments or re-apply the label.

### Acceptance Criteria
#### Happy Path
- Given `report(sourceRef, "done", …)` already posted its comment, when it runs again for the same
  `(sourceRef, "done")`, then **no** second comment is posted and the label is not re-applied.

#### Negative Paths
- Given an existing handled comment is detected (check-before-write), when `report()` re-runs, then
  it short-circuits without a write `gh` call.
- Given two **different** statuses for the same `sourceRef` (`routed` then `done`), when each runs,
  then both comments post (idempotency is per `(sourceRef, status)`, not per `sourceRef`).

### Done When
- [ ] Check-before-write guard keyed `(sourceRef, status)` prevents duplicate comment/label.
- [ ] vitest: re-run is a no-op; distinct statuses still each post once.

---

## Story 13: Standalone `engineer poll` subcommand (cron seam)

**Requirement:** FR-32

As the operator, I want a `conduct-ts engineer poll` command that only captures+enqueues so that I
can wire background capture into cron myself without the harness supervising a process.

### Acceptance Criteria
#### Happy Path
- Given new assigned issues, when `conduct-ts engineer poll` runs, then it polls, enqueues new
  Envelopes into the same inbox, and exits **without** routing/DECIDE/processing.
- Given `poll` and a later interactive `engineer` launch, when both run, then the launch processes
  Envelopes the standalone poll enqueued (shared inbox).

#### Negative Paths
- Given `poll` runs twice back-to-back, when the second runs, then it enqueues nothing new
  (ledger/dedup honored; no duplicate inbox entries).
- Given the harness code is scanned, when reviewed, then `poll` introduces **no** long-running/
  always-on process, timer, or daemon (static guard: no `setInterval`/detached spawn in the poll
  path).

### Done When
- [ ] `conduct-ts engineer poll` subcommand exists; capture-and-enqueue only, then exits.
- [ ] vitest: double-poll enqueues no duplicates; no always-on process introduced.

---

## Story 14: Auto-reopen on closed-unmerged spec PR

**Requirement:** FR-39

As the operator, I want an issue whose spec PR I closed without merging to re-enter the inbox
automatically so I can iterate, while a merged spec stays terminal.

### Acceptance Criteria
#### Happy Path
- Given a `done` ledger entry whose recorded `prUrl` is CLOSED and not merged, when `poll()` runs,
  then the entry resets to `unseen`, the `engineer:handled` label is stripped, `attempts` is
  incremented, and the issue re-enters the inbox.

#### Negative Paths
- Given a `done` entry whose spec PR is **MERGED**, when `poll()` runs, then it is **never**
  reopened (merged is terminal).
- Given a `done` entry whose spec PR is still **OPEN**, when `poll()` runs, then it is left as
  `done` (only closed-unmerged triggers reopen).
- Given `gh pr view` fails to resolve PR state, when `poll()` runs, then the entry is left untouched
  (no spurious reopen on an inconclusive state check).

### Done When
- [ ] Poll inspects each `done` entry's PR via faked `gh pr view --json state,mergedAt`.
- [ ] vitest: closed-unmerged → reopen (+label strip +attempts++); merged/open → unchanged;
      lookup-failure → unchanged.

---

## Story 15: Churn guard + manual `forget`

**Requirement:** FR-40

As the operator, I want auto-reopen capped so a repeatedly-rejected idea stops re-ingesting, with a
manual `forget` to re-enable anything.

### Acceptance Criteria
#### Happy Path
- Given a `sourceRef` auto-reopened twice (`attempts == 2`), when it would reopen a third time, then
  it is instead marked `needs-manual`, a warning is emitted, and it does **not** re-enter the inbox.
- Given any ledger entry, when `conduct-ts engineer forget <sourceRef>` runs, then the entry is
  cleared (and `engineer:handled` stripped) so the issue is eligible again.

#### Negative Paths
- Given a `needs-manual` entry, when `poll()` runs, then it stays out of the inbox until `forget`
  is invoked (the guard actually holds).
- Given `forget` with a `sourceRef` absent from the ledger, when it runs, then it reports "not
  found" and makes no change (no crash, no phantom entry).
- Given `forget` on an entry whose issue bears `engineer:handled`, when it runs, then the label is
  stripped so the next poll re-captures it.

### Done When
- [ ] `attempts` capped at 2 auto-reopens → `needs-manual` + warning, excluded from inbox.
- [ ] `conduct-ts engineer forget <sourceRef>` clears a ledger entry + strips the label.
- [ ] vitest: third reopen blocked; forget on missing ref is a safe no-op.

---

## Story 16: Cross-repo authoring safety preserved

**Requirement:** NFR (cross-repo safety) — guards FR-26 capture against the FR-31 process path

As the operator, I want capture reading many repos to never let authored artifacts leak outside the
routed target repo so cross-repo isolation from 9.3 still holds.

### Acceptance Criteria
#### Happy Path
- Given an Envelope captured from `o/a#1` but routed (by the operator) to target repo `T`, when
  DECIDE authors artifacts, then the spec branch/PR land **only** in `T` (existing `AuthoringGuard`
  enforces), regardless of `hintRepo`.

#### Negative Paths
- Given `hintRepo="o/a"` but operator routes to `o/b`, when artifacts are authored, then nothing is
  written to `o/a` (hint is advisory, not authoritative).
- Given capture polled repos `o/a`, `o/b`, `o/c`, when one idea is processed, then only the routed
  target repo's working tree/branches/PRs are mutated (other polled repos untouched, asserted by
  byte-for-byte comparison in an integration test).

### Done When
- [ ] Integration test: capture-from-A + route-to-B leaves A and all other polled repos unchanged.
- [ ] `AuthoringGuard` reused (no new write path bypasses it).

---

## Coverage Map (FR → Story)

| FR | Story |
|----|-------|
| FR-25 | 1 |
| FR-26 | 2 |
| FR-27 | 3 |
| FR-28 | 4 |
| FR-29 | 5 |
| FR-30 | 6 |
| FR-31 | 7 |
| FR-32 | 13 |
| FR-33 | 8 |
| FR-34 | 8 |
| FR-35 | 9 |
| FR-36 | 10 |
| FR-37 | 11 |
| FR-38 | 12 |
| FR-39 | 14 |
| FR-40 | 15 |
| NFR cross-repo | 16 |

Every FR-25→FR-40 is covered by at least one story; every story carries concrete negative paths.
