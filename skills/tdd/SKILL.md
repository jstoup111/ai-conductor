---
name: tdd
disable-model-invocation: true
description: "Use when implementing any feature or bugfix. Five-step cycle: RED → DOMAIN → GREEN → DOMAIN → COMMIT. Enforces test-first development with domain integrity review at every phase boundary."
enforcement: structural
phase: build
standalone: true
requires: []
---

## Purpose

Enforces test-driven development with domain integrity as a first-class concern. Every change
goes through a five-step cycle with implementer isolation — the RED agent only sees tests, the
GREEN agent only sees source, and the DOMAIN reviewer has veto authority over both.

**Host mechanics:** Delegate RED, GREEN, and DOMAIN work through the selected host's available
subagent facility. Claude Code uses its Agent tool and Claude model labels; other supported hosts
use their native equivalents. The host mechanism may differ, but it MUST preserve this cycle's
RED → DOMAIN → GREEN → DOMAIN → COMMIT order, scoped verification, review vetoes, and commit gates.

### Documentation boundary

Do not start a RED/GREEN cycle for ordinary human-facing documentation, and do not add tests that
assert documentation wording, headings, formatting, placement, links, or repository explanations.
Documentation-only requests are delivered from `/explore`. Keep tests for machine-consumed documents
only when they assert generated or runtime behavior (for example OpenAPI contracts or generated
repository-harness functionality), never prose shape.

### Suite-failure repair

When BUILD returns after `test_suite` fails, read the engine's retry diagnostics and
referenced `.pipeline/test-suite-evidence.json`, and include the relevant failure evidence
in RED/GREEN dispatches. Repair and verify the affected tests through
`ai-conductor scoped-run <selectors...>`, then commit. Leave aggregate re-verification to
`test_suite`; a scoped PASS does not establish an aggregate PASS.

### SHIP verdict artifacts are read-only

During BUILD, `.pipeline/prd-audit.json` is the typed PRD verdict authority (ADR D2.2), and
`.pipeline/prd-audit.md` is its derived human report. `.pipeline/architecture-review-as-built.md`,
`.pipeline/architecture-review-as-built.json`, `.pipeline/prd-audit-code-stamp.json`, and
`.pipeline/architecture-review-as-built-code-stamp.json` are read-only SHIP validator evidence.
Never write, delete, rename, or recreate them. Reading `.pipeline/remediation.json` and the cited
verdict artifact remains allowed. Use that read-only evidence when the task needs finding detail.

## Practices

### The Cycle

```
RED → DOMAIN → GREEN → DOMAIN → COMMIT
 │       │        │        │        │
 │       │        │        │        └─ Scoped affected-test union green, clean tree, commit
 │       │        │        └─ Review implementation for domain integrity
 │       │        └─ Implement the smallest behavior-complete change within scope
 │       └─ Review test for primitive obsession, invalid states
 └─ Write ONE failing test, watch it fail
```

### Declared Replication Does Not Change the Cycle

A declared replication's copy task establishes a baseline; it never shortens or changes the
cycle for a later delta task. A task that introduces behavior the source lacks runs the full RED → DOMAIN → GREEN → DOMAIN → COMMIT cycle, with the same scoped verification and review gates,
whether the plan declares replication or not.

`Evidence: satisfied-by <copy-sha>` may close a later task only when the copied commit satisfies
that task's **whole** scope: every acceptance criterion and its required scoped verification. A
copy commit cannot close a task merely because it supplies some of the behavior, and cannot close
a task that introduces behavior absent from the source. Do not split a partly covered task into a
copy-satisfied portion and a delta portion. If whole-task satisfaction is ambiguous, resolve the
ambiguity toward the full cycle.

For a delta task, a first test that passes immediately does not permit implementation. Investigate
whether the test only restates copied behavior or is otherwise wrong;
then write a failing test for the task's uncovered behavior. Only a separate proof that the copy
satisfies the whole task may use the existing `Evidence: satisfied-by` closure.

### No Legitimate RED for Already-Existing Behavior

Plan-declared Verify-only refactor and dependency-upgrade maintenance tasks follow this section;
deletion tasks follow **Removal Boundary**. A maintenance task that changes observable behavior
follows the full RED → GREEN cycle.

This boundary applies only when there is no behavior left to add, change, or fix. It never applies
to a task that adds, changes, or fixes behavior; those tasks run the full RED → DOMAIN → GREEN →
DOMAIN → COMMIT cycle.

For a plan-declared verify-only/verification task, author at most the documenting test explicitly
asked for by the plan. Do not invent unrelated assertions to manufacture a RED result.

If investigation discovers that the behavior already exists but the sealed plan did not declare the
task verify-only/verification, do not author a test that cannot fail. Delete any redundant test
authored during this lap, do not amend the sealed plan, and close the task with the existing
`Evidence: skipped <reason>` empty-commit form in **Commit-less Completions: Evidence Trailers**.

### Removal Boundary

Deleting code starts no RED cycle. For removal-shaped work, follow `/code-removal` for the
absence-test prohibition, survivor method, test triage, and completeness sweep. Maintenance edits
that keep existing tests compiling after a removal (updating imports, dropping dead selectors) are
ordinary edits and need no RED of their own.

### Phase 1: RED

**Agent:** Generator (test-files-only context).
**Goal:** Write exactly one failing test that captures the next behavior.

1. Choose the next acceptance criterion from the plan (or the most obvious next behavior)
2. Write one test for one behavior
3. The agent derives selectors, retains the test under change as an expected failing member,
   and runs the scoped union of affected tests through `ai-conductor scoped-run <selectors...>`
4. Confirm that the test under change fails for the expected reason and every
   other affected test passes
5. Paste the expected failure output

Any unrelated scoped test failure blocks the current RED phase; fix that
failure in a separate commit (`Scope:` trailer for any file outside the task's
Files) before proceeding to DOMAIN. If one of the repository's documented
intermediate fallback triggers makes the affected set genuinely unsafe, name
the exact trigger and reason and defer aggregate proof to the engine's
dedicated aggregate gate. Never run the full suite — or any aggregate
command — inside this session.

**Rules:**
- One test, one behavior; assert every outcome its `Covers:` target names (content, not only a count or call)
- Test must fail for the RIGHT reason (not a syntax error; a missing import of not-yet-written code
  is expected, but COMMIT step 5's stub check still applies)
- Assert production behavior, not source text, a test-local helper or fixture, or a mock's canned return
- Together, the tests for each `Covers:` target must fail against a stub of the code under test
  (constant, empty, or pre-change return); a negative-path test may pass a stub only if you can
  name the sibling test in this change that fails it
- Test name describes the behavior: `test_expired_token_returns_401`, not `test_auth`
- If tech-context loaded: follow stack test conventions (e.g., RSpec `describe`/`context`/`it`)
- **Declare feature coverage with a `Covers:` marker.** Every test file this cycle creates or
  changes carries a `Covers:` comment binding it to the active feature, using the same marker
  contract as `/writing-system-tests`: a criterion in the active stories (`Covers: S<n>.<m>`), a
  task in the active plan (`Covers: task:<id>`), or — product track — a PRD requirement
  (`Covers: FR-N`). Criterion ids are positional — `S<n>.<m>` names the m-th Given/When/Then bullet
  of Story n, happy-path bullets before negative-path ones; story files carry no literal ids.
  Add or update the marker in the current feature diff; an unchanged marker inherited from the
  review base belongs to its earlier feature and is not current-feature authority, even when its
  bare ordinal happens to resolve in the active plan. Markers are resolvable only against the feature's own stories and plan; the
  build_review test-quality rubric scopes itself to changed tests with a resolvable `Covers:`
  binding, so a changed test without one is invisible to that review and the rubric passes
  vacuously. Put the marker directly above the `it`/`describe` it covers; a file-header marker binds
  every test in the file, so use one only in files without test declarations.

**If the test passes immediately:** The behavior already exists. Either the test is wrong
(testing something already implemented) or the criterion is already met. Investigate — don't
move to GREEN.

See `references/red.md` for detailed RED phase guidance.

### Phase 2: DOMAIN (Post-RED)

**Agent:** Domain Reviewer (see `agents/domain-reviewer.md` for full criteria)
**Goal:** Review the test for domain integrity — primitive obsession, invalid states, boundary
violations, domain language, and **adversarial-derivation coverage** (a failing spec per
production call site of any security/correctness derivation, with real adversarial input — see
`/writing-system-tests` §3d). Has veto authority to send back to RED.

> When the task touches a security/correctness derivation (redaction, auth/permission predicate,
> path/identity check, state guard), the dispatcher MUST include the derivation's production
> call-site list (`file:line`) in this reviewer's prompt — the reviewer is told not to scan, so
> without the list it cannot check call-site coverage.

### Phase 3: GREEN

**Agent:** Generator (source-files-only context).
**Goal:** Write the smallest behavior-complete code change that makes the failing test pass and
conforms to the applicable recorded basis.

1. **Scope check BEFORE writing code:**
   - Will this change touch ~20 lines or fewer? → Proceed
   - Will it touch more than 1 file? → Consider drill-down
   - Will it touch more than 1 function? → Consider drill-down
   - If scope check fails → Write a unit test for the smaller piece and run a nested TDD cycle

2. When an applicable recorded basis is present, conform to its relevant semantic traits. A
   verified no-fit or operator-authorized bounded departure follows its documented approach;
   when no applicable basis exists, no pattern conformance is required.
3. Write the smallest behavior-complete code change to pass the test
4. Run the test — **watch it pass**
5. The agent derives the selectors for the affected/scoped test set (the task's own tests + the files this change touches) and runs `ai-conductor scoped-run <selectors...>`. The dedicated pre-SHIP gate and CI own broad verification, not each TDD cycle.

A known failure in that scoped set blocks the current GREEN phase; fix it here,
in a separate commit (`Scope:` trailer for any file outside the task's Files),
rather than deferring it to a later gate. If one of the repository's documented
intermediate fallback triggers makes the affected set genuinely unsafe, name
the exact trigger and defer aggregate proof to the engine's dedicated
aggregate gate. Never run the full suite — or any aggregate command —
inside this session.

**Rules:**
- The smallest behavior-complete change must conform to an applicable recorded basis; a passing
  change that materially departs from that basis without its recorded no-fit or authorized
  departure is incomplete. This does not authorize behavior beyond the failing test.
- Don't implement behavior not required by a failing test.
- Don't fix other things you notice. Note them for a future task. A `Scope:` trailer explains a
  widening; it does not authorize a user-visible behavior change.
- Do not refactor during GREEN; refactoring remains a separate batch-boundary activity.
- If tech-context loaded: follow stack conventions (e.g., Rails model/controller patterns)

**When GREEN won't go green — escalate to debugging, do not thrash.**
If the target test still fails after a bounded attempt (≈2 edits), or step 4 shows the change
broke other tests and the cause is not immediately obvious, STOP editing. A generator guessing
at a non-obvious failure burns tokens and risks masking the bug rather than fixing it. Dispatch
the `/debugging` protocol in a fresh sub-session. In Claude Code, use **`model="opus"** for this
reasoning-heavy root-cause analysis (see the repository's model table); other supported hosts use
their native high-reasoning equivalent. Hand it the failing test, the current
diff, and the full failure output. Return to GREEN only once debugging has produced an
evidence-backed root cause.

See `references/green.md` for detailed GREEN phase guidance.
See `references/drill-down.md` for nested TDD cycle instructions.

### Phase 4: DOMAIN (Post-GREEN)

**Mechanical pre-check (before dispatching the reviewer):** If tech-context defines a type-check
command for a statically-typed stack (e.g. `tsc --noEmit` / `npm run typecheck` for TypeScript),
run it now. A type error returns straight to GREEN — do NOT dispatch the domain reviewer (or
advance to COMMIT) against code that does not type-check. Skip silently for stacks with no compile
step (e.g. Rails — the linter at COMMIT covers static checks there).

**Agent:** Domain Reviewer (see `agents/domain-reviewer.md` for full criteria)
**Goal:** Review the implementation for domain integrity — primitive obsession, leaky
abstractions, missing domain types, naming, and **derivation-reached-at-every-call-site** (every
call site actually routes through the security/correctness derivation, handling real boundary
inputs without failing open or closed). Has veto authority to send back to GREEN.

### Phase 5: COMMIT

**Hard gate — all conditions must be met:**

1. Scoped affected-test set passes (the engine's dedicated aggregate gate and CI own broad verification, not each task)
2. Linter passes (if tech-context specifies one — e.g., `bundle exec standardrb` for Rails)
3. Type-check passes (if tech-context specifies a type-checker — e.g., `tsc --noEmit` /
   `npm run typecheck` for TypeScript). Already run as the Phase 4 pre-check; re-confirm clean here.
4. Working tree is clean (no uncommitted changes outside this task)
5. **Pre-diff sensitivity check** — for every NEW or CHANGED test in this task that claims to
   cover new or changed behavior: create a temporary detached worktree at the base commit (`git worktree add --detach «tmp» «base»`), copy only the new or changed test files into it, run them there, then remove that temporary worktree with `git worktree remove --force «tmp»`.
   Change no worktree's files beyond adding those copies, the temporary one included: never set
   uncommitted work aside, and never discard, roll back or overwrite paths to reach the base
   version. A test that still passes proves nothing
   and will fail build_review's testQuality rubric one expensive lap later. A test that fails there
   only because the new module is missing proves nothing either; apply the stub rule from RED. A value computed by the
   test but never asserted on is an automatic fail of this check. Exempt: tasks under the
   **No Legitimate RED for Already-Existing Behavior** and **Removal Boundary** sections, and
   plan-declared `**Verify-only:** yes` tasks — their evidence forms replace this check.
6. **Commit immediately** — do not defer commits to end of cycle or batch. Connection
   interruptions lose uncommitted work. Commit as soon as GREEN passes and linter is clean.
7. Commit with descriptive message referencing the behavior added
8. **Commit includes Task trailer** — every commit in this cycle (feature, refactor, fixup)
   carries `Task: <id>` with the bare plan header id (`### Task 7:` → `Task: 7`, never
   `Task: task-7`). The commit-msg hook stamps it from `.pipeline/current-task`; confirm it parsed.

9. **Cross-boundary integration proved by its owning task.** When the current task owns a
   cross-boundary integration check under `/plan` §3d, a test (new or existing) must exercise the
   changed behavior through the appropriate project entry point named by that check—for example a
   public API or route, CLI, job or worker, event consumer, framework hook, or application-service
   boundary. A direct helper test alone cannot close that task. Tasks that do not own a changed
   boundary remain at the lowest sufficient test layer; production-file count does not create
   integration-test obligations.

10. **Commit only to the current feature branch — never integrate upstream.** Do NOT run
   `git fetch`, `git pull`, `git rebase`, or switch branches during the cycle. Mid-build
   rebase onto a moved `origin/<default>` rewrites history under active work. The only
   sanctioned rebases run outside this loop.

**After commit:** Return to RED for the next cycle. Stop only when every `Done when:` bullet,
including each enumerated case and negative outcome, has a committed assertion you can cite.

### Commit-less Completions: Evidence Trailers

Not all tasks require code commits. Some tasks verify that existing behavior meets acceptance
criteria, and some have no implementation work (architectural decisions, etc.). Ordinary
documentation maintenance is not a TDD task; `/explore` delivers it directly.
When a task completes without code changes, emit an empty commit with Evidence trailers.

A plan task may carry a `**Verify-only:** yes` marker (see `skills/plan/SKILL.md` §5d)
declaring up front that it is expected to prove existing behavior already satisfies its
acceptance criteria. Such tasks preferably complete via one of the two empty-commit
Evidence forms below — `Evidence: satisfied-by <sha>` when a prior commit already
satisfies the criteria, or `Evidence: skipped <reason>` when there is no applicable
satisfying commit — rather than a code commit.

Evidence forms MUST be emitted as `git commit --allow-empty` with the Evidence trailer in the
commit body; the engine reads commits only, not task reports.

**Form 1: `Evidence: satisfied-by <sha>`**
Use when a task's acceptance criteria are already met by existing code (discovered during
pre-completion scan). Emit a no-op commit carrying the satisfying commit SHA:
```
git commit --allow-empty -m "chore(evidence): task criteria met" \
  -m "Task: 7" \
  -m "Evidence: satisfied-by abc123def456"
```

**Form 2: `Evidence: skipped <reason>`**
Use when a task has no implementation work or is intentionally deferred. Emit a no-op commit
with a concise reason:
```
git commit --allow-empty -m "chore(evidence): task deferred" \
  -m "Task: 12" \
  -m "Evidence: skipped awaiting_stakeholder_input"
```

Each empty commit carries `Task: <id>` plus one Evidence form; the conductor records the task as
completed by verification rather than code delivery.

### Memory Checkpoint (Per-Cycle, Conditional)

After COMMIT, if this TDD cycle revealed any of the following, persist immediately:
- **Category: `gotchas/`** — An unexpected framework/library behavior that caused the test to fail for the wrong reason
- **Category: `patterns/`** — A new pattern established in this cycle that future cycles should follow

Most cycles will NOT trigger a memory write — that is correct. Only persist genuinely surprising discoveries.

### Refactoring

Refactoring never happens during GREEN. It runs at batch boundaries through the `simplify` workflow
(Claude `/simplify`; Codex `$simplify`), in its own commits, and uses simplify's thresholds.

### User-Requested Exit During TDD

If the user explicitly requests to stop, pause, or exit to the harness at any point during
a TDD cycle (RED, GREEN, DOMAIN, or COMMIT), the orchestrator MUST:

1. **Do NOT commit incomplete work.** If the cycle is mid-flight (test written but no code,
   or code written but domain review not passed), do not attempt to force a commit.

2. **Write a halt marker** (`.pipeline/halt-user-input-required`) with a one-line summary
   of the in-flight cycle state (e.g., "user requested exit; RED phase complete, awaiting GREEN").

### Structural Enforcement

When dispatching through the selected host's available subagent facility, give each phase only
the context below — paths and metadata, not file contents. In Claude Code, this applies to Agent
tool dispatches.

| Phase | Agent | Provide in Prompt | Do NOT Provide |
|-------|-------|-------------------|----------------|
| RED | Generator | Task description, acceptance criterion text, test dir path, factory file path | Implementation files, other stories, full plan |
| DOMAIN (post-RED) | Domain Reviewer | New/changed test code (inline), list of existing domain types, **call-site list (`file:line`) for any security/correctness derivation in scope** | Full file tree, `.memory/` files, other test files |
| GREEN | Generator | Failing test output (inline), source dir path, 1-2 specific source files to modify | Test files, stories, plan |
| DOMAIN (post-GREEN) | Domain Reviewer | New/changed implementation code (inline), the test it satisfies (inline), **call-site list (`file:line`) for any security/correctness derivation in scope** | Full file tree, `.memory/` files, other source files |
| COMMIT | (main agent) | Full context | All files |

**Context budget rules:**
- **Provide file paths and metadata, not full contents.** Give subagents file paths, line
  counts, and key method names/signatures. Subagents read files themselves.
- **For domain review: inline the diff only.** Paste the specific new/changed code (the diff)
  into the domain reviewer prompt — this is typically small (<50 lines). Do NOT inline entire files.
- **Name domain types that exist** (e.g., "Domain types: Contact, Tag, ContactTag") so the
  domain reviewer doesn't scan the codebase.
- **One criterion per RED dispatch** — the generator prompt contains exactly the acceptance
  criterion being implemented, not the full story.
- **Cap GREEN file access** — name the 1-2 files to modify, not the full source tree.
- **Pre-gather decisions** — the TDD orchestrator checks `.memory/decisions/` for relevant
  prior decisions and includes them in the domain reviewer prompt. The reviewer does not
  search `.memory/` itself.
- **Reuse host-native implementer sessions for sequential tasks on same files.** When consecutive
tasks modify the same files, continue the existing host-native session instead of spawning a new
one — this preserves the file cache and avoids redundant reads.

This isolation prevents the RED agent from peeking at implementation (biasing the test)
and the GREEN agent from over-engineering beyond what the test requires.

### Domain Reviewer Model Selection

Right-size the model to the diff size to reduce API cost and rate limit pressure:

- **In Claude Code, diffs under 50 lines:** dispatch with `model="sonnet"` — sufficient for focused domain checks
- **In Claude Code, diffs of 50+ lines:** dispatch with `model="opus"` — deep analysis for larger changes
- **Other supported hosts:** select the native equivalent of the same focused versus deep-review
  capability; do not weaken the review boundary or veto authority.

### Orchestrator Output Discipline

Between TDD phases, the orchestrator outputs ONLY:
- The dispatch (silently — no announcement)
- The subagent's structured response
- A one-line status: `RED: FAIL (expected)` / `GREEN: PASS` / `DOMAIN: APPROVED` / `DOMAIN: VETO — [reason]`

No narration, no explanation of what just happened, no preview of what comes next.

### Test Coverage Rule: Behavior and Failure Boundaries

Coverage follows the behavior or failure boundary being added, changed, or fixed — never a
one-to-one correspondence with production files. Choose the lowest sufficient test layer that
proves the criterion. Use acceptance/system coverage only for a distinct multi-step externally
observable flow that cannot be proven sufficiently below it; do not duplicate lower-layer negative
variants or existing sufficient proof.

New behavior and bug fixes still begin with RED. A production-file change alone does not require a
mirror test, and ordinary natural-language guidance does not create behavior to test. A declared
exact replication still follows its full delta cycle and required scoped verification.

## Verification

- [ ] Test written BEFORE implementation and failed for the right reason
- [ ] Domain review ran after RED and after GREEN
- [ ] Scoped affected-test set, linter, and type-check (typed stacks) pass before commit
- [ ] Pre-diff sensitivity check run for every new or changed behavioral test
- [ ] Every new/changed test file carries a resolvable `Covers:` marker for the active feature
- [ ] Any cross-boundary integration check owned by this task is proven through its entry point
- [ ] Working tree clean at commit; one behavior per cycle
