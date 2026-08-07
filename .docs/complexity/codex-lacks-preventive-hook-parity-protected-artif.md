# Complexity: Provider-neutral preventive controls for protected DECIDE artifacts (#1254)

Tier: M

> **Retiered L → M on 2026-08-07** after the architecture review's verify-claims pass. Three
> workstreams were cut from scope and filed separately: the Codex `PreToolUse` early-feedback layer
> (#1353), the destructive-git relocation (#1354), and TDD-phase enforcement (dormant pending
> #1009 — nothing writes `.pipeline/tdd-phase`). What remains is one new git hook, one parser
> widening, and one fail-closed fix.

## Rationale

Signals driving the Medium tier:

- **One enforcement channel, one new asset.** A git `pre-commit` hook added to the engine-owned
  `.pipeline/git-hooks/` path (already wired via `core.hooksPath`, `worktree-prepare.ts:453-457`)
  becomes the load-bearing provider-neutral control for protected artifacts. The existing Claude
  `PreToolUse` channel is untouched and stays early feedback.
- **Parser work on a shared grammar.** Closing the scanner blind spots means changing
  `plan-task-parse.ts`, whose output feeds three call sites (`land-spec.ts:242`, `cli.ts:137`,
  `conductor.ts:9094-9104`). Widening path harvesting risks false positives at the land gate, so it
  needs careful negative-path coverage.
- **A policy divergence to reconcile.** `PROTECTED_ARTIFACT_DIRECTORIES` omits `.docs/decisions`
  while the runtime docs-guard classifier protects all of `.docs/`
  (`protected-artifact-seal.ts:17-22` vs `:205-207`). Aligning them touches the seal, the scanner,
  and the hook policy together.
- **A breaking surface.** Hook wiring is a canonical breaking surface, so the implementation PR
  carries a real `## Migration` block, not a waiver.
- **A governance deliverable.** The control-classification inventory documents the eleven operator
  hook scripts plus the engine-written session and git hooks. It is documentation, not behavior.

Not Small: it changes a breaking surface, touches a shared parser with three consumers, and adds a
new enforcement asset. Not Large once the three deferred workstreams left scope — there is no second
provider integration, and the remaining work is a single seam with well-understood mechanics.
