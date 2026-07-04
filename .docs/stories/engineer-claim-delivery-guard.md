**Status:** Accepted

# Stories: Engineer Claim Delivery Guard (#243)

Technical track — requirements derive from issue jstoup111/ai-conductor#243 and
adr-2026-07-04-claim-time-delivery-evidence-guard (APPROVED). Requirement tags:

- **TR-1** — claim-time delivery guard (ledger consult + PR-state verification)
- **TR-2** — delivery evidence recorded on every handoff outcome
- **TR-3** — `engineer resolve` recovery primitive
- **TR-4** — docs + CHANGELOG

---

## Story: Delivered entry is never re-served — auto-heal to done

**Requirement:** TR-1

As the operator, I want `engineer claim` to refuse to serve an intake entry whose spec
PR already exists, so that a fresh engineer session never authors a duplicate spec.

### Acceptance Criteria

#### Happy Path
- Given a ledger entry at `status: claimed` with `prUrl` recorded and that PR is OPEN,
  and a duplicate envelope for its sourceRef sits in the inbox, when `engineer claim`
  runs, then the entry is transitioned to `done` (branch/prUrl evidence preserved), the
  envelope is removed from the inbox, and claim continues its walk (serving the next
  eligible candidate, or reporting `empty:true` if none).
- Given the same entry but the PR is MERGED, when `engineer claim` runs, then the same
  auto-heal + drop occurs and the entry is never served.
- Given entries stranded at `routed` or `deciding` with a recorded `prUrl` whose PR is
  OPEN, when `engineer claim` runs, then they are healed and skipped identically
  (the guard keys on evidence, not on the exact stuck status).

#### Negative Paths
- Given a healed entry, when `engineer claim` runs again later, then the entry stays
  `done`, no gh call is repeated for a new envelope of it only if one exists, and no
  duplicate spec session is ever offered for that sourceRef.
- Given the guard is removing a duplicate envelope, when a concurrent `claim` process
  has already removed the same envelope file (unlink returns ENOENT), then the guard
  treats the removal as success and the walk continues without error.
- Given the auto-heal ledger write fails (e.g. disk error on the atomic save), when
  `engineer claim` runs, then the candidate is NOT served, the error is reported on
  stderr, and the inbox envelope is left in place (fail-safe: uncertainty never
  authors).

### Done When
- [ ] A unit test seeds ledger `claimed`+`prUrl` (gh stub: PR OPEN) + inbox envelope,
      runs the claim path, and asserts: JSON output is `empty:true` (no other work),
      ledger entry is `done`, inbox is empty.
- [ ] Same assertion for MERGED, and for stuck statuses `routed` and `deciding`.
- [ ] ENOENT-on-ack race test passes (stubbed unlink ENOENT → no throw, walk continues).

---

## Story: Closed-unmerged spec PR keeps re-eligibility semantics (no cap bypass)

**Requirement:** TR-1

As the operator, I want a claim candidate whose recorded spec PR was closed without
merging to remain claimable under the existing FR-39/40 churn rules, so that the guard
never blocks legitimately re-opened work and never creates a new bypass around the cap.

### Acceptance Criteria

#### Happy Path
- Given a ledger entry with `prUrl` whose PR is CLOSED and not merged, and
  `attempts` below the reopen cap, when `engineer claim` runs, then the entry is
  served (reopen bookkeeping applied: attempts incremented, lifecycle advanced through
  the existing reopen path — not a silent serve).

#### Negative Paths
- Given the same entry but `attempts` at/above the reopen cap, when `engineer claim`
  runs, then the entry is parked `needs-manual`, the envelope is dropped, the parking
  is logged, and the entry is NOT served.
- Given a dedup false-positive check: a brand-new `pending` entry with no `prUrl`,
  when `engineer claim` runs, then it is served exactly as today (the guard adds no
  friction to the healthy path).

### Done When
- [ ] Unit test: CLOSED-unmerged + attempts<cap → served with attempts+1.
- [ ] Unit test: CLOSED-unmerged + attempts≥cap → `needs-manual`, not served.
- [ ] Regression test: plain `pending` entry (and an entry-less envelope from a
      non-recording source) serves unchanged.

---

## Story: PR-state lookup failure fails safe

**Requirement:** TR-1

As the operator, I want claim to skip — not serve — an evidence-carrying candidate when
the PR state cannot be determined, so that a gh outage can never cause a duplicate spec.

### Acceptance Criteria

#### Happy Path
- Given an entry with `prUrl` and a gh runner that fails (network error, ENOENT,
  non-zero exit), when `engineer claim` runs, then that candidate is skipped, its
  envelope remains pending in the inbox, and the walk continues to the next candidate.

#### Negative Paths
- Given the gh lookup fails for the only candidate, when `engineer claim` runs, then
  the result is `empty:true` (or all-blocked, per the dependency walk) — the stranded
  candidate is NOT served — and the skip is logged with the sourceRef and reason.
- Given gh later recovers, when `engineer claim` runs again, then the previously
  skipped candidate is re-evaluated normally (heal or serve per PR state) — the skip
  left no sticky state.

### Done When
- [ ] Unit test: gh throws → candidate skipped, envelope still pending, no ledger
      mutation, stderr log contains the sourceRef.
- [ ] Unit test: subsequent claim with a healthy gh stub heals/serves the same entry.

---

## Story: In-flight duplicate envelope is dropped without touching the entry

**Requirement:** TR-1

As the operator, I want duplicate inbox envelopes for work that is already in flight
(status beyond `pending`, no `prUrl` yet) dropped at claim time, so that the poll
check-then-act race can never hand the same idea to two sessions.

### Acceptance Criteria

#### Happy Path
- Given a ledger entry at `claimed` with NO `prUrl` (a session is mid-DECIDE) and a
  duplicate envelope in the inbox, when `engineer claim` runs, then the duplicate
  envelope is removed, the ledger entry is byte-for-byte unchanged, and the drop is
  logged naming `engineer forget <sourceRef>` as the sanctioned re-open path.

#### Negative Paths
- Given the crashed-session case (entry `claimed`, no `prUrl`, no session running),
  when the operator runs `engineer forget <sourceRef>` and the next poll re-captures
  the issue, then the idea is claimable again — the drop did not make recovery harder
  than today.
- Given an entry at `pending` (released/deferred by the dependency walk), when
  `engineer claim` runs, then its envelope is NOT treated as a duplicate and serves
  normally (dedup key analysis: no false positive on legitimate deferred work).

### Done When
- [ ] Unit test: `claimed`-no-prUrl + envelope → envelope gone, entry unchanged, log
      line includes "engineer forget".
- [ ] Unit test: `pending` entry serves normally through the guard.

---

## Story: Handoff records delivery evidence on the local-commit fallback

**Requirement:** TR-2

As the operator, I want every handoff outcome — including the local-commit fallback
taken when `gh pr create` fails — to record delivery evidence in the ledger, so that a
write-back failure (#290 family) can never strand an evidence-free `claimed` entry.

### Acceptance Criteria

#### Happy Path
- Given a handoff with `--source-ref` where `openSpecPr` throws (gh ENOENT), when the
  local-commit fallback completes, then the ledger entry carries `branch:
  spec/<slug>` (status unchanged), and the CLI output still reports `local-commit`
  with the retained worktree path.
- Given a handoff where the PR opens normally, when it completes, then the existing
  behavior is unchanged: entry `done` with `prUrl` + `branch` (regression guard on the
  invariant side effect).

#### Negative Paths
- Given the ledger write itself fails during the local-commit fallback, when handoff
  completes, then the handoff still succeeds (evidence recording is advisory), and the
  failure is reported on stderr — never swallowed silently.
- Given a handoff with NO `--source-ref` (chat/CLI-arg idea), when the local-commit
  fallback runs, then no ledger write is attempted and behavior is unchanged.

### Done When
- [ ] Unit test: injected openSpecPr failure + sourceRef → ledger entry gains
      `branch`, status unchanged, stdout JSON kind `local-commit`.
- [ ] Regression test: pr-opened path still transitions `done`+`prUrl`+`branch`.
- [ ] Unit test: ledger write failure → exit 0, stderr contains the failure.

---

## Story: `engineer resolve` marks an entry delivered without JSON surgery

**Requirement:** TR-3

As the operator, I want `conduct-ts engineer resolve <sourceRef> --pr-url <url>
[--branch <branch>]` to mark a stranded intake entry `done` with evidence, so that
recovering from a write-back failure never requires hand-editing `ledger.json`.

### Acceptance Criteria

#### Happy Path
- Given a stranded entry at `claimed` with a recorded `branch`, when the operator runs
  `engineer resolve owner/repo#N --pr-url <url>`, then the entry becomes `done` with
  the given `prUrl` (existing `branch` preserved, or overridden by `--branch`), and the
  JSON output echoes the sourceRef, the prior status, and the recorded evidence so the
  operator can verify they hit the right entry.
- Given the same command run twice, when the second run completes, then the entry is
  unchanged (`done`, same evidence) and the command exits 0 (idempotent).

#### Negative Paths
- Given a sourceRef with no ledger entry, when `resolve` runs, then the output is
  `{ "kind": "resolve", "sourceRef": ..., "found": false }` with exit 0 (parity with
  `forget` — an absent ref is a report, not an error).
- Given `resolve` invoked without `--pr-url`, when the CLI parses arguments, then it
  exits non-zero with a usage message and writes nothing to the ledger.
- Given a malformed `--pr-url` value (not an http(s) URL), when `resolve` runs, then it
  exits non-zero with a validation message and writes nothing (invalid input never
  becomes fake delivery evidence).

### Done When
- [ ] Unit tests: happy resolve, idempotent re-run, found:false, missing/malformed
      `--pr-url` (each asserting exact JSON/exit code and ledger end-state).
- [ ] `engineer resolve` appears in the CLI usage/help output.
- [ ] After `resolve`, a subsequent `engineer claim` with a duplicate envelope for that
      ref heals/drops it via the TR-1 guard (integration of the two halves).

---

## Story: Docs and changelog track the new behavior

**Requirement:** TR-4

As a harness consumer, I want the guard, the evidence recording, and the resolve
primitive documented, so that operators discover the sanctioned recovery path instead
of editing state files.

### Acceptance Criteria

#### Happy Path
- Given the feature lands, when reading `README.md` and `src/conductor/README.md`,
  then `engineer resolve` (flags + example) and the claim-time delivery guard
  (auto-heal semantics, fail-safe skip) are documented.
- Given the PR, when reading `CHANGELOG.md`, then `[Unreleased]` carries entries under
  Fixed (guard, strand) and Added (`engineer resolve`).

#### Negative Paths
- Given the docs, when an operator follows the recovery section for a stranded entry,
  then the documented flow (`resolve`, or `forget` for evidence-less strands) matches
  actual CLI behavior — no step requires manual ledger edits.

### Done When
- [ ] Both READMEs updated in the same PR.
- [ ] `CHANGELOG.md` `[Unreleased]` has the Added + Fixed entries.
