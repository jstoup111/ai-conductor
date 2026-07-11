# Track: Evidence-range anchor rung — distinguish absent anchor from stale anchor

Track: technical

Engine-internal change to the evidence-range derivation (`getEvidenceRange` in
`src/conductor/src/engine/autoheal.ts`). No user-facing product surface: the fix
corrects how the derivation treats an ABSENT (empty-sentinel) anchor versus a
genuinely-recorded-but-unreachable anchor, and quiets a misleading warn that fires
on 100% of production gate walks. Acceptance criteria live in stories (log-line
shape, warn suppression, unchanged fallback results). Operator-confirmed via intake
jstoup111/ai-conductor#510.
