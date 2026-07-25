**Status:** Accepted

# Stories: Durable Shipped-Record Enforcement and Backfill (#916, #936)

**Track:** Technical

**Complexity:** Medium

**Architecture:** Approved ADR
`adr-2026-07-25-fail-closed-durable-shipment-evidence`

These stories supersede only two conflicting clauses in
`content-aware-shipped-work-dedup-never-re-dispatch.md`: shipped-record write failure may no longer
degrade to cache and historical backfill may no longer use an unknown PR or hash. Its canonical hash,
record-on-branch, stem/hash discovery dedup, and cache-repair behavior remain accepted.

## Verified Existing Foundation and Scope Boundary

- PR #937 already changed the normal skill-driven `/finish` sequence to create, commit, verify, and
  push the shipped record before it records local terminal state.
- PR #943 exercised that sequence successfully: its record commit was present on the PR head and
  landed atomically with the implementation on `main`.
- This feature does **not** rebuild that producer sequence. It adds engine-owned validation as a
  backstop, a required merge check, human-reviewed recovery, and the bounded historical backfill.
- The existing record schema and hash/story-resolution semantics remain unchanged. Strict evidence
  recomputes the same digest the current writer and discovery path use; changing which story links
  participate in historical hashes is a separate migration concern.

## Traceability

| Story | Approved technical intent |
|---|---|
| ST-916-1 Strict durable-evidence verdict | ADR Decision 1 |
| ST-936-2 Fail-closed engine convergence | ADR Decision 2 |
| ST-916-3 Required premerge evidence check | ADR Decisions 3–4 |
| ST-916-4 Human-merged postmerge repair | ADR Decisions 5–6 |
| ST-916-5 Proven historical audit and backfill | ADR Decision 7 |
| ST-936-6 Fresh-checkout durability and dedup compatibility | ADR Decision 8; issue #936 fresh-checkout outcome |

## Story ST-916-1: Produce one strict durable-evidence verdict

**Technical Intent:** ADR Decision 1

As a shipment boundary, I want one strict verdict for a plan and implementation PR so that every
completion path agrees whether durable evidence is valid.

### Acceptance Criteria

#### Happy Path

- **AC1:** Given exactly one shipped record at the expected plan stem whose slug, implementation PR,
  and existing canonical plan/resolved-stories hash match the candidate commit, and the record is
  contained in the pushed implementation head, when shipment evidence is evaluated, then the verdict
  is `valid` and identifies the checked slug, PR, record path, hash, and commit.
- **AC2:** Given evidence that already returned `valid`, when the same candidate commit is evaluated
  again, then it returns the same `valid` verdict without changing the record or repository state.

#### Negative Paths

- **NP1 (AC1 — missing/shape):** Given the expected record is absent, malformed, or lacks a required
  field, when evaluated, then the verdict is a typed refusal naming the exact defect; it is never
  `valid` and never falls back to a local processed marker.
- **NP2 (AC1 — identity/integrity):** Given a parseable record whose slug, PR URL, or hash differs
  from the expected value, when evaluated, then each mismatch produces a distinguishable refusal
  containing expected and observed evidence without rewriting the file.
- **NP3 (AC1 — reachability):** Given a matching record exists only as an uncommitted working-tree
  file, only in a local commit not present on the PR head/upstream, or on a stale head superseded by a
  newer PR head, when evaluated, then the verdict refuses the shipment and identifies the failed Git
  reachability check.
- **NP4 (AC1 — dependency/resource failure):** Given the plan, stories, record, Git state, or required
  PR evidence cannot be read because of an I/O, Git, authentication, or network failure, when
  evaluated, then the verdict is a typed refusal with the dependency failure; no exception or unknown
  state is converted to `valid`.
- **NP5 (AC2 — idempotency integrity):** Given an existing record differs from the expected content,
  when validation is repeated, then validation remains read-only and refuses consistently rather than
  overwriting the inaccurate record to make the check pass.

### Done When

- [ ] A fixture table proves `valid` for the exact record and distinct refusals for missing,
      malformed, slug mismatch, PR mismatch, hash mismatch, uncommitted, unpushed, and stale-head
      evidence.
- [ ] Repeated-validation tests prove byte-identical repository state for both valid and invalid
      records.
- [ ] Failure-injection tests prove file, Git, and GitHub failures cannot produce `valid`.
- [ ] All production shipment consumers assert the same closed verdict vocabulary rather than
      independently accepting partial evidence.

## Story ST-936-2: Keep every engine completion path unsatisfied without durable evidence

**Technical Intent:** ADR Decision 2

As an operator, I want engine completion to converge only after the implementation PR contains valid
durable evidence so that local terminal state cannot falsely report a shipment.

### Acceptance Criteria

#### Happy Path

- **AC1:** Given the existing #937 producer sequence has placed a record on the PR head and a daemon,
  inline-auto, inline-default, or inline-interactive PR finish receives a `valid` evidence verdict,
  when completion converges, then the PR URL, finish choice, DONE state, processed
  cache entry, successful teardown, and downstream ship side effects are allowed exactly once.
- **AC2:** Given an already-merged recorded PR whose matching durable record is valid on the merged
  history, when the merged-PR guard runs, then it may converge through the normal verified-ship
  boundary without rebuilding the feature.
- **AC3:** Given a `keep` or `discard` finish, when it completes, then it neither creates nor requires
  a shipped record and is never represented as a PR shipment.

#### Negative Paths

- **NP1 (AC1 — invariant on every entry path):** Given any of the four engine-driven PR modes receives
  a missing, malformed, mismatched, uncommitted, unpushed, stale, or unavailable evidence verdict,
  when completion is evaluated, then no finish-choice/DONE success, processed-cache write,
  destructive teardown, label cleanup, or mergeable-watch enrollment occurs; the work is preserved
  and a HALT names the evidence defect and remediation.
- **NP2 (AC1 — partial failure):** Given valid record content but terminal-state persistence fails,
  when convergence runs, then it does not report completion or perform later ship side effects; a
  retry can re-evaluate the still-valid record without duplicating it.
- **NP3 (AC2 — out-of-band merge gap):** Given the recorded PR is merged but its durable record is
  missing or invalid on merged history, when the guard runs, then it does not synthesize finish/DONE
  success or mark the feature processed; it preserves the branch, surfaces the durable-evidence gap,
  and leaves postmerge reconciliation to propose repair.
- **NP4 (AC2 — merge-state dependency failure):** Given merge state or merged-history evidence cannot
  be read, when the guard runs, then it cannot claim a verified ship and the work remains recoverable
  rather than being torn down.
- **NP5 (AC3 — stale alternate state):** Given a keep/discard finish has stale PR metadata or an
  unrelated shipped record in the worktree, when it completes, then that data does not convert the
  non-shipping choice into a PR shipment or write a processed shipped marker.

### Done When

- [ ] Existing #937/#943 behavior is retained and verified rather than reimplemented.
- [ ] An acceptance matrix covers daemon, inline-auto, inline-default, and inline-interactive PR
      finishes with valid evidence and every strict refusal class.
- [ ] Each refusal assertion proves success markers and ship side effects are absent while HALT and
      work preservation are present.
- [ ] Merged-PR tests distinguish valid-record convergence from recordless/invalid and unavailable
      evidence without a synthetic-success branch.
- [ ] Keep/discard regression tests prove no record requirement, record creation, or shipped status.

## Story ST-916-3: Require durable evidence before an implementation PR can merge

**Technical Intent:** ADR Decisions 3–4

As a repository maintainer, I want every pull request to receive a stable shipped-record check so
that a deterministically associated implementation cannot merge through the normal protected path
without valid evidence.

### Acceptance Criteria

#### Happy Path

- **AC1:** Given a pull request with one exact plan-stem association, corroborating PR metadata, at
  least one non-spec implementation change, and a `valid` record at its immutable head, when the
  premerge check runs, then the stable shipped-record status succeeds and identifies the associated
  plan and record.
- **AC2:** Given a spec-only, plan-only, unassociated documentation-only, or record-only repair pull
  request with no implementation association, when the check runs, then it reports success as
  `not-applicable` with its classification rather than demanding a shipped record.
- **AC3:** Given any pull request targeting protected `main`, when it is opened, reopened, or updated,
  then the same stable check context reports a terminal result and the existing ruleset requires that
  context before normal merge.
- **AC4:** Given the existing `main` ruleset, when the required status is added, then squash-only PRs,
  one approving review, code-owner review, deletion/non-fast-forward/creation/update restrictions,
  and the existing bypass configuration remain unchanged.

#### Negative Paths

- **NP1 (AC1 — missing/invalid record):** Given a uniquely associated implementation PR whose record
  is absent or receives any strict refusal, when the check runs, then the stable status fails with the
  exact evidence defect and protected `main` rejects a normal merge.
- **NP2 (AC1 — association integrity):** Given a PR contains a fuzzy slug resemblance but lacks an
  exact plan stem, exact PR metadata corroboration, or non-spec implementation change, when classified,
  then it is not treated as proven implementation work and no record is fabricated.
- **NP3 (AC2 — ambiguity):** Given zero or multiple exact candidate associations, when the check runs,
  then it reports `not-applicable` plus an explicit unresolved/ambiguous diagnostic; it does not guess
  a slug or mutate the PR.
- **NP4 (AC3 — workflow failure):** Given checkout, dependency setup, classification, or validation
  fails before a success can be reported, when branch protection evaluates the PR, then the required
  context remains non-successful and normal merge stays blocked rather than failing open.
- **NP5 (AC4 — protection drift):** Given a proposed ruleset update omits or weakens any existing
  protection, when delivery validates the before/after rule inventory, then the update is rejected and
  the existing ruleset remains intact.

### Done When

- [ ] Pull-request event tests cover exact implementation, spec-only, plan-only, docs-only,
      record-only, zero-match, multi-match, and invalid-record classifications.
- [ ] The check runs without path filters and reports one stable context for opened, reopened, and
      synchronized PR heads.
- [ ] A ruleset inspection after delivery proves the required status is active and every pre-existing
      protection/bypass value is preserved.
- [ ] A failure-path test proves an Action/runtime failure cannot emit a successful evidence status.

## Story ST-916-4: Reconcile a missed record through one human-merged repair PR

**Technical Intent:** ADR Decisions 5–6

As an operator, I want a merged implementation with missing or invalid durable evidence to produce
one reviewable repair PR automatically so that recovery is noticed and authored without granting
automated merge authority.

### Acceptance Criteria

#### Happy Path

- **AC1:** Given a merged PR with one proven plan association and missing or strictly invalid durable
  evidence on `main`, when reconciliation runs, then it creates or updates one deterministic
  record-only repair PR containing the expected slug, merged implementation PR, canonical hash, and
  shipped date; the record reaches `main` only after a human approves and merges that PR.
- **AC2:** Given the merged PR already has an accurate valid record on `main`, when reconciliation
  runs, then it reports aligned and creates no branch, commit, comment, or PR.
- **AC3:** Given the same missing record is reconciled repeatedly or by overlapping runs, when those
  runs settle, then at most one open repair PR exists for the implementation-PR/slug identity and
  retries reuse or converge on its deterministic branch.
- **AC4:** Given a valid repair-branch record, when the creating job evaluates that exact repair head,
  then it posts the same stable required status as successful so the human-merge path is usable even
  though token-created PR events do not start the normal PR workflow.
- **AC5:** Given reconciliation is authorized, when its external operations are inspected, then its
  writes are limited to the deterministic repair branch, record-only PR, and repair-head status; it
  never pushes to `main`, approves, requests an approval, enables auto-merge, or merges.

#### Negative Paths

- **NP1 (AC1 — uncertain association):** Given association is absent, ambiguous, contradictory, or
  cannot resolve a product spec to a canonical plan, when reconciliation runs, then it emits a visible
  unresolved result and writes no record, branch, commit, or PR.
- **NP2 (AC2 — preserve accurate evidence):** Given an existing record is accurate and valid, when
  repeated events arrive, then its bytes and Git history remain unchanged; reconciliation never
  refreshes dates or cost data merely because it reran.
- **NP3 (AC3 — race/API failure):** Given a competing repair-branch update, rate limit, timeout,
  authentication failure, or GitHub write error, when reconciliation runs, then it reports failure,
  never falls back to a direct `main` write, and a retry still targets the same identity rather than
  opening a duplicate PR.
- **NP4 (AC4 — invalid repair head):** Given the proposed repair record fails strict validation, when
  the creating job reports status, then the stable context is failed, not successful, and the repair
  PR remains blocked by normal protection.
- **NP5 (AC5 — insufficient permission):** Given the job token lacks branch, PR, or status authority,
  when reconciliation attempts repair, then it fails visibly without broadening permissions at
  runtime or invoking any approve/merge/direct-main fallback.

### Done When

- [ ] Event-driven tests cover valid no-op, missing repair, invalid-record correction, ambiguous skip,
      and API/auth/rate-limit failure.
- [ ] Retry and concurrency tests prove one deterministic branch and at most one open repair PR per
      implementation-PR/slug identity.
- [ ] A changed-path assertion proves every repair commit is record-only.
- [ ] Command/API spies assert zero direct-main push, approval, review request, auto-merge, and merge
      operations across success and every failure branch.
- [ ] Repair-head tests prove the stable status is posted by the creating job and reflects the strict
      verifier result.

## Story ST-916-5: Audit and backfill only proven historical shipments

**Technical Intent:** ADR Decision 7

As a repository maintainer, I want every historical plan and product spec audited against merged PR
evidence so that missing records are backfilled without turning local hints or ambiguous history into
false shipment facts.

### Acceptance Criteria

#### Happy Path

- **AC1:** Given the committed history, when the audit runs, then every plan and product spec is
  considered; a product spec linked by exact repository evidence to a differently named canonical
  plan is evaluated under that plan's record identity.
- **AC2:** Given a candidate with one proven merged implementation PR and missing or strictly invalid
  record, when the audit completes, then it proposes exactly one valid record on this feature branch
  and classifies the candidate as backfilled with the supporting plan/spec and PR evidence.
- **AC3:** Given an existing accurate valid record, when the audit runs repeatedly, then it is
  classified as aligned and remains byte-identical with no duplicate commit or rewritten date/cost.
- **AC4:** Given all GitHub history pages and repository candidates were evaluated, when the audit
  finishes, then its machine-readable report marks the run complete and gives every candidate one
  classification, its evidence, resulting record path or skip reason, and aggregate counts.

#### Negative Paths

- **NP1 (AC1 — unrepresentable source):** Given a product spec has no provable canonical plan, when
  audited, then it is classified unresolved and no spec-only hash, unknown hash, or placeholder
  record is invented.
- **NP2 (AC2 — insufficient proof):** Given a candidate has no merged implementation PR, multiple
  plausible PRs, only a local processed marker, only a candidate-count heuristic, a spec-only PR, or
  contradictory metadata, when audited, then it is reported and skipped with zero record writes.
- **NP3 (AC3 — accurate record immutability):** Given an accurate record already exists but a later
  plan edit, local marker, or newer unrelated PR is observed, when audited, then the audit does not
  overwrite the record; contradictory evidence is reported for human review.
- **NP4 (AC4 — incomplete dependency scan):** Given pagination, authentication, rate limiting,
  timeout, or repository read failure prevents the full candidate/history scan, when the command
  exits, then it returns non-success, marks the report incomplete, and never claims candidates with
  unavailable evidence were aligned or backfilled.
- **NP5 (AC4 — report persistence failure):** Given the report cannot be durably written, when the
  audit reaches completion, then it returns non-success and does not print a successful-complete
  summary that would hide the missing audit trail.

### Done When

- [ ] The audit report contains one row per committed plan and product spec, stable classifications,
      supporting evidence/reasons, aggregate totals, and an explicit complete/incomplete state.
- [ ] Every `backfilled` row has exactly one valid record diff on the feature branch; every aligned,
      unresolved, absent, ambiguous, or contradictory row has no generated record diff.
- [ ] A second complete run produces no record changes, deterministically reclassifies prior
      `backfilled` rows as `aligned`, and preserves unresolved/absent/ambiguous/contradictory results.
- [ ] Per operator direction on 2026-07-25, the one-time historical backfill adds no dedicated
      automated fixtures or backfill test suite; review evidence is the real complete report, exact
      record diff, strict verification of every generated record, and the diff-free second run.

## Story ST-936-6: Preserve fresh-checkout durability and compatible discovery dedup

**Technical Intent:** ADR Decision 8

As a daemon operator, I want merged durable evidence to prevent redispatch from any checkout while
retaining existing content-aware discovery behavior so that enforcement closes the durability gap
without reopening shipped work.

This is a regression boundary over existing discovery behavior, not a request to redesign or
replace `shipped-record.ts` dedup.

### Acceptance Criteria

#### Happy Path

- **AC1:** Given an implementation record landed atomically with its feature PR or later through a
  human-merged repair/backfill PR, when a fresh checkout with an empty local processed directory
  discovers the unchanged plan, then it skips the feature as shipped and repairs the local cache.
- **AC2:** Given a committed record whose canonical hash matches a renamed plan, when discovery runs,
  then the existing hash-based rename detection skips the renamed candidate and repairs the cache
  under its current slug.
- **AC3:** Given a committed same-stem record whose plan content later changed, when ordinary backlog
  discovery runs, then the existing stem-based dedup remains unchanged; strict hash matching is
  required for a new completion claim, not retroactively for discovery of an already recorded stem.

#### Negative Paths

- **NP1 (AC1 — non-durable evidence):** Given the record exists only in another worktree, an unmerged
  branch, ignored pipeline state, or a machine-local processed marker, when a fresh checkout runs,
  then that evidence is not present as a durable shipped fact and cannot satisfy strict shipment
  completion there.
- **NP2 (AC1 — cache repair failure):** Given the committed valid record proves shipment but the
  fresh checkout cannot write its local cache, when discovery runs, then it still skips that poll and
  later polls from repository evidence; cache failure does not cause redispatch.
- **NP3 (AC2 — dedup false positive guard):** Given a renamed plan's content differs from every
  shipped hash, when discovery runs, then hash-based dedup does not claim a match merely from a fuzzy
  name; it proceeds under the existing discovery rules.
- **NP4 (AC3 — terminal/cache distinction):** Given only a same-stem record or local cache marker but
  the active completion candidate's PR/hash/commit evidence is invalid, when completion is evaluated,
  then permissive discovery dedup does not leak into the strict terminal verdict and completion
  remains unsatisfied.

### Done When

- [ ] A fresh-checkout acceptance test with an empty local ledger skips every fixture whose valid
      record landed through feature, repair, or backfill PR paths.
- [ ] Cache-write failure tests prove repository evidence remains authoritative for discovery.
- [ ] Regression tests pin same-stem and renamed-hash discovery behavior while strict completion
      separately rejects stale/mismatched evidence.
- [ ] A local-marker-only fixture proves it cannot satisfy strict terminal completion or provide
      cross-checkout durability.
