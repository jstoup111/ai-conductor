# Track: codex-fresh-session-per-step-contract

Track: technical

## Rationale

This change settles and enforces an internal engine contract: whether Codex-backed dispatch may
resume a provider session, and what a within-step retry carries. Everything it touches is engine
internals — `provider-session.ts`, `provider-execution.ts`, `codex-provider.ts`, the
`LLMProvider` interface — plus test coverage. There is no user-facing feature, no new command,
no new config key an operator sets, and no product requirement an end user perceives. Acceptance
criteria for engine dispatch behavior belong in stories, not a PRD. → **technical track**
(skip `/prd`).
