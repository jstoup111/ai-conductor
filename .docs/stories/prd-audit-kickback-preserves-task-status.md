**Status:** Accepted

# Stories: engine-owned, git-derived task-status.json (#302)

**Track:** technical (no PRD). Requirements trace to the binding constraints (H1–H9) of the
APPROVED `adr-2026-07-05-engine-owned-task-status.md` and its carried-over properties.
**Source:** jstoup111/ai-conductor#302. Tier L — full per-criterion negative-path rule applies.
Slices per the architecture review: Slice 1 = loop-and-wipe elimination, Slice 2 =
remediation-extends-plan, Slice 3 = survivable auto-park.

---

## Slice 1 — loop-and-wipe elimination

## Story: Engine seeds task-status.json from the plan at build entry

**Requirement:** ADR H1, H8 (plan resolution)

As the conductor engine, I want to seed `.pipeline/task-status.json` from the active plan by
merge/upsert at build entry so that the task list is never empty when the plan has tasks and no
existing engine state is lost.

### Acceptance Criteria

#### Happy Path
- Given an approved plan with tasks 1–5 and no `task-status.json`, when the build step is entered,
  then `task-status.json` exists with one `pending` entry per plan task, keyed by task id.
- Given an existing `task-status.json` with task 2 engine-stamped `completed` (with `evidencedBy`)
  and task 3 `in_progress`, when the engine re-seeds (kickback re-entry), then task 2 remains
  `completed` with its evidence stamp and task 3 remains `in_progress` — merge, never overwrite.
- Given the plan gained task 6 via remediation, when the engine re-seeds, then task 6 is upserted
  as `pending` alongside the preserved rows (idempotent: a second re-seed produces a byte-identical
  file).
- Given the plan step completed, when the engine records the active plan path from its plan
  snapshot, then seed resolves the plan from that engine-recorded path — not from agent-written
  `plan_ref` or `.pipeline/plan-ref.md`.

#### Negative Paths
- Given a plan with tasks and an existing `task-status.json` whose rows were wholesale-rewritten by
  an agent (all rows deleted), when the engine re-seeds, then every plan task is restored as an
  entry and no error is raised — the wipe is repaired, not fatal.
- Given `.docs/plans/` contains multiple historical plans and no engine-recorded plan path exists
  (pre-migration state), when seed cannot unambiguously resolve the active plan, then seed does NOT
  glob-guess; it routes to the empty/missing-plan handling (park in daemon mode, actionable retry
  hint interactively) and logs which resolution was attempted.
- Given the plan file is missing or has zero parseable tasks, when the build step is entered, then
  seed writes no fabricated entries and the empty/missing-plan path (see auto-park story) is taken —
  never a `done` verdict.
- Given two concurrent gate evaluations race to re-seed (daemon tick + stall check), when both
  write, then the result is a well-formed file equivalent to a single seed (last-writer-wins on
  identical content; no partial/corrupt JSON — write is atomic via temp-file rename).

### Done When
- [ ] A vitest spec proves seed creates one entry per plan task on a fresh build and preserves
      engine-stamped `completed`/`in_progress` rows and upserted remediation tasks on re-seed.
- [ ] A vitest spec proves re-seed after an agent wholesale wipe restores all plan tasks.
- [ ] A vitest spec proves seed reads the engine-recorded plan path and ignores agent-written
      `plan_ref` when they disagree.
- [ ] Seed writes are atomic (temp file + rename) — asserted by a spec that inspects the write path.

---

## Story: Completion evidence is the `Task: <id>` trailer, read from the commit body

**Requirement:** ADR H5

As the conductor engine, I want per-task completion derived from `Task: <id>` git trailers in
commit bodies so that completion is ground truth from git, not agent bookkeeping.

### Acceptance Criteria

#### Happy Path
- Given plan task 3 attributed files `src/a.ts` and a commit whose body carries trailer `Task: 3`
  and whose diff touches `src/a.ts`, when derive runs, then task 3 is marked `completed` with
  `evidencedBy: <sha>`.
- Given one commit carrying two trailers `Task: 3` and `Task: 4`, when derive runs, then both tasks
  are evidenced by that single commit.
- Given task 5 was implemented across three commits and only the last carries `Task: 5`, when
  derive runs, then task 5 is `completed` — any one evidencing commit suffices.
- Given a task whose plan section lists no file paths, when a commit carries its `Task: <id>`
  trailer, then the trailer alone completes it (no name-match requirement).

#### Negative Paths
- Given a compliant commit whose trailer is only in the body (subject: `fix: wire park marker`),
  when derive runs, then the task IS evidenced — a subject-only scan is a failing implementation
  (regression spec pinned to the `%(trailers:key=Task,valueonly)`/`%B` read).
- Given a commit subject `fix daemon rekick (#3)` (issue ref, no trailer) touching task 3's files,
  when derive runs post-migration, then task 3 is NOT completed — `#<id>`/`T<id>` subject forms are
  never authoritative for post-cutover rows.
- Given a commit with trailer `Task: 3` whose diff touches none of task 3's plan files (and task 3
  has plan files), when derive runs, then task 3 is NOT completed (trailer + path corroboration
  required when paths exist) and the mismatch is recorded in the audit trail.
- Given a malformed trailer (`Task:3`, `task: 3`, `Tasks: 3`), when derive runs, then behavior is
  pinned by spec: the canonical grammar is `Task: <id>` (git trailer syntax, case-sensitive key);
  non-conforming forms fall through to the plan-path fallback rather than silently matching.

### Done When
- [ ] `listCommits`/derive reads full messages or trailers — a spec commits a body-only trailer and
      asserts the task heals.
- [ ] A spec proves a `(#N)` issue-ref subject does NOT evidence task N post-cutover.
- [ ] Multi-trailer and multi-commit specs pass.
- [ ] The trailer grammar is documented in the `/tdd` and `/pipeline` SKILL.md changes (see the
      contract story) and matches the parser exactly.

---

## Story: The gate recomputes completion on every evaluation and never trusts file rows

**Requirement:** ADR H6, H7 (cadence)

As the conductor engine, I want the build completion gate to recompute per-task status from plan +
git evidence + engine sidecar on every evaluation so that neither a wiped nor a forged
`task-status.json` can change the verdict.

### Acceptance Criteria

#### Happy Path
- Given all plan tasks have evidencing commits, when the gate evaluates, then it returns `done`
  regardless of what `task-status.json` contained beforehand (derive runs first, then the check).
- Given attempt 1 missed the gate and attempt 2 committed the remaining tasks, when the gate
  re-evaluates after attempt 2, then derive runs again (no once-per-run guard) and the gate passes.
- Given the stall breaker measures resolved-task deltas, when derive runs before each
  resolved-count read, then an attempt that committed evidenced work never reads as a zero-delta
  stall.

#### Negative Paths
- Given an agent (or stale hook) wrote `status: "completed"` on every row with zero commits on the
  branch, when the gate evaluates, then it does NOT pass — agent-written `completed` without an
  engine evidence stamp is ignored; the gate reports those tasks as incomplete.
- Given `task-status.json` is deleted mid-run, when the gate evaluates, then the engine re-seeds
  and re-derives and returns the evidence-based verdict — never `missing`-forever.
- Given `task-status.json` contains invalid JSON (agent crash mid-write), when the gate evaluates,
  then the engine rebuilds it from seed+derive and logs the anomaly — invalid JSON is not a
  terminal gate state.
- Given the `autoHealAttempted` once-guard remains in place for build, then a regression spec fails
  — the guard's removal for the build step is pinned.

### Done When
- [ ] A vitest spec forges all-completed rows with no commits and asserts the gate stays failed.
- [ ] A vitest spec proves derive runs on each of two consecutive gate evaluations in one run
      (second attempt's commits are seen).
- [ ] A vitest spec proves gate recovery from deleted and from corrupt `task-status.json`.
- [ ] The stall breaker spec proves committed-but-underived work never reports `no_task_progress`.

---

## Story: Durable engine state lives in an engine-only sidecar

**Requirement:** ADR H6, H7 (durable counter)

As the conductor engine, I want evidence stamps, no-evidence attempt counters, and the migration
grandfather set persisted in an engine-only file so that no agent write can destroy authoritative
state.

### Acceptance Criteria

#### Happy Path
- Given derive evidences task 3 at commit `abc1234`, when the sidecar is written, then it records
  `task 3 → evidencedBy abc1234` and survives any subsequent rewrite of `task-status.json`.
- Given a no-evidence gate miss, when the attempt counter increments, then the count is read back
  correctly by a *fresh* engine process (daemon re-kick spawns a new run).
- Given a completed-count increase between evaluations, when the counter logic runs, then the
  no-evidence attempt counter resets (forward progress observed — this delta is the #280 signal).

#### Negative Paths
- Given the agent wholesale-rewrites or deletes `task-status.json`, when the gate next evaluates,
  then evidence stamps and counters are unaffected (they were never in that file).
- Given the sidecar itself is missing or corrupt (fresh clone, crash), when the engine reads it,
  then it fails safe: counters restart at zero (park later, never crash) and evidence is
  re-derived from git (git remains ground truth; the sidecar is a cache of derivation + counters).
- Given the `/pipeline` or `/tdd` skill text, when grepped, then no instruction directs any agent
  to write the sidecar path — it is engine-only by contract and absent from all skill templates.

### Done When
- [ ] Sidecar path (e.g. `.pipeline/task-evidence.json`) is gitignored run evidence, written only
      by engine code (grep: zero writers outside `src/conductor/src/engine/`).
- [ ] A vitest spec proves the attempt counter survives across two separate engine process
      invocations (simulated re-kick).
- [ ] A vitest spec proves counter reset on completed-count increase.
- [ ] A vitest spec proves sidecar corruption degrades to re-derivation, not a crash.

---

## Story: The trailer contract reaches the committing agent — /tdd and /pipeline both change

**Requirement:** ADR H2, H4

As the harness, I want the `Task: <id>` trailer required at both the `/tdd` commit checklist (the
subagent that runs `git commit`) and the `/pipeline` dispatch template (which injects the id) so
that the evidence contract is enforced where commits actually happen.

### Acceptance Criteria

#### Happy Path
- Given the `/pipeline` per-task dispatch, when the subagent prompt is built, then it contains the
  task's id and the instruction to stamp every commit for this task with the `Task: <id>` trailer.
- Given the `/tdd` SKILL.md commit checklist, when read, then the trailer is a listed gate for the
  COMMIT step (including refactor commits — every commit of the task carries it).
- Given the `/pipeline` Entry Guard, when the task list is empty, then the guard treats it as
  seed-and-run (proceed), never as completion — the `all([]) === true` early-exit is removed.

#### Negative Paths
- Given a subagent commit that omits the trailer but touches exactly the task's plan files, when
  derive runs, then the plan-path fallback may evidence it — but the audit trail records
  `fallback: path-match` so trailer non-compliance is visible.
- Given a task that cannot be evidenced by trailer OR path fallback after N attempts, when the
  daemon evaluates, then the auto-park fires (see Slice 3) — never an infinite retry.
- Given `/pipeline` SKILL.md post-change, when grepped, then no text instructs the agent to mark
  tasks `completed`/`skipped` in `task-status.json`; agent writes are scoped to `pending`/
  `in_progress` scheduling transitions only (the user-exit contract's `in_progress → pending`
  flip still works and remains specified).
- Given the harness integrity suite, when a SKILL.md edit reintroduces an authoritative agent
  write instruction ("mark the task completed in task-status.json"), then the suite fails (guard
  check over the two SKILL.md files).

### Done When
- [ ] `skills/tdd/SKILL.md` commit checklist includes the trailer gate; `skills/pipeline/SKILL.md`
      dispatch template injects the id; both reviewed in the same PR.
- [ ] Entry Guard early-exit-on-empty removed from `skills/pipeline/SKILL.md`.
- [ ] `skills/pipeline/SKILL.md` retains the user-exit `in_progress → pending` contract and the
      dependency-order reads, restated against the field-level write partition.
- [ ] Integrity-suite check (or explicit test) fails if authoritative agent-write instructions
      reappear in either SKILL.md.

---

## Story: Commit-less completions use a no-op evidence commit

**Requirement:** ADR H5 (skipped / pre-completed / side-effect-completed)

As a build agent, I want a sanctioned evidence form for tasks that produce no code commit of their
own so that skipped and pre-completed tasks complete the gate instead of parking a finished
feature.

### Acceptance Criteria

#### Happy Path
- Given plan task 5 already satisfied by prior work, when the agent creates an empty commit with
  trailers `Task: 5` and `Evidence: satisfied-by <sha>`, then derive marks task 5 `completed`
  with that commit as evidence.
- Given plan task 6 legitimately not applicable, when the agent creates an empty commit with
  `Task: 6` and `Evidence: skipped <reason>`, then derive marks task 6 `skipped` and the gate
  accepts it.
- Given task 4's change landed inside task 3's commit, when the agent stamps a no-op evidence
  commit `Task: 4` / `Evidence: satisfied-by <task-3 sha>`, then task 4 completes without
  re-implementation.

#### Negative Paths
- Given an `Evidence: skipped` commit for a task the plan marks as depended-upon by an incomplete
  task, when derive runs, then the skip still records but the dependent task's own evidence is
  still required — a skip never transitively completes dependents.
- Given an `Evidence: satisfied-by <sha>` whose referenced sha does not exist on the branch, when
  derive runs, then the task is NOT completed and the dangling reference is logged in the audit
  trail (no blind trust in the annotation).
- Given an empty commit with `Task: <id>` but no `Evidence:` trailer and no file overlap, when
  derive runs, then behavior is pinned by spec: it does not count as completion evidence (an empty
  diff with a bare task trailer is ambiguous — require the explicit `Evidence:` form).

### Done When
- [ ] Derive specs cover `satisfied-by` (valid + dangling sha) and `skipped` forms.
- [ ] The gate accepts derive-produced `skipped` rows.
- [ ] `/pipeline`'s pre-completion-scan section instructs the no-op evidence commit instead of a
      JSON write; `/tdd` documents the `Evidence:` trailer forms.

---

## Story: Evidence range is plan-anchored and fails closed on merge-base failure

**Requirement:** ADR H5 (range), carried "no false-positive on a fresh build"

As the conductor engine, I want the evidence commit range anchored to the current plan and bounded
by the branch merge-base so that stale or foreign commits can never complete a task.

### Acceptance Criteria

#### Happy Path
- Given a fresh worktree branch with 0 commits since merge-base, when derive runs, then zero tasks
  are evidenced and the gate reports all pending — behavior unchanged.
- Given commits from a previous plan iteration on the same branch (before the current plan's
  reference commit) carrying `Task: 1`, when derive runs against the new plan, then those stale
  commits do NOT evidence the new plan's task 1 — the range starts at the plan anchor.

#### Negative Paths
- Given `git merge-base origin/main HEAD` fails (no remote, shallow clone, detached state), when
  derive runs, then the commit list is treated as EMPTY and the anomaly logged — never the
  unbounded `HEAD -n 100` scan (regression spec: a repo without `origin/main` where trunk-style
  history contains `Task: <id>` commits must evidence nothing).
- Given the plan anchor commit is unreachable (rebased away), when derive runs, then derive falls
  back to the merge-base bound only (still branch-scoped) and logs the anchor loss — never an
  unbounded range.

### Done When
- [ ] A vitest spec in an isolated repo proves merge-base failure yields zero evidence + a logged
      anomaly.
- [ ] A spec proves pre-anchor same-id commits do not evidence the current plan.
- [ ] The fresh-build spec (0 commits → 0 evidenced) passes.

---

## Story: Third writers are eliminated — hook removed, finish write dropped, retry hint rewritten

**Requirement:** ADR H4, H6

As the harness, I want every non-engine writer of `completed` status removed so that the
single-authority claim is true in the wired system, not just in skill prose.

### Acceptance Criteria

#### Happy Path
- Given the `post-commit-pipeline-sync.sh` PostToolUse hook, when this feature ships, then the
  hook no longer writes `task-status.json` (removed from `hooks/claude/` and from the
  `bin/install` wiring, or reduced to a no-op with a deprecation note) — a `git commit` fires no
  non-engine status write.
- Given `skills/finish/SKILL.md`, when read post-change, then the "Update task-status.json if
  pipeline was active" instruction is gone.
- Given a build gate miss with reason `tasks not completed`, when `buildRetryHint` builds the
  hint, then it instructs "commit the remaining work with the `Task: <id>` trailer (empty
  `Evidence:` commit if already done)" — never "update .pipeline/task-status.json yourself."
- Given the replacement fast-feedback hook in the removed hook's PostToolUse slot
  (engine-invoking, operator-approved ADR amendment), when a `git commit` lands that evidences no
  task (no trailer match, no path fallback), then the hook output warns the agent — naming the
  commit and the expected `Task: <id>` form — at commit time, not gate time.
- Given a `git commit` that DOES evidence a task, when the fast-feedback hook runs, then it is
  silent (no warning noise on compliant commits).

#### Negative Paths
- Given a consumer repo that installed the old hook, when `bin/install`/`bin/migrate` runs the
  update, then the stale hook wiring is replaced by the fast-feedback hook (migration block in
  CHANGELOG) — an orphaned old hook silently forging completions is the failure this story exists
  to prevent.
- Given any remaining repo source (`src/conductor`, `skills/`, `hooks/`, `bin/`), when grepped for
  `task-status.json` writers, then only engine code and the sanctioned agent scheduling writes
  remain — asserted as a test or integrity check, not a one-off audit. The fast-feedback hook
  passes this audit: it only invokes the engine derive, never writes status itself.
- Given the fast-feedback hook errors (engine binary missing, derive throws), when a `git commit`
  lands, then the commit and the build continue unaffected (non-fatal, logged) — the per-gate
  derive remains the sole authority and the only correctness-bearing path.

### Done When
- [ ] Old hook removed + replacement engine-invoking hook wired via `bin/install` + CHANGELOG
      migration block present.
- [ ] Fast-feedback specs: warning on non-evidencing commit, silence on evidencing commit,
      non-fatal on hook error.
- [ ] `buildRetryHint` no longer instructs agent self-marking (spec asserts new wording, and the
      `'no tasks'`/`'missing'` cases direct at the plan: "no parseable tasks — fix `.docs/plans/…`").
- [ ] Repo-wide writer audit is encoded as a check (grep-based integrity test).

---

## Story: In-flight features migrate via the grandfather stamp; completed rows never demote

**Requirement:** ADR H8

As an operator with features mid-build at cutover, I want existing completed work honored without
trailers so that the migration doesn't park or redo finished tasks.

### Acceptance Criteria

#### Happy Path
- Given a pre-cutover `task-status.json` with tasks 1–4 `completed` (agent-written, no trailer
  commits), when the engine first seeds, then those terminal rows are stamped
  `evidencedBy: migration-grandfather` and count as complete at the gate.
- Given a grandfathered row, when every later seed/derive runs, then it is preserved — never
  demoted to `pending`, even though no trailer evidence exists.

#### Negative Paths
- Given a pre-cutover row `completed` and a post-cutover kickback adding task 5, when derive runs,
  then only task 5 requires trailer evidence — the grandfather never extends to rows created after
  first engine seed (a post-cutover agent-forged `completed` gets no stamp and is ignored, per the
  gate story).
- Given an evidenced `completed` task whose commit is later lost (rebase drops it), when derive
  runs, then the task stays `completed` — never-demote is explicit; post-completion evidence loss
  is a stated non-goal caught by tests/finish verification, and a spec pins that derive performs
  no demotion.

### Done When
- [ ] First-seed spec proves terminal rows gain the grandfather stamp exactly once.
- [ ] A spec proves post-first-seed agent-written `completed` rows get no stamp and don't count.
- [ ] A spec pins never-demote (evidence removed → status unchanged).

---

## Slice 2 — remediation extends the plan

## Story: Remediation tasks are plan tasks with deterministic, parseable ids

**Requirement:** ADR H3, H9

As the conductor engine, I want `/remediate` to append gap-derived tasks to the plan under an id
grammar the parser understands so that remediation work is seeded, evidenced, and completed like
any other task.

### Acceptance Criteria

#### Happy Path
- Given a blocking prd-audit gap FR-10, when `/remediate` runs, then the plan gains a task whose id
  is deterministic and gate-source-prefixed (per the grammar chosen in this story's design note),
  and `parsePlanTaskPaths`/`expandTaskIds` parse it — id, name, and file paths all round-trip.
- Given the engine re-seeds after the plan extension, then the remediation task appears as
  `pending` in `task-status.json` and a trailer-stamped commit completes it end-to-end.
- Given a second `/remediate` round with the same still-open gap producing the same deterministic
  id, when the upsert runs, then exactly one plan task exists (idempotent — no duplicate).

#### Negative Paths
- Given a remediation task already `completed` with evidence, when a later round re-derives the
  same id for a DIFFERENT residual gap (content drift), then the upsert does NOT mutate the
  completed task — the new work gets a bumped ordinal/content-suffix id, and a spec pins this.
- Given gaps from two different gates that would derive colliding ids, when both are upserted,
  then the gate-source prefix keeps them distinct (spec constructs the collision).
- Given a remediation task with an empty or missing id in `remediation.json`, when the plan-append
  runs, then it is REJECTED with a validation error (non-empty deterministic id is validated, not
  conventional) — the append never writes an unaddressable task.
- Given dotted ids (`1.2`) or the chosen alphanumeric forms, when `expandTaskIds` parses plan
  headers, then no id is silently dropped — the parser's accepted grammar and the emitters'
  produced grammar are proven identical by a shared fixture.

### Done When
- [ ] One id grammar decision recorded in the plan/ADR note; parser, `/plan` template, and
      `/remediate` template all conform (shared fixture test).
- [ ] End-to-end spec: gap → plan append → re-seed → trailer commit → gate passes.
- [ ] Idempotency, content-drift, cross-gate-collision, and empty-id-rejection specs pass.
- [ ] `/remediate` SKILL.md documents the plan-append contract (it currently only writes
      `remediation.json`).

---

## Slice 3 — survivable auto-park

## Story: No evidence after N attempts parks the feature — visibly, durably, never looping

**Requirement:** ADR H2 (park-not-loop), H7 (durable counter), carried #280 reconciliation

As a daemon operator, I want a feature that cannot evidence progress to stop with a visible,
clearable auto-park instead of an infinite HALT/re-kick loop.

### Acceptance Criteria

#### Happy Path
- Given a plan with tasks and N consecutive no-evidence gate misses (counter in the engine
  sidecar), when the daemon evaluates the N+1th time, then it writes an auto-park marker in the
  `park-marker.ts` family with distinct provenance (`auto-parked: no completion evidence after N
  attempts`), emits a logged event, and stops dispatching.
- Given an auto-parked slug, when `rekickSweep` runs on a new base SHA, then the slug is skipped
  (existence-based park check) — the park survives re-kick.
- Given the operator fixes the cause and runs the unpark verb, when the daemon next ticks, then
  the feature resumes and the no-evidence counter is reset.
- Given an empty or missing plan at seed time (daemon mode), when the build step is entered, then
  the same auto-park path fires with reason `empty/missing plan` — never a `'no tasks'` HALT loop.

#### Negative Paths
- Given the N-attempt counter, when the daemon process restarts between attempts (re-kick spawns a
  fresh run), then the count PERSISTS (sidecar) and still reaches N — a per-run in-memory counter
  is a failing implementation (regression spec).
- Given evidence accrues on attempt k < N (completed count rises), when the counter logic runs,
  then the counter resets — a slow-but-progressing feature is never parked.
- Given the auto-park marker body, when the dashboard renders parked slugs, then auto-parks are
  distinguished from operator parks (provenance shown) — an auto-park displayed as "parked by
  operator" is a spec failure.
- Given the park fires, when no event/log line is emitted, then the spec fails — an invisible
  auto-park is a silent strand (the failure Option A was rejected for); the halt-monitor's watched
  surface must include it.
- Given an interactive (non-daemon) run in the same no-evidence state, when the gate misses, then
  the existing stall-REPL/recovery path is used — the auto-park is daemon-layer only, and a spec
  pins that `conduct` interactive behavior is unchanged.

### Done When
- [ ] Daemon-mode spec (daemon:true, isolated repo per the rebase-test convention): N no-evidence
      misses → auto-park marker with auto provenance + emitted event; rekickSweep skips it.
- [ ] Counter persistence across simulated restarts + reset-on-progress specs pass.
- [ ] Dashboard provenance rendering covered (unit level).
- [ ] Interactive-path spec proves no park marker is written when `daemon` is false.

---

## Story: #115 retryReason handoff keeps working

**Requirement:** ADR carried constraint (#115 retained)

As the conductor engine, I want the retryReason plumbing untouched by the ownership inversion so
that gate-miss context still reaches the retried agent.

### Acceptance Criteria

#### Happy Path
- Given a build gate miss with an incomplete-tasks reason, when the step retries, then the retry
  prompt carries the (rewritten, trailer-directed) hint via the existing `pendingRetryHints` →
  `retryReason` path.
- Given a prd-audit kickback with a remediation hint, when build re-enters, then the hint text
  reaches the build dispatch unchanged in mechanism (only wording updated per H6).

#### Negative Paths
- Given the new `'no tasks'`/`'missing'` reasons, when `buildRetryHint` runs, then each produces
  its specific plan-directed hint — not the generic "Finish the work now" (spec per case).
- Given the #115 regression suite, when run against this change, then it passes unmodified in
  mechanism-coverage (assertions on wording updated only where H6 requires).

### Done When
- [ ] Existing #115 specs pass (wording-only updates permitted and called out in the PR).
- [ ] New hint-case specs for `'no tasks'` and `'missing'` pass.
