# Conflict Check: Engine-stamped build outcome for a disputed kickback

**Date:** 2026-08-06
**Issue:** jstoup111/ai-conductor#1336
**Stories checked:** `.docs/stories/build-agent-disputing-a-wiring-check-kickback-in-p.md` (7)
**Scope:** all 5 conflict types, intra-feature pairs, and 10 named adjacent areas
**Result:** 1 blocking (resolved), 3 degrading (accepted), 6 adjacent areas verified clean

---

## Conflict: Two competing definitions of "the build moved"

**Stories involved:** *Every build step records whether it moved the tree* / *The daemon log
distinguishes a no-movement build from a moving one* — vs the existing commit-movement liveness floor
**Files:** `.docs/stories/build-agent-disputing-a-wiring-check-kickback-in-p.md` vs
`src/conductor/src/engine/conductor.ts:4938-4949`, `:5824-5877`,
`.docs/decisions/adr-2026-07-23-commit-movement-liveness-floor.md` (**Status: APPROVED**)
**Type:** resource-contention
**Severity:** blocking

**Description:**
The build step already contains a movement observation this feature's architecture review did not
account for. `adr-2026-07-23-commit-movement-liveness-floor` (APPROVED) established a **HEAD commit
SHA** witness with two capture points: `headShaBeforeBuild` at step entry "for zero-work-product
telemetry" (`conductor.ts:4940-4941`) and `headShaAttemptStart`, re-rolled per attempt
(`:4949`, `:6273`). It drives the `no_task_progress` stall classification (`:5845-5854`) and emits
`unattributed_progress` carrying `headBefore`/`headAfter` (`:5868-5875`).

This feature's stamp uses a **tree hash** witness, inherited from #984's ADR, which deliberately
moved the kickback progress witness off commit SHA precisely because *an empty commit moves HEAD
while leaving the tree byte-identical*.

Both witnesses are individually correct for their own question, but they will **visibly disagree on
the same turn**. A build that lands an empty commit produces:

- `unattributed_progress` with `headBefore !== headAfter` — the engine says HEAD moved;
- our proposed log line `build ✓ done (no movement)` — the engine says nothing moved.

An operator reading `.daemon/daemon.log` sees the engine contradict itself on one step, which is
worse than today's silence and directly undermines OUT-1 ("distinguishable from the daemon log
alone"). Confidence that both code paths are live and would co-fire: **90%** — verified by reading
both capture sites, the stall classifier, and the event emit.

**Resolution Options:**
1. Record **both** witnesses in the stamp (`treeBefore/treeAfter` *and* `headBefore/headAfter`) and
   make the log annotation name which one it reports — `(tree unchanged)` / `(tree abc..def)`, never
   the unqualified word "movement". Reuse the already-captured `headShaBeforeBuild` rather than
   adding a third `git` call site.
2. Switch this feature's witness to commit SHA for consistency with the liveness floor.
3. Switch the liveness floor to tree hash for consistency with #984.

**Recommendation: Option 1.** Option 2 reintroduces exactly the empty-commit blind spot #984's ADR
exists to close, and would make the pre-dispatch refusal unsound. Option 3 changes an APPROVED ADR's
behavior for a stall breaker that is not this feature's subject — out of scope, and it would need
its own superseding ADR. Option 1 keeps each guard on the witness its own ADR chose, makes the
disagreement *legible* rather than contradictory, and costs one extra field plus precise wording.

**Selected: Option 1** (operator, 2026-08-06).

**Applied:**
- Stories amended — the stamp records both witnesses; the log annotation is tree-scoped and never
  says the unqualified "no movement"; a new negative-path scenario asserts the empty-commit case
  reports `tree unchanged` while `unattributed_progress` still reports HEAD moved, with no
  contradiction between them.
- `adr-2026-08-05-build-settle-outcome-stamp.md` amended in place with a `> **Amended…**` note
  beside D1 (additive; the original assertion is preserved).
- No superseding ADR is required: `adr-2026-07-23-commit-movement-liveness-floor` keeps its witness,
  its capture points, and its behavior unchanged.

---

## Degrading (accepted)

### D-1: Story 1 duplicates an existing step-entry capture
**Type:** behavioral overlap · **Severity:** degrading
`headShaBeforeBuild` (`conductor.ts:4940`) already runs one `git` probe at build-step entry.
Story 1 as written implies an independent capture pair. **Accepted with a constraint carried into
`/plan`:** the tree-hash baseline is captured *beside* `headShaBeforeBuild` at the same site, not at
a new one. Cost of ignoring: a third redundant `git` call per build step and two baselines that can
drift apart across future edits.

### D-2: The "did the build do anything" event space is already occupied
**Type:** resource-contention · **Severity:** degrading
`build_progress` / `build_no_progress` (`build-progress-watcher.ts`, cadence heartbeats) and
`unattributed_progress` (`conductor.ts:5868`) already publish build-activity signals.
**Accepted with a constraint:** this feature's annotation rides the existing `step_completed`
settle-boundary event and MUST NOT introduce a competing heartbeat. Verified non-overlapping —
the heartbeats are intra-step and cadence-driven (and by design never fire on the 1-turn builds
this feature targets); the annotation is a terminal-boundary fact.

### D-3: File-level contention with unmerged #1270
**Type:** resource-contention · **Severity:** degrading
`origin/spec/build-reports-step-completed-status-done-while-lea` (#1270) edits the same
`step_completed` emit site (`conductor.ts:7503-7522`). Neither redesigns the other — #1270 concerns a
build that *did* work but left it uncommitted; this concerns a build that deliberately did none.
**Accepted:** whichever merges second rebases onto the first. No story change.

---

## Adjacent areas verified clean

| Area | Check | Verdict |
|---|---|---|
| **#984** — kickback cap, `kickback-ledger.json` | Does the refusal double-count or co-own the cap? | **Clean.** Story 4's Done-When asserts the ledger count is byte-identical across a refusal. The refusal short-circuits *before* `consumeKickbackBudget`, so no bump can occur. `MAX_KICKBACKS_PER_GATE` stays solely #984's. |
| **#647** — `checkKickbackToBuildEscalation` / `classifyBuildProgress` | Is C1's inverted null polarity a contradiction? | **Clean — genuine separation.** #647 asks "did this cycle progress?" (null → assume no progress → escalate: conservative). C1 asks "is this provably the same empty cycle?" (null → not provable → dispatch: conservative). Same intent, opposite mechanics, different questions. Story 4 asserts the refusal does not delegate to the helper, so the two cannot be accidentally unified. |
| **#1249 / #1175** — stale wiring evidence, ordering | Does any story implicitly adjudicate staleness? | **Clean.** No story asserts a wiring verdict. Story 6 asserts the opposite direction explicitly: wiring evidence must be byte-identical to baseline when a dispute is recorded (D8). |
| **#1306** — wrong plan `Wired-into:` anchors | Does any story claim to fix the anchors? | **Clean.** No story touches plan anchors or the wiring probe's inputs. #1306 removes one trigger; this records the report. Non-overlapping. |
| **#1308** (closed, not-planned) | Does this re-open the dirty-tree case it scoped out? | **Clean and complementary.** #1308 covered a build that edited but never committed (dirty tree). Every story here is conditioned on tree-hash equality, which a dirty tree breaks. Its "genuinely produces nothing still escalates" outcome is preserved by Story 6. |
| **#1269** — `needs-human` where machine-resolvable | Does D6 collide with a disposition change? | **Clean.** D6 explicitly does not extend the `HaltClass` union, and Story 5 asserts `rekickSweep`'s result is byte-identical to baseline. If #1269 later changes disposition semantics, it inherits an unchanged surface. |

## Intra-feature pairs

All 21 story pairs were reasoned through. One ownership boundary is worth stating so `/plan` does
not create two tasks writing the same file shape:

- *Story 1* owns the record's **classification** fields (`outcome`, witnesses, `gate`, `verdict`,
  `rung`) and the write/read module. *Story 3* owns the record's **narrative** fields (`note`,
  `category`). Not a conflict — one schema, two disjoint field groups, one writer.
- *Story 2* (log line) and *Story 5* (halt reason) render the same record to different surfaces with
  no shared text. No contention.
- *Story 7* (fail-open reads) is a precondition of *Story 4* (refusal) and is sequenced before it.
  No circularity: Story 4 never writes the sidecar, Story 7 never evaluates a refusal.

---

## Verdict

**Zero blocking conflicts remain.** One blocking conflict was found and resolved by Option 1; three
degrading conflicts are accepted with constraints carried into `/plan`. Re-check after amendment
passed clean.
