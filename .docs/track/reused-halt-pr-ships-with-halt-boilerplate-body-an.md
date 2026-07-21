# Track: Reused halt PR ships with halt boilerplate body and slug title; halt signal laundered (#632)

Track: technical

## Rationale

Internal daemon/finish-step correctness fix: the finish-time halt-PR rehabilitation machinery
(`src/conductor/src/engine/halt-pr-rehabilitation.ts`, wired from the repair callback at
`src/conductor/src/engine/conductor.ts:639-673` per adr-2026-07-03-halt-pr-rehabilitation-at-finish)
fixes label/draft/marker/`Closes` and floors the title, but nothing ever touches the engine-authored
halt boilerplate *body* (`build-failure-escalation.ts:155-160`), and the finish completion gate
(`artifacts.ts:1267`, `readStaleHaltTitle`) checks only the `needs-remediation:` title prefix. The
engine's own retitle floor clears that prefix, so every stateless halt signal (title prefix, label,
body marker) is laundered while the boilerplate body ships — observed on PR #610 (2026-07-13),
previously hand-fixed on #231, #249, #444, #575.

No user-facing product capability, no new command, no new config surface. The halt body being
replaced is engine-authored text, so its deterministic replacement is engine mechanics (ADR
Decision 2 territory), not skill presentation — the skill retains ownership of *rich* presentation.
Acceptance criteria live directly in stories. → **technical track** (skip `/prd`).

## Approaches weighed (explore)

1. **Extend the deterministic floor pattern (chosen).** Add the engine-authored banner sentence as a
   third stateless halt signal, add a `bodyFloor` mechanic beside the existing `retitleFloor`, wire
   it into the finish repair callback, and extend the fail-open completion gate to also fail on a
   boilerplate body. Follows the pattern the #499 finish-engine-machinery spec already established;
   reuses tested primitives (verify-after-write, warn-only, bounded retry).
2. **Gate-only (no floor).** Fail the completion gate on boilerplate body and let per-step retries
   drive the /finish//pr skill to comply. Rejected: this is exactly the prompt-discipline reliance
   that produced #610/#575 — bounded retry burn, HALT residue, operator hand-fixes. Deterministic
   machinery is available and cheaper (CLAUDE.md deterministic-first).
3. **Persistent born-as-halt record.** Rejected: ADR 2026-07-03 Decision 4 chose stateless detection
   from observable PR state; the banner text in the body IS observable PR state, so no new state is
   needed to keep the gap detectable.
4. **Full engine-composed rich body (summary prose + narrative test evidence).** Rejected by the ADR
   ("template-quality title/body"); out of scope. The floor guarantees a valid, truthful
   implementation-PR body (summary from feature description, deterministic test-evidence line from
   `.pipeline/task-status.json`, `Closes`); richer presentation stays with the skill.

Filer hypotheses from #632 enter as candidates per the Embedded Design Divergence Rule; approach 1
subsumes hypotheses 1, 3, and 4 and narrows hypothesis 2 to a floor rather than full composition.
