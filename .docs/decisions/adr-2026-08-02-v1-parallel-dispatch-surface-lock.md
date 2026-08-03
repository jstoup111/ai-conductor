# ADR: v1 surface lock for parallel task-stream dispatch

**Date:** 2026-08-02
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session
**Feature:** #552 (lock #474's breaking surfaces before v1)
**Locks:** #474 (parallel task-stream dispatch — implementation deferred post-v1)
**Related:** #531 (parallel-safe attribution, blocks #474's build) · #469/#922 (validation
step-group seam, shipped) · #228 Wave B (one-way doors) · #226 (v1.0 cutover PR)
**Amends:** `adr-2026-07-10-session-hook-task-stamping` (records its as-built divergence; see
[Amendment](#amendment-to-adr-2026-07-10-session-hook-task-stamping))

## Context

#474 is the roadmap's main breaking-change candidate. Its implementation is deferred past
v1.0, but the surfaces it touches are frozen by the v1.0 tag. If any of those surfaces ships
in a shape parallel dispatch cannot use, the post-v1 implementation becomes a MAJOR bump with
a migration block — the outcome #228 Wave B exists to prevent.

This ADR enumerates every consumer-visible surface #474 must touch and pins each one's v1
shape. Discovery mapped each surface in the tree at `a57e7221b`; every claim below carries a
file:line anchor.

Three discovery findings reshaped the decision:

1. **Per-task file sets are already parsed.** `parsePlanTaskPaths` (`plan-task-parse.ts:70-239`)
   already produces `Map<taskId, Set<path>>` from the `/plan` template's
   `**Files likely touched:**` block, and four consumers already use it. #474's proposal
   treats this as work to be done; it is not.
2. **Dependency edges are not parsed at all.** `planHasDependencyTree`
   (`artifacts.ts:3016-3022`) only tests whether the *string* `**Dependencies:**` or a
   `## Task Dependency Graph` heading appears anywhere in the file. No code anywhere in
   `src/` extracts the value. #474's "detection is mechanical: dependency edges + file
   intersections" has half its inputs missing, and the missing half is the one whose
   grammar is unpinned and therefore free to drift until it is locked.
3. **#474's attribution premise is false today.** Its proposal states "composes with the
   engine-stamped task ids (#452): concurrent commits stay attributable." In HEAD nothing in
   the automated build loop writes `.pipeline/current-task` — the overlap guard specified by
   `adr-2026-07-10-session-hook-task-stamping.md:47-56` was deleted by `ce1c1cf17` and
   `POST_DISPATCH_HOOK` by `e7af1ea4b`. Its only producer is `runTaskStart`
   (`task-cli.ts:84-159`), an operator/recovery CLI. This corroborates #531's live evidence.

## Decision

**Pin each surface into one of three states, and enforce every pin with a test in v1.**

- **FROZEN** — the v1 shape is final. #474 works around it; it never changes.
- **WIDENED** — v1 ships an additive, forward-tolerant shape that #474 populates later.
- **RESERVED** — v1 accepts a name or path and ignores it, so a later engine can honor it
  without a hard load failure on a mixed-version consumer.

A pin that exists only as prose in this file is not a pin. Per this repository's Design
Principle, every entry below lands in v1 with a test that fails if the shape moves. That is
the difference between this ADR and `adr-2026-07-10-session-hook-task-stamping`, whose
central mechanism was deleted without any test noticing (§7).

### The surface table

| # | Surface | Anchor | v1 pin | Why |
| --- | --- | --- | --- | --- |
| S1 | `.pipeline/current-task` file format | `task-cli.ts:153`; pinned `task-cli.test.ts:159-180` | **FROZEN** — bare scalar id, no trailing newline, no wrapper. Semantics tightened to **unique-or-absent**: present iff exactly one task is in flight; absent whenever zero or ≥2 are. | Two *shipped operator hooks* read it (`lint-after-edit.sh:66-67` as a batch-boundary token) or derive commit trailers from it (`prepare-commit-msg`, `git-hook-assets.ts:41-58`). Absence is already every reader's abstain path, so "absent under parallelism" needs no reader change at all. |
| S2 | `.pipeline/lanes/` | does not exist | **RESERVED** — engine-owned subtree for per-lane state; v1 writes nothing there and no v1 reader looks. | Gives #474 somewhere to put per-lane current-task without touching S1. |
| S3 | Synthetic state-key grammar `<step>__<branch>` | `conductor.ts:3279`; `types/config.ts:42-57, 165-171` | **FROZEN** grammar, and **branch names validated in v1** to `[A-Za-z0-9.-]+` (no `__`, no empty). | The grammar is already shipped and written into `conduct-state.json`, which operators read. #474's streams reuse it as `build__<stream>`. Today `ParallelBranch.name` has no charset check, so a name containing `__` would make the key permanently ambiguous to parse. See [Escalation](#escalation-the-one-breaking-in-v1-tightening) — this is the one breaking-in-v1 item. |
| S4 | `task-status.json` row shape | `task-seed.ts:13-24` | **WIDENED** by tolerance, already sufficient. Rows are per-task and both interfaces carry `[key: string]: unknown`, so #474 may add per-row lane fields additively. `plan_ref` and root `total` stay per-file scalars. | Old readers ignore unknown keys by construction. Pinned by a test asserting an unknown row field survives a seed round-trip. |
| S5 | Build-progress telemetry | `build-progress-watcher.ts:120-124`; `events.ts:296-297, 317`; `span-manager.ts:185, 202` | **WIDENED** — add optional `currentTaskIds?: string[]`; keep `currentTaskId` scalar forever, redefined as unique-or-absent (today: *first `in_progress` row wins*, which under parallelism reports an arbitrary id). | The scalar flows into the event stream, the renderer, the daemon dashboard and OTEL span attributes — all consumer-visible. Changing its type post-v1 breaks every consumer; adding the plural now breaks none. The redefinition removes a value that is already wrong. |
| S6 | `task-evidence.json` | `task-evidence.ts:61-67` | **FROZEN** shape. `evidenceStamps` is already per-task-keyed. `noEvidenceAttempts`, `noEvidenceReasons[]`, `lastResolvedCount` stay **build-scoped scalars** and are never widened per lane; their read-modify-write (`task-evidence.ts:181-204`) becomes single-writer in v1. | These count build-level facts, not task-level ones. Fixing the lost-update race in v1 makes #474's change here purely internal. |
| S7 | `.pipeline/dispatch-count` line grammar | `session-hook-assets.ts:63-70`; reader `attribution-telemetry.ts:35-59` | **FROZEN** — exactly `Task: <id>` or `Task: none`, one line per dispatch. | The reader takes *everything* after `Task: ` as the id, so appending a correlation field in place would silently corrupt every id. Widening must go elsewhere (S8). |
| S8 | `.pipeline/dispatch-log.jsonl` | does not exist | **RESERVED** — additive per-dispatch correlation record. `tool_use_id` from the host hook payload is the **lane identity**; `session_id` identifies the host session. | Both fields are verified present in captured payload fixtures (`test/fixtures/session-hook-payloads/pre-dispatch-task-id.json:1-14`), and no shipped hook reads either — so adopting them later changes no existing behavior. |
| S9 | `.pipeline/phase-active` | `phase-marker.ts:36-56`; consumer `hooks/claude/docs-guard.sh` | **FROZEN** — one file per worktree, line-oriented, and its `allow:` prefixes are a **union across all lanes**. Never lane-scoped. | This is the load-bearing decision for the release gate. `docs-guard.sh` lives under `hooks/`, which is the one path prefix that trips the `hook wiring` breaking surface (`release-gate.ts:163`). Keeping the file worktree-global keeps that hook byte-for-byte unchanged post-v1. |
| S10 | `**Dependencies:**` value | `artifacts.ts:3016-3022` (presence only) | **WIDENED** — grammar pinned to `none \| Task <id>[, Task <id>]*` (what the `/plan` template already emits), with a v1 parser whose **unparseable case degrades to "depends on every prior task"**, i.e. fully sequential. A non-blocking plan lint warns authors. | #474 cannot compute streams without edges. Pinning the grammar in v1 with a fail-safe means no already-merged plan can ever break: the worst case is that it does not parallelize. |
| S11 | `**Files likely touched:**` veto rule | `plan-task-parse.ts:34, 70-239` | **FROZEN** — the existing parser is the veto input. A task with an **empty** declared file set is treated as overlapping everything (sequential). | Avoids ever having to make the field mandatory, which would break existing plans. Fail-safe in the same direction as S10. |
| S12 | `validation_concurrency` | `config.ts:283-284, 744-750, 1972-1995` | **FROZEN** — never renamed, meaning unchanged (caps all group and branch fan-out). | It already caps three different things and is already a misnomer at v1. Renaming post-v1 is a hard load failure (`config.ts:316-320`) for every config that sets it — the worst class of break. Living with the name is strictly cheaper. |
| S13 | `build_concurrency` | does not exist | **RESERVED** in v1's `knownTopLevelKeys`: type-validated as a number, no consumer. | Unknown top-level keys are a **hard load error**, not a warning. Without reservation, a consumer who sets the key for a v1.x engine gets a total config-load failure on any v1.0 engine still installed — turning a nominally additive change into an operational break across worktrees. |
| S14 | `conduct-ts task start\|done <id>` | `task-cli.ts:20-37, 84-203` | **FROZEN** — verbs, id charset `[A-Za-z0-9._-]+`, exit codes, and `done`'s refusal to clear a stamp holding a different id (`task-cli.ts:189-192`). | Documented CLI surface (`docs/reference/cli.md:459-478`) and a canonical breaking surface. #474 adds no verb; per-lane operations, if ever needed, take a new subcommand. |

### Engine-internal, explicitly NOT pinned

These would contend under N concurrent build lanes but are invisible to consumers, so #474 may
change them freely: the shared `DefaultStepRunner` mutable counters (`step-runners.ts:354-398`),
`process.env.CONDUCT_DAEMON_AUTO_FINISH` (`step-runners.ts:492-501`), the single-slot
`retainedFullSuiteFailure` / `fullSuiteVerifier` (`conductor.ts:1064-1068`), the step-heartbeat
record (`step-heartbeat.ts:38-47`), and the group join's literal `if (builtinGroup.name === ...)`
policy chains (`conductor.ts:3290, 3516`). Recording them here is deliberate: it is the evidence
that they were considered and found not to be interface decisions.

## Options Considered

### Option A: Prose-only ADR — enumerate and pin, ship no code in v1

Write the surface table, merge it, and let #474 honor it post-v1.

**Pros:** Smallest possible v1 diff; matches the narrowest reading of #552 ("a merged spec").

**Cons:** Nothing enforces the pins for the months between the tag and #474's build. This
repository has direct evidence that this fails: `adr-2026-07-10-session-hook-task-stamping`
pinned an overlap guard, the guard was deleted in an unrelated refactor (`ce1c1cf17`), and no
test and no reviewer noticed — the ADR still reads as current. Worse, S3, S10 and S13 are not
merely descriptive: each requires v1 code (a charset validator, a fail-safe parser, an
allow-list entry) or the pin is simply false at the tag. **Rejected** — it contradicts this
repository's stated Design Principle and would leave three pins unbacked.

### Option B: Implement #474 in v1

Ship parallel dispatch before the tag so there is no forward-compatibility problem.

**Pros:** No interface lock needed at all.

**Cons:** #474 is `size: L`, is blocked by #531 (parallel-safe attribution, itself unsolved
and lacking a verified mechanism), and #228 explicitly defers it to 1.x. Pulling an L-tier
concurrency feature into a cutover that is already gated on four waves of correctness work
inverts the risk the cutover is trying to reduce. **Rejected.**

### Option C (chosen): Pin the surfaces and ship only the enforcement in v1

Enumerate every surface, pin each FROZEN / WIDENED / RESERVED, and land in v1 exactly the
code that makes each pin true and self-defending: charset validation (S3), the tolerant
round-trip test (S4), the plural telemetry field and the scalar's corrected definition (S5),
the single-writer counter fix (S6), grammar-freezing tests (S1, S7, S9), the fail-safe
dependency parser and lint (S10, S11), and the reserved config key (S13).

**Pros:** Every pin is defended by a failing test the moment someone moves it. Each item is
independently useful in v1 on its own merits — S5 removes a telemetry value that is already
wrong, S6 fixes a live lost-update race, S10 gives plan authors a lint they lack today. #474
post-v1 becomes additive: new files under reserved paths, new optional fields, one new config
key, and zero changes under `hooks/`.

**Cons:** A real v1 diff (~9 tasks) during a cutover freeze, and one deliberate
breaking-in-v1 tightening (§6). Both are bounded and are the point of a Wave B one-way door
([Escalation](#escalation-the-one-breaking-in-v1-tightening)).

## Consequences

- Post-v1, #474's implementation touches no path under `hooks/`, no `settings.json`, no
  `bin/conduct`, and no `bin/install` — so it trips **no** entry in
  `CANONICAL_BREAKING_SURFACES` (`release-gate.ts:139-144`) and needs neither a migration
  block nor a waiver. That is the operational statement of #552's desired outcome.
- The release gate's classifier is path-based, not semantic (`release-gate.ts:153-169`).
  These pins are therefore not enforced by that gate — which is exactly why they are
  enforced by tests instead.
- **Named post-v1 precondition for #474.** The plan-scope containment gate specified by
  `adr-2026-08-02-plan-scope-containment-at-commit-boundary` (#1227, spec PR #1262) refuses a
  BUILD commit whose staged paths fall outside the *stamped* task's declared files, and
  abstains fail-open when no `Task:` trailer is present. Under S1, the stamp is absent
  whenever ≥2 lanes are in flight — so that gate abstains on every commit made during
  parallel execution. It does not break; it evaporates, precisely when the most work is in
  flight. #474 must restore a per-commit task id from the lane-scoped state reserved by S2
  and S8 **before** parallel dispatch is enabled, or it silently regresses a shipped
  correctness gate. This is the strongest single argument for reserving those two paths now
  rather than inventing them later.
- #474 remains blocked by #531. This ADR pins *where* per-lane attribution may live (S2, S8)
  and what may not move (S1, S7); it does not choose #531's mechanism, and must not.
- `skills/pipeline/SKILL.md:52-66, 83, 103` documents removed `current-task` behavior. Only
  the part that states S1's contract is corrected here; the remainder is #531's to fix.

## Escalation: the one breaking-in-v1 tightening

#552's negative path requires that a surface which cannot be made forward-compatible ships
its breaking form **in** v1, escalated before the cutover rather than after. Exactly one
surface qualifies.

**S3 — `ParallelBranch.name` charset validation.** Today the name is unvalidated
(`types/config.ts:42-57`; the `steps.<n>` allow-list accepts `parallel` at `config.ts:392`
with no per-branch name check) and is concatenated into the synthetic state key as
`<step>__<branch>` (`conductor.ts:7314`). A branch named `a__b` produces the key
`build__a__b`, which cannot be unambiguously split back into step and branch. Once #474
generates stream names dynamically and anything parses those keys, the ambiguity is
permanent and unfixable without a MAJOR bump.

The fix is to reject a branch name outside `[A-Za-z0-9.-]+` at config load. That is a
**validation tightening**: a config which loads today would fail to load afterward. It must
therefore ship in v1.

Blast radius, and why this is the cheap moment:

- `steps.<name>.parallel` appears in **no** shipped template — it is absent from
  `templates/ai-conductor-config.yml.template` entirely — and is documented only in
  `docs/reference/configuration.md:306`.
- It is not set in this repository's own `.ai-conductor/config.yml`.
- Any name that would newly fail is one that already produces an ambiguous state key, i.e.
  already broken in a way no consumer can be relying on deliberately.

Required of the v1 build: a `CHANGELOG.md` entry under `[Unreleased]` naming the tightening.
It does not require a `## Migration` block — the classifier trips no canonical surface for a
`src/` edit — but the entry is what makes the one-way door visible to the operator at the
cutover, which is what #552 asks for.

**Operator escalation:** this is the only item in this ADR that changes behavior for an
existing valid config. It is called out here, before #226 merges, per #552's negative path.

## Amendment to `adr-2026-07-10-session-hook-task-stamping`

That ADR's Decision items 3, 4 and 5 describe behavior that is **not in HEAD**:

- Item 3 (the PreToolUse hook writes `.pipeline/current-task`) — the shipped
  `PRE_DISPATCH_HOOK` flips the `task-status.json` row and writes `dispatch-count`, but never
  the stamp (`session-hook-assets.ts:17-140`).
- Item 4 (the overlap guard clears the stamp on a mismatched dispatch) — deleted by
  `ce1c1cf17`.
- Item 5 (a symmetric PostToolUse hook removes the stamp on subagent return) —
  `POST_DISPATCH_HOOK` deleted by `e7af1ea4b`; the entry is actively scrubbed from existing
  worktrees (`worktree-prepare.ts:213-214, 319-328`).

Its item 2 (line-1 `Task: <id>` dispatch grammar) and item 6 (hooks as embedded engine assets)
remain accurate, though a grammar violation now exits 0 rather than 2
(`session-hook-assets.ts:57-61`, per #1137).

This ADR does not restore that behavior — restoring parallel-safe attribution is #531's
decision to make. It records the divergence so #474 is not designed against a mechanism that
no longer exists, and it pins (S1) the one thing #531 must not do: change the format of
`.pipeline/current-task`, because two hooks installed in the operator's global settings read
it and are never re-synced per build.

## Evidence (verify-claims ledger)

| Claim | Basis | Confidence |
|---|---|---|
| Per-task file sets are already parsed and consumed | **verified** — `plan-task-parse.ts:70-239`; consumers `autoheal.ts:541`, `wiring-probe.ts:1295-1302`, `per-task-commit-floor.ts:35` | 100% |
| No code extracts the `**Dependencies:**` *value* | **verified** — only `planHasDependencyTree` (`artifacts.ts:3016-3022`) and its two callers match; repo-wide grep of non-test `src/` found no edge parser | 97% |
| Nothing in the build loop writes `current-task`; the overlap guard is gone | **verified** — no `current-task` occurrence in `session-hook-assets.ts`; guard removal visible in `ce1c1cf17` | 100% |
| Unknown top-level config key is a hard load failure | **verified** — `config.ts:316-320` | 100% |
| `hooks/` prefix is the only path that trips the `hook wiring` surface | **verified** — `release-gate.ts:163` (`startsWith('hooks/') \|\| includes('/hooks/')`) | 100% |
| `tool_use_id` is present on every Agent-dispatch hook payload | **verified** — captured fixtures `test/fixtures/session-hook-payloads/*.json`, shape asserted `session-hook-behavior.test.ts:53-73` | 95% — captured from one host version; the degradation rule below covers its absence |
| `task-status.json` readers tolerate unknown fields | **verified** — index signatures `task-seed.ts:13-24`; `normalizeTasks` accepts three shapes (`task-progress.ts:137-174`) | 100% |
| No pipeline store carries a schema version | **verified** — `schemaVersion` grep hits only `gated-snapshot.ts`, `engineer-store.ts`, `registry.ts`, `registry-cli.ts`, `codex-provider.ts` | 100% |

**Degradation rule (S8).** If a future host stops emitting `tool_use_id`, lane correlation
degrades to absent — `dispatch-log.jsonl` is additive telemetry and no gate depends on it.
No pin in this ADR fails closed on a missing payload field.

## Assumption requiring operator confirmation at merge

**This ADR reads #552's "merged spec … that pins the v1-compatible shape" as requiring v1
enforcement code, not prose alone** (Option C over Option A). That reading turns the plan
from zero tasks into nine and puts a real diff into the cutover window. It is grounded in
#552's own "such that post-v1 implementation requires no migration block" — unachievable for
S3, S10 and S13 without v1 code — and in this repository's Design Principle. The operator's
merge of this spec PR is the confirmation; if the intent was prose-only, this ADR should be
amended to Option A before merge and #552 re-scoped, because Options A and C differ in the
build, not just in the writing.
