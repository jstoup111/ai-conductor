# ADR: Task-Trailer Id Alias (`task-<id>` ≡ `<id>`) in Evidence Derivation

**Date:** 2026-07-07
**Status:** APPROVED (operator-approved 2026-07-07)
**Deciders:** James Stoup (operator), engineer session for #417
**Relates to:** adr-2026-07-05-engine-owned-task-status (extends H5; does not supersede)

## Context

Issue #417: every daemon build auto-parks at the completion gate because plans declare
tasks as `### Task 1:` (parsed ids are bare `1..N`) while build agents stamp commit
trailers as `Task: task-N` — echoing the row ids they themselves wrote into
`task-status.json` (observed: the parked `audit-trail-…` feature carries BOTH id
families, `task-1..task-19` agent rows and `1..19` engine-seeded rows).
`deriveCompletion` (autoheal.ts) requires an exact trailer↔plan-id match, so zero
evidence ever matches regardless of work quality. The skills show bare-id examples
(`Task: 42`) but never state the id's source of truth or forbid the `task-N` spelling —
and `skills/pipeline/SKILL.md`'s own progress-log example uses `task-1`, `task-2`.

The APPROVED adr-2026-07-05-engine-owned-task-status already binds (H2) trailer
enforcement at both skill layers and (H5) the trailer-first evidence contract with the
empty-commit `Evidence:` form. The #417 skill-layer work *implements* H2/H5 — it needs
no new decision. What H5 leaves undefined is whether the engine may accept a legacy
trailer spelling; the gate today rejects `task-N` and two green-suite features are
parked on exactly that.

Evidence basis (verify-claims): all mechanism claims above were verified directly —
gate code read (autoheal.ts:481–604, artifacts.ts:651–739), parked feature's
task-status.json and `git log --format=%(trailers)` inspected, skill texts read.
Confidence: ~98% (verified). Assumption surfaced and operator-approved during explore:
the alias alone does NOT unwedge tasks with no trailer on any commit (audit-trail tasks
5/9/10; fix-400 subject-only commits) — those recover via the H5 `Evidence:
satisfied-by` backfill form, operator-gated.

## Options Considered

### Option A: Skill-layer grammar fix only (no engine change)
- **Pros:** Engine's exact-match bar stays maximally strict; single spelling forever.
- **Cons:** The two parked green-suite features (and any in-flight branch with prefixed
  trailers) stay structurally unevidenceable; recovery would require backfill commits
  for *every* task (16+11), not just the genuinely unattributed ones — pure ceremony
  that the evidence bar gains nothing from.

### Option B: Skill-layer fix + ambiguity-guarded engine alias (chosen)
- **Pros:** Root cause fixed at the contract layer; the engine additionally accepts
  `Task: task-<id>` as evidence for plan id `<id>` — unwedging all trailer-prefixed
  tasks immediately with no history rewrite. Attribution stays unambiguous: the alias
  is suppressed for any id the plan itself declares literally as `task-<id>` (the H9
  grammar permits such ids), so no trailer can ever evidence two different plan tasks.
- **Cons:** Two accepted spellings in perpetuity (small grammar wart); one extra
  conditional in the match path to test adversarially.

### Option C: Rewrite trailers on the parked branches (history rewrite)
- **Pros:** No engine change.
- **Cons:** Rewrites 18–20-commit histories that already passed the full suite;
  operator already declined hand-forged attribution; does nothing for future drift.

## Decision

Option B. The evidence bar exists to prevent *false* attribution, not to reject
*unambiguous* attribution over a spelling prefix. `task-<id>` → `<id>` normalization is
information-preserving whenever the plan does not itself declare a literal `task-<id>`
id, so accepting it does not weaken H5/H6 authority (the sidecar remains engine-only;
forged status rows remain untrusted). Concretely:

1. **One id grammar at the skill layer (implements H2):** `skills/tdd/SKILL.md` and
   `skills/pipeline/SKILL.md` state that the trailer id IS the plan header id
   (`### Task 7:` → `Task: 7`), explicitly ban the `task-N` spelling, and the
   pipeline progress-log example drops its `task-1`/`task-2` ids.
2. **Trailer discipline at COMMIT (implements H2):** the tdd COMMIT hard-gate adds:
   a commit whose subject references a task (e.g. "Task 5: …") without the matching
   `Task:` trailer fails the checklist; verification-only tasks MUST produce the H5
   no-op evidence commit (`git commit --allow-empty` with `Task: <id>` +
   `Evidence: satisfied-by <sha>` or `Evidence: skipped <reason>`). The Evidence
   section's "final task report" wording — which documents a mechanism the engine
   never reads — is rewritten to the commit form.
3. **Engine alias (extends H5):** in `deriveCompletion`'s trailer matching (both the
   Evidence-commit and plain-trailer predicates), a trailer value `task-<id>` matches
   plan id `<id>` iff `task-<id>` is not itself a plan-declared id. Alias matches stamp
   the sidecar identically to exact matches.
4. **Recovery (applies H5, no new mechanism):** documented operator-gated procedure for
   the two parked features — for each still-unresolved task after the alias lands,
   the operator verifies the work exists and appends an empty commit
   `Task: <id>` + `Evidence: satisfied-by <sha>`; then `conduct daemon unpark`.

## Consequences

### Positive
- Both parked features become shippable without history rewrite or hand-forged claims.
- Future daemon builds cannot drift into the unsatisfiable-gate state via id spelling.
- Skill text and engine behavior agree for the first time on the Evidence: mechanism.

### Negative
- The trailer grammar permanently admits two spellings; tests must pin the ambiguity
  guard (a plan declaring both `7` and `task-7` must never cross-match).
- Subject-only task references remain non-evidence (by design — the bar's strictness
  there is intentional and unchanged).

### Follow-up Actions
- [ ] Stories + plan under stem 2026-07-07-evidence-gate-task-id-grammar
- [ ] Adversarial tests: alias hit, alias suppressed on literal collision, empty-commit
      rejection unchanged, dangling satisfied-by unchanged
- [ ] Recovery runbook executed on audit-trail-… and fix-400-… after merge
