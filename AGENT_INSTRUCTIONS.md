# ai-conductor — Custom Development Harness

A development harness with skills and agent personas for AI-assisted software development.
Originally built on Claude Code; the shared repository contract applies to every supported host.

## Behavioral Rules

All behavioral rules for projects using this harness — SDLC phases, model selection,
communication protocol, enforcement levels, and conventions — are defined in:

**[HARNESS.md](HARNESS.md)**

The active host agent MUST read and follow HARNESS.md at the start of every session.

## Design Principles

**Machinery by default; judgement where the question is a judgement call.** When designing
any fix or feature for this harness, first ask: can the engine, a git hook, a gate, or
plain code do this mechanically? If yes, prefer that — deterministic enforcement is
instant, token-free, and fails at the point of violation, while prompt-level rules drift
under long builds and cost operator interventions. Never rely on prompt discipline for
something machinery can genuinely enforce or compute; when an agent repeatedly violates a
mechanical invariant, the fix is machinery that stamps/validates/rejects at the moment of
the mistake, not a stronger prompt. (Precedents: #426 fixed path matching engine-side;
#433 replaced trailer discipline with engine-stamped task ids and commit hooks; `Task:`
trailers are telemetry only (#773).)

This is a default, **not a hard rule**. Some questions are inherently judgement calls —
"is this done?", "is this the same finding as last round?", "does this diff deliver the
plan?" — and forcing them through rigid mechanical shapes (boolean rubrics, exact-match
identity, fixed routing) produces its own failure class: the mechanism cannot recognize
resolution, so the same substance is re-litigated forever. `build_review` cycling is the
canonical example — rubric machinery re-raising equivalent findings under drifted ids
because equivalence is a judgement the machinery was built to avoid making. Signs you have
over-mechanized: the mechanism needs an ever-growing exception list; operators routinely
override or park to get past it; the "deterministic" check delegates its hard core to
string matching on LLM output. In those cases the right design is machinery for the
bookkeeping (scoping the inputs, bounding retries, persisting verdicts) with an LLM
judgement at the point where the question actually requires one — and the judgement's
output constrained by schema, not re-derived mechanically.

**Extend the existing event spine; never add a parallel channel.** This repository has one
telemetry spine — `ConductorEventEmitter` → the `ConductorEvent` union → `EventPersister` →
`.pipeline/events.jsonl` — and every consumer reads it, so a second channel for a concern the
spine already carries is invisible to all of them. Before designing any new way to observe,
report, or coordinate something — a watcher, a poller, a sidecar file, an ad-hoc log, a
timestamp stamped into an artifact — the active host agent MUST read and follow
[`.agents/skills/event-spine/SKILL.md`](.agents/skills/event-spine/SKILL.md), which carries the
decision procedure, the schema-not-file test, and the only three exceptions.

## Daemon Operations Safety (Operator / Agent)

When operating a running daemon — parking, cleaning up, resuming, or "finishing"
features — these rules are MANDATORY. Each encodes a failure that has already
happened and corrupted daemon state:

1. **Never bulk-delete worktrees or branches.** Do NOT `rm -rf` over a globbed or
   computed set (`for d in .worktrees/*`) and never loop-delete branches. Scope every
   destructive delete to an EXPLICIT, enumerated list of named paths; print the list and
   confirm it before deleting. Shell trap: `mapfile`/`readarray` are bash-only and
   silently do nothing under zsh — never guard a delete with an array you have not proven
   is populated. (A guard that came back empty once deleted all 74 worktrees instead of 4.)

2. **Park before you touch a feature's git state.** The daemon re-dispatches anything in
   its backlog and re-creates branches you delete, and its resume path re-kicks git errors
   with no backoff (#681). ALWAYS `conduct daemon park <slug>` BEFORE removing a feature's
   worktree or branch. Never unpark-then-delete — that guarantees a 128 `git worktree add`
   spin.

3. **The branch is the source of truth; a worktree checkout is disposable.** Removing
   `.worktrees/<slug>` loses the per-worktree `.pipeline/` state (task-status + the
   evidence sidecar), which then causes false `no_task_progress` stalls on already-committed
   work (#497). Recreate a worktree from its branch and recover the lost evidence — do not
   let the build redo finished tasks.

4. **A manual PR is NOT a harness finish.** Opening a PR by hand does not tell the daemon
   the work shipped, so it re-dispatches the feature forever (#438) and the only stopgap is
   parking — a leak, not a finish. The finish is `conduct shipped-record --slug <slug> --pr
   <url>`, which commits `.docs/shipped/<slug>.md` so the merge atomically records the ship
   and `daemon-backlog.ts` dedups it. If you complete work manually, you MUST also land its
   shipped-record.

5. **Do not create or rewrite files in the LIVE root checkout while a self-host build is
   running unless the dispatch is proven contained.** The self-host live boundary fingerprints
   the root checkout before a build and re-verifies it at the next dispatch boundary. A
   proven-contained dispatch runs with that checkout read-only while its feature worktree stays
   writable. Its own writes therefore cannot be the root-checkout drift, so an operator change
   there does not halt that dispatch. This has already happened: on 2026-08-04 the
   `mechanically-verify-llm-rebase-conflict-resolution` build halted immediately after
   `build_review` passed (18 turns, 2m19s, $2.29, all wasted) because an interactive operator
   session granted a Bash permission, writing the root checkout's untracked
   `.claude/settings.local.json`:

   ```text
   ✋ loop halted: live checkout changed during self-host execution —
     0 added, 0 removed, 1 changed: changed .claude/settings.local.json.
   ```

   **Safe while a proven-contained dispatch runs.** Read-only commands (`git
   status`/`log`/`diff`, `conduct daemon status`, tailing `.daemon/daemon.log`), any change
   under an excluded path (`.git/`, `.daemon/`, `.worktrees/`, `.pipeline/`,
   `.claude/worktrees/`, `src/conductor/dist-versions/`, or any `node_modules/` tree), and
   operator changes to the root checkout. The guard still protects unrelated provider state.

   **Containment unproven: unsafe.** Containment is unproven when it is disabled, `bwrap` is
   unavailable, or its two-sided probe cannot establish both a read-only live checkout and a
   writable worktree. Then the existing fail-closed rule applies: an untracked path appearing,
   changing, or disappearing (for example Claude Code's untracked
   `.claude/settings.local.json`; Codex operator config lives in `$CODEX_HOME` and trips the
   provider-state surface), `git add` of a new file, or a git operation that rewrites tracked
   content without leaving it modified (`git pull`, `git checkout`, `git stash`) halts the
   run. The halt names why containment was not in force. Batch that work between dispatches, or
   do it inside a worktree.

   Do NOT "fix" this by widening the exclusion list.
   `src/conductor/src/engine/self-host/live-boundary.ts` keeps operator config fingerprinted
   deliberately: a self-host process reaching back and rewriting operator config is exactly
   what this surface exists to catch, and the false halt is the accepted cost. **Recovery:**
   revert or keep whatever changed, then clear the halt with `rm -f
   .worktrees/<slug>/.pipeline/HALT .worktrees/<slug>/.pipeline/HALT.class` and let the
   daemon re-dispatch — see
   [stalled or stuck feature](docs/runbooks/stalled-or-stuck-feature.md#live-boundary-violation-self-host-only).
   The completed step keeps its own verdict, so the re-kick resumes after it rather than
   repeating it. Issue #1301 tracks the durable fix — attribution machinery that can tell an
   operator edit from a self-host write instead of failing closed on both.

Per this repo's own Design Principle, the durable fix for each of these is machinery
(a guarded delete wrapper, a park-state check, an evidence-backfill on worktree recreate,
a merge→shipped-record reconciler, live-checkout change attribution) — these prose rules are
the interim guard until that machinery exists.

## Repository Authoring

### Scope Decisions

Before authoring any change to this repository, and before creating any new skill, the active host
agent MUST read and follow [`.agents/skills/scope-check/SKILL.md`](.agents/skills/scope-check/SKILL.md).
It runs three questions through a deterministic procedure: whether the change is harness-repo-only or
consumer-facing (`AGENT_INSTRUCTIONS.md` versus `HARNESS.md`), whether a new skill belongs in the
shipped `skills/` catalog or this repository's local `.agents/skills/` one, and whether the change is
provider-agnostic. This is repository-local authoring guidance. For consumer projects, which have a
single skill catalog and no consumers of their own, the global harness authoring convention remains
unchanged.

**Its verdict is an input, not the decision.** Running it stays mandatory; treating its answer as
authoritative is not. On repo-only versus consumer-facing, the deciding test is whether **the
mechanism the change describes exists outside this repository** — if it does not, the change is
repo-only no matter how broadly its lesson generalizes. When the verdict and the plain reading of the
operator's request disagree, surface the conflict before landing and follow the request; never take
the tool's answer silently. (Precedent: the event-spine principle above is repo-only because no
consumer project has that bus, yet scope-check's general-benefit reading returned "consumer-facing"
and the rule was landed in `HARNESS.md` and the shipped `skills/` catalog over a correct contrary
steer.)

### Skill Deletions Ship as Two Features

A change whose deliverable includes **deleting a skill directory** — or any directory of
production files — MUST be split into two features, landed in order:

1. **Mechanical cleanup.** Remove every reference to the skill: callers, tests, config keys,
   contract entries, model-table rows, symlink targets, and documentation mentions. The skill
   directory itself stays on disk and unreferenced. This feature's diff edits files; it deletes
   no directory.
2. **Removal.** Delete the now-unreferenced directory, and nothing else.

Do NOT combine them, and do not treat "the deletion is only a few files" as grounds to skip the
split — the split is about what the diff does, not how large it is.

**Why.** `build_review`'s testQuality preflight materializes a counterfactual checkout of HEAD and
restores merge-base content for every changed production file, to prove the changed tests actually
fail against pre-change code. When one diff both deletes a directory and rewrites the tests that
referenced it, that restore writes into a directory that does not exist at HEAD, the preflight dies
as `materialization-failed`, and the feature burns its entire three-fault mechanical allowance and
halts `needs-human`. The only recovery the halt documents is a permanent testQuality coverage
waiver. Splitting the work keeps every diff materializable, and keeps the deletion reviewable on
its own. (First hit by `remove-retrospectives-full-and-micro-from-feature-`, which deleted
`skills/retro/`; engine defect tracked as #1961.)

The `code-removal` skill governs how each of those features is executed. This rule governs how the
work is divided before that skill is reached.

Per this repo's Design Principle the durable fix is machinery — the preflight should create the
parent directory it is restoring into — so this rule is the interim guard, not the endpoint.

## Validation Rules (This Repo)

Follow the test-execution ownership in `HARNESS.md`. During managed runs, `test_suite`
owns aggregate tests and the self-host release gate owns `test/test_harness_integrity.sh`.
Other steps consume their evidence; editing a file or completing a step does not trigger
another suite run. Run only targeted checks needed for changed behavior or a concrete defect.
Missing or failed aggregate evidence returns to its owning gate.

For an operator-requested hotfix outside the lifecycle, run `test/test_harness_integrity.sh`
once on the completed change, plus checks appropriate to changed executable behavior.
Prose-only edits need no new behavioral tests. Check affected links and instruction consistency.

### Test Authoring Rules

The active host agent adding, changing, reviewing, or debugging tests in this repository MUST
read and follow [`.agents/skills/write-tests/SKILL.md`](.agents/skills/write-tests/SKILL.md). This is
repository-local test-design guidance; it complements the provider-neutral `tdd` skill, which
controls implementation order.

### Test Process Isolation

Tests of process guards MUST remain safe when the guard is absent or restored to its
pre-change implementation by test-quality review. Mock the process boundary and verify
that the production adapter reaches the mock before exercising destructive arguments;
assert that refused calls never reach that boundary. A configured mock alone is not
proof of isolation: imports cached by test setup can retain the real implementation.

New or changed real-tmux fixtures MUST use a fixture-owned private socket for every
command, including discovery and teardown. Never rely on session names, the ambient
`TMUX` environment, or a production kill-switch to isolate a test from operator sessions.
Use a mocked adapter until private-socket isolation is available. This is repository-local
test-authoring policy; consumer projects do not inherit this repository's fixture machinery.

The integrity check catalog and troubleshooting belong in
[validation reference](docs/contributing/validation.md).

## Worktree Policy

All work MUST happen in an isolated git worktree on a feature branch. Create the worktree
and branch before making changes; switching branches in the primary checkout is not sufficient.
Never commit directly to main. Open a PR to merge.

## Release & Update Gates

Implementation branches never write `CHANGELOG.md` or `VERSION`. A bot-owned release
PR is the sole writer of both, maintained by a serialized GitHub Actions workflow from
merged implementation-PR metadata. See [docs/contributing/releases.md](docs/contributing/releases.md)
for the full mechanism.

1. **Every PR declares a release disposition.** `.github/pull_request_template.md`'s
   **Release metadata** section carries the contract. The default,
   `Release-Disposition: no-note`, covers non-notable, specification-only,
   documentation-only, and no-implementation changes. A notable reader-visible
   implementation change replaces it with:
   ```
   Release-Disposition: note
   Release-Category: Added
   Release-Semver: patch
   Release-Note: Reader-facing summary of the delivered change.
   ```
   Category is one of Added, Changed, Deprecated, Removed, Fixed, Security. Semver is
   one of major, minor, patch. A required check validates the disposition on every PR
   open/update and fails closed on missing, malformed, or contradictory metadata.

   This rule applies to this repository only. For consumer projects without this
   custom-step configuration, the global harness release convention remains unchanged.

2. **Migration blocks for breaking changes travel in the PR body, not `CHANGELOG.md`.**
   Any PR that changes `settings.json` schema, hook wiring, skill symlink targets, or
   `bin/conduct` CLI MUST include a runnable ```` ```bash migration ```` fence inside a
   `## Migration` section of the PR body (the same section the release-metadata parser
   reads). `bin/migrate` will execute these blocks (after user approval) when consumers
   update past the release that carries them.

   **Waiver (self-host builds only, adr-2026-07-06-migration-gate-waiver).**
   When the self-host release gate's path-based classifier flags a breaking
   surface but the actual edit is internal-only (e.g. deleting a private
   helper, no consumer-visible CLI/hook/schema change), a migration block is
   not the right fix — commit a waiver instead of inventing an empty one.
   Add a file under `.docs/release-waivers/<plan-stem>.md` in the SAME diff as:
   ```
   Waives: <comma-separated canonical surface names>

   Rationale: <non-empty prose — why this is internal-only>
   ```
   Canonical surface names are exactly: `bin/conduct CLI`, `skill symlink
   targets`, `hook wiring`, `settings.json schema` (must match
   `CANONICAL_BREAKING_SURFACES` in `release-gate.ts` verbatim — an unknown
   name is treated as malformed, never silently accepted). The waiver must
   list every touched surface (partial coverage HALTs naming the gap) and
   must be part of the `base...HEAD` diff — a waiver merged by a prior
   feature never satisfies a later one (fail-closed freshness). An
   undeterminable change set (null diff) can never be waived. Do NOT use a
   waiver when the edit changes actual CLI/hook/schema *behavior* — that
   always needs a real migration block.

Release automation and semver reference: [Repository Release Mechanics](ARCHITECTURE.md#repository-release-mechanics).
