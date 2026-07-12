Track: technical

Rationale: A pipeline-efficiency change to internal build/ship step instructions — no
user-facing product surface. The edits are to the build_review grader prompt
(`src/conductor/src/engine/build-review-prompt.ts`), the TDD per-cycle test instructions
(`skills/tdd/SKILL.md`), and a clarifying note in the finish gate (`skills/finish/SKILL.md`).
Acceptance is verified by prompt/skill text asserting scoped-test wording and by the
existing gate machinery (build-review verdict predicate, finish full-suite gate, CI's
`conductor` job) still holding — not by end-user requirements. No PRD.
