# Conflict Check: daemon-lifecycle-controls

**Date:** 2026-07-04
**New stories:** `.docs/stories/2026-07-04-daemon-lifecycle-controls.md` (FR-1–21)
**Corpus scanned:** all `.docs/stories/`, active specs, plans (daemon-supervised-hosting,
daemon-issue-priority-scheduling #200, dependency-ordered-intake-and-dispatch,
harness-daemon-profile, generated-model-table, self-host guardrails/sandbox-build-isolation,
multi-operator slices), ADRs (adr-005, adr-010, adr-013, adr-2026-06-29 supervisor,
2026-07-04 feature ADRs), prior conflict reports.

**Result: PASSED — zero blocking, zero degrading conflicts.**
One story strengthened during the scan (see Finding 1).

## Finding 1 — Re-kick is a dispatch path pause must gate (story strengthened, no conflict)

adr-013 re-kicks HALT-parked work when the base branch advances. A paused daemon whose
`maybeRekick` fires would dispatch work — contradicting FR-1's "no new dispatch while
paused". Not a story-vs-story contradiction (FR-1's blanket wording subsumed it), but
implicit. **Resolution applied:** explicit negative path added to the FR-1 story: no
re-kick dispatch while paused; eligibility returns on resume.

## Finding 2 — Prior restart story (supervised-hosting FR-4): strengthened, not contradicted

Old contract: inner process changes, management endpoint persists, exactly one daemon,
restart subsumes start, actionable error when substrate missing. Respawn-in-place
satisfies every clause and adds session/scrollback preservation (new FR-20). The old
story's "Done When" remains true verbatim. The kill-session implementation it was built
with is replaced per adr-2026-07-04-respawn-in-place-restart; no old acceptance
assertion becomes false. **No action.**

## Finding 3 — Build-flow contention (harness-daemon-profile, generated-model-table): compatible via path stability

- `harness-daemon-profile` bin/setup asserts worktree-local `src/conductor/dist/index.js`
  exists and the PRIMARY checkout's dist is untouched. Under the versioned store,
  `npm run build` (now the publish wrapper) still yields a working `dist/index.js`
  (symlink → versioned dir) in whichever tree runs it — assertions hold. The plan for
  this feature must include a task verifying bin/setup stays green post-rewire.
- `generated-model-table` mandates "no dist rebuild" and asserts `dist` mtimes
  unchanged; it builds nothing, so it cannot collide with the wrapper. Its
  hazard-mitigation rationale becomes belt-and-suspenders once #215 is closed —
  doc-level note, not a conflict.
- Self-host sandbox builds operate in worktrees with their own layout; the wrapper is
  tree-local, no cross-tree contention.

**No action beyond a plan task (bin/setup smoke) + docs note.**

## Finding 4 — Terminology: supervised-hosting `debug` narrative says "pause the work"

The debug verb's prose ("take control… pause its work, inspect, then resume or
restart") predates the pause verb and means interactive Ctrl-C inside the session — a
different capability from durable repo pause. No state conflict (different mechanisms,
different scopes). **Docs disambiguation in this feature's PR** (README/daemon docs:
`pause` verb ≠ debug-session interrupt).

## Pairwise sweep summary

- **Contradiction:** none found.
- **Behavioral overlap:** Finding 2 (benign, strengthened), Finding 4 (terminology).
- **State conflict:** `.daemon/` namespace checked — new `PAUSED`, `RESTART-PENDING`
  vs existing `daemon.pid`, `daemon.log`, `last-base-sha`, `processed/`, `warned/`,
  `mergeable-watch.jsonl`: disjoint keys, disjoint writers. No impossible states;
  PAUSED×RESTART-PENDING interplay is explicitly defined (paused=idle → fire, come up
  paused) in the ADRs and FR-11 story.
- **Resource contention:** status surface gains a state enum + version column —
  additive to `computeStatusRow`; no other feature claims those fields. Build flow:
  Finding 3.
- **Sequencing:** #200 priority scheduling (unbuilt, hard-sequenced behind
  dependency-ordered intake) composes by construction — pause gates the consumer,
  never mutates queue state; FR-2 story asserts ordering-neutrality either way. No
  circular dependency; this feature does not depend on #200 landing first or last.

## Accepted degradations

None.
