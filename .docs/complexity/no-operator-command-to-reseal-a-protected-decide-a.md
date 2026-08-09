# Complexity: No operator command to reseal a protected DECIDE artifact (#1281)

Tier: M

## Rationale

**Signals present (push above S):**

- **Multiple surfaces in one change.** An engine refactor
  (`src/conductor/src/engine/protected-artifact-seal.ts` — extract the shared writer tail,
  parameterize the seal-computation head), a new operator CLI verb (`detect`/`dispatch` pair plus
  the `cli.ts` declaration and `index.ts` pre-boot wiring), a new `ConductorEvent` union variant,
  and HALT-marker handling.
- **An unresolved architectural question.** `conduct reseal` is a standalone CLI process with no
  live emitter and would be a second writer to a worktree's `.pipeline/events.jsonl`. The
  event-spine skill's exceptions A/B point at a single-writer sibling ledger in the same schema,
  but the write location is not settled — it needs an ADR before implementation.
- **A safety boundary is being modified.** The seal is a tamper-detection surface. The change must
  preserve "a genuine feature-authored BUILD/SHIP edit still halts" while opening an operator-only
  escape hatch, and must not regress `rotateProtectedArtifactSeal`'s existing behavior.
- **Documentation is part of the contract** — `docs/runbooks/stalled-or-stuck-feature.md` (replace
  the `npx tsx` heredoc recipe) and `docs/reference/cli.md` (new flags).

**Signals absent (hold it below L):**

- No new models, no persistence schema beyond an additive union variant and an additive
  `rebaselines[]` entry, no authentication, no external integrations, no network calls.
- No state machine; the command is a single deterministic, non-interactive operation.
- The fingerprinting, atomic-write, audit-append, and HALT-preservation primitives all already
  exist and are being reused rather than invented.
- Estimated story count is mid-single-digit, all mechanically verifiable.

**Verdict: Medium.** Architecture diagram, architecture review with an ADR, conflict-check, and
coherence-check are all in scope; nothing here warrants the full Large treatment.
