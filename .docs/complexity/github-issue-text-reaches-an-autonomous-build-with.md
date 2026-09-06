# Complexity: github-issue-text-reaches-an-autonomous-build-with

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One: an inbound-sanitization result (delimited text + list of neutralizations), mirroring `SanitizeResult` |
| External integrations | None new — sits behind the existing `gh` adapter in `intake/github-issues.ts` |
| Auth / permission surface | Trust boundary — untrusted tracker text vs operator instruction; no credential or permission changes |
| State machines | None |
| Story count | ~5 (delimit, neutralize outside fences, evidence preserved, audit record visible, applies to every writer) |
| Files touched | ~6 engine files (`intake/sanitize-inbound.ts` new, `github-issues.ts`, `engineer-cli.ts` claim output, `events.ts` schema, tests) + `skills/intake` / composer prose + docs |
| New runtime code | Yes — new pure module plus a `ConductorEvent` variant |

## Rationale

A new trust-boundary seam with its own contract (what counts as directive-shaped, what is
exempt, how alterations are reported) warrants an ADR and a lightweight architecture review,
and the event-spine extension needs the `event-spine` decision procedure. Nothing crosses a
provider or storage boundary and privilege narrowing is excluded (see track marker), so it
is not Large. → **Medium.** Architecture-diagram, lightweight architecture-review,
conflict-check, and coherence-check apply.
