# Track: finish-deadlocks-when-the-prose-judge-asks-for-rev

Track: technical

Scope boundary: Balanced — introduce a judged-deficient prose state so the selector can route
authored-but-rejected prose back to authoring, thread the judge's objection detail into the
authoring pass and into prose halts, and keep author→judge laps bounded by the existing
publication-progress allowance. Excludes auditing/calibrating the judge's verdict quality itself
(the "was the structurally_incomplete verdict on #1946 legitimate" question is out of scope).

Engine-internal FINISH publication fix; no user-facing product capability, so acceptance criteria
live in stories (no PRD).
