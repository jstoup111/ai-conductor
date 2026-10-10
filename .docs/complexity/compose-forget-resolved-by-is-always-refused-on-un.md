# Complexity: compose forget --resolved-by on unassigned issues

Tier: S

Rationale: One CLI verb's handler (`forget` in `src/conductor/src/engine/engineer-cli.ts`) gains an injected
confirmation and a corrected absent-entry branch; the existing terminal confirmer inlined in
`src/conductor/src/index.ts` is extracted into a small shared module so both the `github-operation` command and
`compose forget` use one prompt; help text and the composer skill §3a are corrected. No new state, event, schema,
config key, or CLI flag; the approval seam and assignment rule are reused unchanged. Risk is confined to one
authorization call site and is fully unit-testable through `dispatchEngineer` with an injected confirmer.
