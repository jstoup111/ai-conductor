# Track: remediation-repairs-are-blind-to-the-plan-contract

Track: technical

Scope boundary: Both joins (plan-task contract + prior-attempt history), all rubrics.
Pointers-only injection: the engine deterministically resolves the join at
remediation-dispatch time and injects compact references (plan file path + task id +
anchor, prior-lap paths + finding ids) — never inlined Steps or full history — to
avoid token bloat in the remediation context. The skill instructs the agent to read
the referenced files. Joins are advisory and fail-open: a missed join degrades to
the deterministic pointers alone, never blocks or alters dispatch.

Engine/harness internals only (remediation dispatch context + remediate skill); no
user-facing product behavior — acceptance criteria live in stories, no PRD.
