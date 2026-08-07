**Status:** Accepted

# Stories: provider-neutral preventive controls for protected DECIDE artifacts (#1254)

**Track:** technical — acceptance criteria live here; no PRD exists by design.
**Tier:** M
**Design source:** `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` (APPROVED),
`architecture-review-2026-08-07-codex-lacks-preventive-hook-parity-protected-artif` (APPROVED WITH
CONDITIONS — its seven conditions are requirements, mapped below).

> The control-classification inventory (workstream 4) is human-facing documentation and therefore
> carries no story, per the stories skill's documentation boundary. It is a plan task.

---

## Story 1: The commit gate blocks a protected DECIDE artifact regardless of write method

**Condition:** Review conditions 1, 5

As the engine, I want any commit that stages another feature's protected DECIDE artifact to be
refused at the commit, so that the same refusal holds for every provider and every way the file was
written.

### Acceptance Criteria

#### Happy Path
- Given a prepared worktree on a feature whose stem is `feature-a`, when a commit stages
  `.docs/specs/2026-07-04-operator-park.md`, then the commit is refused with a non-zero exit and no
  commit object is created.
- Given the same worktree, when the protected file was written by a shell heredoc rather than an
  editor tool, then the commit is refused identically — the refusal does not depend on how the file
  reached the working tree.
- Given the same worktree, when the protected file was written by `tee`, by `sed -i`, or by an
  inline `python3 -c`/`node -e` interpreter, then the commit is refused identically in each case.
- Given a worktree running under the Codex provider, when a commit stages a protected artifact, then
  it is refused with the same exit status and message as under Claude.
- Given a staged change to `.docs/architecture/`, `.docs/plans/`, or `.docs/stories/` belonging to
  another feature, when the commit runs, then it is refused.

#### Negative Paths
- Given a commit staging **only** source files under `src/`, when the commit runs, then it succeeds —
  the gate does not block ordinary build work.
- Given a commit staging the active feature's **own** protected artifacts (matching `namesOwnFeature`,
  `protected-artifact-seal.ts:508-523`), when the commit runs, then it succeeds.
- Given `CONDUCT_ENGINE_COMMIT=1` in the environment, when the engine commits a protected path during
  rebase mechanics, quarantine, a shipped record, or spec landing, then the commit succeeds — matching
  the existing `commit-msg` convention at `git-hook-assets.ts:140`.
- Given a repository that has its own `pre-commit` hook in `$GIT_COMMON_DIR/hooks/`, when a permitted
  commit runs, then the engine hook chains to it and the repository hook's own non-zero exit still
  refuses the commit — matching the chaining in `PREPARE_COMMIT_MSG_HOOK`/`COMMIT_MSG_HOOK`.
- Given a staged path that cannot be classified (malformed, traversal, outside the workspace), when
  the commit runs, then it is refused fail-closed rather than allowed through.
- Given a commit that stages a **deletion** of another feature's protected artifact, when the commit
  runs, then it is refused — deletion is a mutation.

### Done When
- [ ] `git-hook-assets.ts` exports a `pre-commit` hook asset alongside the two existing assets.
- [ ] `writeGitHooks` (`worktree-prepare.ts:399-416`) writes it to `.pipeline/git-hooks/pre-commit` with mode `0755`.
- [ ] A commit staging another feature's `.docs/specs/*.md` exits non-zero and `git rev-parse HEAD` is unchanged.
- [ ] The five write methods (editor tool, heredoc, `tee`, `sed -i`, inline interpreter) each produce the identical refusal in an executable test.
- [ ] A commit staging only `src/**` succeeds.
- [ ] A commit staging the feature's own artifacts succeeds.
- [ ] A commit with `CONDUCT_ENGINE_COMMIT=1` succeeds.
- [ ] Chaining to a repo-own `pre-commit` is proven by a test where the chained hook refuses.

---

## Story 2: The refusal diagnostic is a tested contract, not just an exit code

**Condition:** Review condition 4

As an agent that has just been refused, I want the message to tell me which artifact I touched, which
DECIDE phase owns it, and where the amendment belongs, so that I route the change correctly instead
of retrying the commit and burning cycles.

### Acceptance Criteria

#### Happy Path
- Given a commit refused for staging `.docs/specs/2026-07-04-operator-park.md`, when the refusal is
  emitted, then the message contains that exact artifact path.
- Given the same refusal, when the message is emitted, then it names the DECIDE phase that owns the
  artifact class.
- Given the same refusal, when the message is emitted, then it states that the amendment must be made
  in DECIDE rather than in BUILD.
- Given a commit staging two protected artifacts, when it is refused, then the message names both,
  not only the first.

#### Negative Paths
- Given a refusal, when the message is emitted, then it does **not** consist solely of a bare exit
  code or an unexplained `error:` line.
- Given a refusal, when the agent retries the identical commit unchanged, then it is refused again
  with the identical message — the gate is deterministic and does not degrade into an allow on retry.
- Given the message is asserted by test, when a future change alters the wording so it no longer names
  the artifact or the phase, then that test fails.

### Done When
- [ ] An executable test asserts the refusal message contains the offending artifact path.
- [ ] An executable test asserts it names the owning DECIDE phase.
- [ ] An executable test asserts it states the DECIDE amendment route.
- [ ] A multi-artifact refusal test asserts every offending path appears.
- [ ] A repeated identical commit produces a byte-identical refusal.

---

## Story 3: Sanctioned in-phase writes are never blocked

**Condition:** Review condition 2

As a step that is allowed to write under `.docs/`, I want my sanctioned writes to commit normally, so
that the new gate does not break the retro and release-waiver flows that legitimately write there.

### Acceptance Criteria

#### Happy Path
- Given the active step's allowlist permits `.docs/retros/`, when a commit stages a file under
  `.docs/retros/`, then it succeeds.
- Given the retro step's allowlist also permits `.docs/stories/` (`phase-marker.ts:63-65`), when the
  retro step commits a stories file, then it succeeds.
- Given `.docs/release-waivers/` is always allowed (`DOCS_WRITE_ALWAYS_ALLOWED`, `phase-marker.ts:71`),
  when a commit stages a release waiver, then it succeeds in any phase.
- Given a DECIDE-phase authoring run outside BUILD/SHIP, when it commits newly authored spec, stories,
  and plan artifacts, then the commit succeeds.

#### Negative Paths
- Given the retro allowlist permits `.docs/stories/`, when a commit **also** stages
  `.docs/specs/<other-feature>.md` in the same commit, then the commit is refused — an allowlisted
  path does not launder a non-allowlisted one in the same change set.
- Given no active phase marker exists, when a commit stages another feature's protected artifact, then
  it is still refused — absence of a marker must not read as permission.
- Given a phase marker whose allowlist is malformed or unreadable, when a commit stages a protected
  artifact, then it is refused fail-closed.

### Done When
- [ ] A commit under `.docs/release-waivers/` succeeds in BUILD and in SHIP.
- [ ] A retro-step commit touching `.docs/retros/` and `.docs/stories/` succeeds.
- [ ] A mixed commit (allowlisted + non-allowlisted protected path) is refused.
- [ ] A commit staging a protected artifact with no phase marker present is refused.
- [ ] A malformed allowlist produces a refusal, not an allow.

---

## Story 4: Hook wiring failure fails the step instead of being skipped

**Condition:** Review conditions 1, 3

As the engine, I want a failure to install or wire the preventive hook to fail the step loudly, so
that a build can never run believing it is protected when it is not.

### Acceptance Criteria

#### Happy Path
- Given a worktree where the hook files write successfully and `core.hooksPath` is set, when
  preparation completes, then the step proceeds and `git config --worktree core.hooksPath` resolves to
  `.pipeline/git-hooks`.

#### Negative Paths
- Given `.pipeline/git-hooks/` cannot be created or written, when worktree preparation runs, then
  preparation fails with an error naming the wiring failure — it does **not** log `git hooks: skipped`
  and continue.
- Given `git config --worktree core.hooksPath` fails, when worktree preparation runs, then preparation
  fails rather than silently proceeding unprotected.
- Given the worktree's `.git` is read-only, when preparation runs, then it fails with a diagnostic
  naming the inaccessible path.
- Given the hook file is written but not executable, when preparation completes, then the failure is
  detected rather than deferred to a commit that silently succeeds.
- Given preparation failed for wiring reasons, when the operator reads the error, then it distinguishes
  "could not install the preventive control" from unrelated preparation errors.

### Done When
- [ ] `writeGitHooksAndWire` (`worktree-prepare.ts:385-396`) no longer swallows errors for the preventive asset.
- [ ] An executable test with an unwritable hooks directory asserts preparation throws.
- [ ] An executable test with a failing `core.hooksPath` config asserts preparation throws.
- [ ] The string `git hooks: skipped` no longer appears on any path that leaves the preventive hook uninstalled.
- [ ] A successful preparation still logs its normal wiring confirmation.

---

## Story 5: An undeclared task naming a protected artifact is rejected as ambiguous

**Condition:** Review conditions 2, 3 — resolution of blocking conflict C1

> **Amended 2026-08-07 by #1254:** this story originally required the scanner to harvest
> protected paths from prose. Conflict-check C1 measured that against the corpus — 92 of 261 plans
> cite another feature's protected artifact in prose, so harvesting would reject ~35% of plans at the
> land gate. The mechanism changed to the ambiguity rule below, which treats a `**Files:**` line as
> the disambiguator. Measured impact: 7 ambiguous tasks out of 3,099 (0.23%), Task 16 among them.

As the land gate, I want a task that names a protected artifact but declares no targets to be
rejected as ambiguous, so that a task directing BUILD to mutate a protected artifact is refused
before any build runs — without rejecting the many plans that merely cite artifacts as context.

### Acceptance Criteria

#### Happy Path
- Given a task with **no** `**Files:**` line whose body names
  `` `.docs/specs/2026-07-04-operator-park.md:37` `` in prose, when the scanner runs, then it reports
  an ambiguity violation for that task.
- Given the isolated Task 16 of `.docs/plans/park-reconciliation-refusal-observability-1114.md` —
  which today exits 0 with `No protected-target violations found` — when the scanner runs after this
  change, then it exits non-zero and names that spec.
- Given the violation message, when it is emitted, then it directs the author to declare `**Files:**`
  to state whether the task targets or merely cites the path.
- Given a task **with** a `**Files:**` line that lists a foreign protected path, when the scanner
  runs, then it reports a target violation — today's behavior, unchanged.
- Given a task naming a target under `.docs/decisions/`, when the scanner runs, then it is covered by
  the same predicate the runtime gate uses.
- Given a path written with a trailing `:NN` line suffix, when the scanner runs, then the suffix does
  not defeat the match.
- Given a task with no `**Files:**` line whose body names a **glob** over a protected directory
  (`.docs/plans/*.md`), when the scanner runs, then it is rejected fail-closed as indeterminate,
  consistent with `canonicalWorkspaceTarget` (`protected-artifact-seal.ts:167-185`).

#### Negative Paths
- Given a task that **declares** `**Files:**` and separately cites a foreign protected artifact in
  prose — a "see also", a precedent, an `## Integration Points` reference — when the scanner runs,
  then **no** violation is reported: the declaration proves the mention is a citation.
- Given a task with no `**Files:**` line and no protected path anywhere in its body, when the scanner
  runs, then no violation is reported — legacy prose-only tasks keep working unchanged.
- Given a task naming the feature's **own** protected artifact (`namesOwnFeature`), when the scanner
  runs, then no violation is reported, whether or not `**Files:**` is present.
- Given prose mentioning a bare ADR stem with no directory or extension, when the scanner runs, then
  no false positive is produced from the unresolvable token.
- Given a section heading that does not open a task (`## Task Dependency Graph`,
  `plan-task-parse.ts:98-108`), when a protected path appears beneath it, then it is not
  mis-attributed to the preceding task.
- Given the change, when the existing suites for all three consumers run — `land-spec.ts:242`,
  `cli.ts:137`, `conductor.ts:9094-9104` — then all three still pass.
- Given the full existing plan corpus, when the scanner runs across it, then exactly the 7 known
  ambiguous tasks are reported and no previously-passing task newly fails.

### Done When
- [ ] `conduct-ts plan-protected-targets` on the isolated Task 16 fixture exits non-zero naming `.docs/specs/2026-07-04-operator-park.md`.
- [ ] A fixture with `**Files:**` declared plus a prose citation of a foreign protected artifact exits zero.
- [ ] A fixture with no `**Files:**` and no protected path exits zero.
- [ ] A `.docs/decisions/` target fixture exits non-zero.
- [ ] A glob-over-protected-directory fixture exits non-zero as indeterminate.
- [ ] The ambiguity message names the path and instructs the author to declare `**Files:**`.
- [ ] A corpus regression test asserts exactly 7 ambiguous tasks across the existing plans — no more, no fewer.
- [ ] All three parser consumers have passing tests.
- [ ] One shared protected-path predicate is used by the scanner, the seal, and the commit hook.

---

## Story 6: Remediation never routes a protected-artifact gap back to BUILD

**Condition:** Review condition 2

As the conductor, I want a remediation gap that requires changing a protected DECIDE artifact to be
routed to `plan`, so that the fix is never sent to the one phase whose seal rejects it.

### Acceptance Criteria

#### Happy Path
- Given a remediation gap with disposition `build` whose protected target appears only in
  `gap.rationale` and not in any task title, when the plan is read, then the disposition is rewritten
  to `plan`.
- Given the same gap, when the redirect occurs, then the gap is excluded from the plan-task append,
  matching the existing behavior at `conductor.ts:2390-2399`.
- Given a gap with disposition `acceptance_specs` whose protected target appears only in the rationale,
  when the plan is read, then it is likewise redirected to `plan`.
- Given a gap naming a protected target in a task title (today's covered case), when the plan is read,
  then it continues to be redirected as it is now.

#### Negative Paths
- Given a gap with disposition `build` whose rationale merely mentions a protected artifact as context
  and whose tasks target only source files, when the plan is read, then it is **not** redirected — the
  rationale scan must not over-trigger on incidental references.
- Given a gap whose rationale names the active feature's own artifact, when the plan is read, then it
  is not redirected.
- Given a gap with no rationale field at all, when the plan is read, then it is handled without error.
- Given the redirect fires, when the operator reads the daemon log, then the reason names the gap and
  the protected artifact that caused the reroute.

### Done When
- [ ] A rationale-only protected reference with disposition `build` is redirected to `plan` in an executable test.
- [ ] A rationale-only incidental mention with source-file tasks is **not** redirected.
- [ ] A missing/empty rationale is handled without throwing.
- [ ] Existing title-based redirect tests still pass.
- [ ] The redirect emits a log line naming the gap id and the artifact.

---

## Traceability

| Review condition | Covered by |
|---|---|
| 1 — wiring fails closed | Story 4 |
| 2 — one shared protected-path predicate incl. `.docs/decisions` | Stories 3, 5, 6 |
| 3 — negative-path coverage for parser widening | Story 5 (negative paths) |
| 4 — block diagnostic is contract | Story 2 |
| 5 — `CONDUCT_ENGINE_COMMIT=1` honored | Story 1 (negative paths) |
| 6 — real `## Migration` block | plan task (not a behavior story) |
| 7 — inventory records known-inactive controls | plan task (documentation) |
