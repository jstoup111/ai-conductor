**Status:** Accepted

# Stories: Dependency-Ordered Intake and Dispatch

**PRD:** `.docs/specs/2026-07-03-dependency-ordered-intake-and-dispatch.md` (#229)
**ADRs:** adr-2026-07-03-issue-dependencies-api-surface, adr-2026-07-03-dependency-gate-backlog-waiting-channel, adr-2026-07-03-dependency-fail-closed-and-cache, adr-2026-07-03-prose-to-link-migration

## Story: Blocker state is read live from the issue graph

**Requirement:** FR-1, FR-2

As the operator, I want a spec's dependencies read live from its originating issue's native
"blocked by" relationships so that the platform's issue graph is the only source of truth.

### Acceptance Criteria

#### Happy Path
- Given a spec whose originating issue has a "blocked by" link to an open issue, when
  dependency state is resolved, then the spec is reported blocked, naming that blocker.
- Given the blocker issue is closed (reason: completed), when dependency state is resolved on
  the next cycle, then the spec is reported unblocked with no operator action.
- Given the blocker issue is closed as not-planned, when dependency state is resolved, then
  the spec is reported unblocked (any close reason satisfies).

#### Negative Paths
- Given a blocker that was closed and later reopened, when dependency state is resolved after
  the reopen, then the spec is reported blocked again (no sticky "was satisfied" state).
- Given the originating issue has two blockers, one closed and one open, when dependency state
  is resolved, then the spec is blocked and only the open blocker is named.
- Given a "blocked by" link pointing at an issue in a different repository, when dependency
  state is resolved, then that blocker's open/closed state is honored exactly like a same-repo
  blocker (enforce-as-returned).
- Given the same originating issue is consulted twice within one scan pass, when dependency
  state is resolved, then the platform is queried at most once for it (per-scan memoization)
  and both consumers see the same answer.

### Done When
- [ ] Resolver tests cover: open blocker → blocked; closed (completed and not_planned) →
      unblocked; reopened → blocked; mixed set → blocked naming only open ones; cross-repo
      blocker state honored.
- [ ] A counting-fake platform boundary proves ≤1 query per distinct issue ref per scan pass.

## Story: Specs without an originating issue are never dependency-gated

**Requirement:** FR-3

As the operator, I want work that never came from an issue to flow exactly as today so that
the dependency gate cannot regress non-intake specs.

### Acceptance Criteria

#### Happy Path
- Given a merged spec with no recorded originating issue, when the daemon scans, then the spec
  is eligible for dispatch with zero dependency queries made for it.

#### Negative Paths
- Given a spec with no recorded originating issue AND the platform is completely unreachable,
  when the daemon scans, then the spec still dispatches (no hidden dependency coupling).
- Given a spec whose recorded originating-issue reference is malformed/unparseable, when the
  daemon scans, then the spec is treated as indeterminate (blocked, visible with reason) — a
  corrupt reference is not silently promoted to "no dependencies".

### Done When
- [ ] Test: no-origin spec dispatches with a platform fake that fails on any call.
- [ ] Test: malformed origin reference → WAITING with indeterminate reason, never dispatched.

## Story: Daemon skips blocked specs each cycle without dropping them

**Requirement:** FR-4, FR-5

As the operator, I want the daemon to hold a blocked spec — not build it, not forget it — so
that prerequisites always merge first and the spec proceeds the moment they do.

### Acceptance Criteria

#### Happy Path
- Given an otherwise-eligible spec whose originating issue has an open blocker, when the
  daemon scans repeatedly, then the spec is never dispatched while the blocker is open.
- Given that blocker closes, when the next scan runs, then the spec is dispatched (unblock
  latency ≤ one scan cycle).

#### Negative Paths
- Given a blocked spec, when it is skipped, then no processed/consumed marker is recorded for
  it — the skip is per-cycle, and the spec re-enters evaluation on every subsequent scan.
- Given a spec that was unblocked but not yet dispatched, when a new "blocked by" link is
  added to its originating issue before the next scan, then the next scan holds it again.
- Given a blocked spec and an unblocked spec that sorts after it, when the daemon picks work,
  then the unblocked spec is dispatched — a blocked spec never head-of-line-blocks the queue.

### Done When
- [ ] Daemon-loop test: open blocker → 0 dispatches across ≥3 ticks; close blocker → dispatch
      on the immediately following tick.
- [ ] Test: skip writes no processed marker; later scans re-evaluate the same spec.
- [ ] Test: backlog [blocked, unblocked] dispatches the unblocked one this tick.

## Story: Blocked specs are visible in a WAITING group

**Requirement:** FR-6

As the operator, I want every blocked spec listed in a WAITING section of the startup
dashboard and status output — with its blockers — so a phone check explains any stall.

### Acceptance Criteria

#### Happy Path
- Given one blocked spec, when the dashboard renders, then a WAITING section lists the spec
  with the open blocker reference(s) holding it.
- Given the same state, when status output is produced, then the same WAITING information
  appears there.

#### Negative Paths
- Given a spec is blocked, when the dashboard renders, then the spec appears ONLY in WAITING —
  not also in ELIGIBLE (exactly-one-bucket invariant).
- Given a blocked spec whose blocker set is unchanged across many scans, when scans repeat,
  then the block is logged at most once for that state while the WAITING section continues to
  show it (no log spam, no visibility loss).
- Given the spec's blocker set changes (e.g. one blocker closes, another remains), when the
  next scan runs, then the change is re-announced once and WAITING shows the updated set.

### Done When
- [ ] Dashboard render test: WAITING section present with slug + blocker refs; slug absent
      from ELIGIBLE.
- [ ] Log test: N identical-state scans → 1 announcement; state change → exactly 1 more.

## Story: Indeterminate dependency state fails closed, visibly

**Requirement:** FR-7

As the operator, I want a spec held — never built — when its dependency state can't be
determined, so an outage can't produce a wrong-order build.

### Acceptance Criteria

#### Happy Path
- Given the platform is unreachable, when the daemon scans a spec that has an originating
  issue, then the spec is not dispatched and appears in WAITING with an indeterminate reason.
- Given connectivity returns and the blockers are closed, when the next scan runs, then the
  spec dispatches normally.

#### Negative Paths
- Given the platform returns an error for one spec's query but succeeds for another's, when
  the scan completes, then only the erroring spec is indeterminate — the healthy spec's result
  is unaffected (no scan-wide poisoning).
- Given an indeterminate spec, when it is skipped, then no processed marker is written and no
  dispatch occurs even if the spec was eligible on the previous scan (no stale carry-over).
- Given the platform is unreachable, when the daemon scans, then specs WITHOUT an originating
  issue still dispatch (outage blast radius is bounded to intake-originated specs).

### Done When
- [ ] Test: failing platform fake → gated spec in WAITING(indeterminate), 0 dispatches of it,
      no processed marker; no-origin spec dispatches in the same tick.
- [ ] Test: per-spec error isolation — one failing query does not mark sibling specs.

## Story: Intake claims the oldest unblocked idea

**Requirement:** FR-8

As the operator, I want the engineer to author specs only for issues whose prerequisites have
shipped, so specs never describe a codebase state that doesn't exist yet.

### Acceptance Criteria

#### Happy Path
- Given pending intake entries [A(blocked), B(unblocked)] in age order, when a claim is made,
  then B is returned and A remains pending untouched.
- Given A's blocker closes, when the next claim is made, then A is returned.

#### Negative Paths
- Given A is deferred by a claim, when its ledger entry is inspected, then its status is still
  pending and its attempt count is unchanged (deferral is free — not a failed attempt).
- Given A's dependency state is indeterminate (platform error), when a claim is made, then A
  is deferred exactly like a blocked entry (fail-closed at intake too) and the claim proceeds
  to the next entry.
- Given entries [A(blocked), B(blocked), C(unblocked)], when a claim is made, then C is
  returned — deferral walks the whole queue in age order, not just the head.

### Done When
- [ ] Claim tests: [blocked, unblocked] → returns unblocked; blocker closes → previously
      deferred entry returned next; deferral leaves status/attempts unchanged.
- [ ] Test: indeterminate entry deferred; queue walk continues past multiple blocked entries.

## Story: All-blocked is reported distinctly from empty

**Requirement:** FR-9

As the operator, I want to know the difference between "no ideas waiting" and "ideas waiting
but every one is blocked (and on what)", so a silent-looking intake is explainable.

### Acceptance Criteria

#### Happy Path
- Given zero pending entries, when a claim is made, then the result is the existing empty
  outcome (unchanged shape for consumers).
- Given pending entries all blocked, when a claim is made, then the result is a distinct
  all-blocked outcome listing each entry with the blockers (or indeterminate reason) holding it.

#### Negative Paths
- Given pending entries all blocked, when a claim is made, then the outcome is NOT the empty
  outcome and NOT a claim — a consumer that only understands empty/claim cannot misread
  all-blocked as "nothing to do" without noticing a new kind.
- Given one entry blocked and one claimable, when a claim is made, then no all-blocked report
  is produced (the claim wins).

### Done When
- [ ] Claim output tests: empty vs all-blocked(with per-entry reasons) vs claim are three
      distinguishable results; all-blocked lists every deferred entry's blockers.

## Story: Migration proposes links from prose and writes only what the operator confirms

**Requirement:** FR-10

As the operator, I want existing prose declarations turned into native "blocked by" links in
one reviewed pass, so the v1.0 program (#217–#229) is enforceably ordered without re-authoring
issues.

### Acceptance Criteria

#### Happy Path
- Given open issues containing deterministic prose ("Gated on #217", "Depends on: #189 /
  #190", "Blocked by #226"), when the migration runs, then its dry-run proposal lists each
  derived link (issue X blocked-by issue N) before anything is written.
- Given the operator confirms, when the writes execute, then the proposed native links exist
  on the platform and the run summary reports each created link.
- Given umbrella phase task-lists (#228-style) and other heuristic prose, when the dry-run is
  produced, then those items appear in a manual-review list — proposed to the operator, never
  auto-derived as edges.

#### Negative Paths
- Given reverse-direction prose ("Blocker for #226"), when the proposal is built, then it is
  listed for manual review — not auto-converted (direction inversion is a judgment call).
- Given a cross-repository prose reference ("owner/other#5"), when the proposal is built, then
  it is listed for manual review and never auto-written.
- Given the operator declines confirmation, when the migration ends, then zero links were
  created (dry-run is fully side-effect free).
- Given prose referencing a closed issue, when the proposal is built, then the link is still
  proposed (graph completeness) — satisfaction is evaluated at gate time, not migration time.

### Done When
- [ ] Parser unit tests over the real #217–#229 issue bodies: every deterministic declaration
      produces its edge; heuristic/reverse/cross-repo cases land in manual-review.
- [ ] Dry-run-then-decline test proves zero write calls to the platform boundary.

## Story: Migration is idempotent and strictly additive

**Requirement:** FR-11

As the operator, I want to re-run the migration any time with no duplicates and no destructive
edits, so a partial or repeated run is always safe.

### Acceptance Criteria

#### Happy Path
- Given a completed migration run, when the migration runs again over the same issues, then it
  reports every previously created link as already-present and performs zero new writes.

#### Negative Paths
- Given a link already exists on the platform (created manually), when the migration proposes
  links, then that edge is reported as existing — not re-written, not duplicated.
- Given the platform rejects one write mid-run (e.g. transient error), when the run completes,
  then earlier successful links persist, the failure is reported per-edge, and a re-run
  completes only the missing edges (partial failure is recoverable by idempotency).
- Given any migration run, when it completes, then no issue was closed, re-opened, edited,
  labeled, or unlinked by it (additive-only audit).

### Done When
- [ ] Re-run test: second pass performs zero write calls (counting fake).
- [ ] Mid-run failure test: re-run creates exactly the missing edges.
- [ ] Boundary audit test: only link-creation calls are ever issued (no edit/close/label calls).

## Story: Dependency cycles surface as an error state

**Requirement:** FR-12

As the operator, I want work caught in a dependency cycle flagged as an error — not built,
not claimed, not silently stuck — so a bad graph is fixable instead of mysterious.

### Acceptance Criteria

#### Happy Path
- Given issues A and B where A is blocked by B and B is blocked by A, when either's spec is
  evaluated for dispatch, then the spec is held and surfaced in the WAITING/error surface
  identified as a cycle naming its members.
- Given the operator breaks the cycle (removes one link or closes one issue), when the next
  scan runs, then normal blocked/unblocked evaluation resumes.

#### Negative Paths
- Given a chain A→B→C with no back edge, when specs are evaluated, then no cycle is reported
  (a deep chain is not a cycle).
- Given a would-be cycle whose closing edge passes through a CLOSED issue, when evaluated,
  then no cycle is reported (closed nodes drop out of the graph; the open subgraph is what
  gates).
- Given a cycle exists, when intake claiming evaluates a member issue, then that entry is
  deferred with the cycle reason — a cycle never causes a claim, a dispatch, or an entry drop.

### Done When
- [ ] Cycle tests: 2-node cycle held + identified with members; chain and closed-node cases
      produce no false cycle; intake defers cycle members with reason.

