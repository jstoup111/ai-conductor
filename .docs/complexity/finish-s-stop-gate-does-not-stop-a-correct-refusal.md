# Complexity: finish's STOP gate does not stop — a correct refusal is retried as an ordinary step failure

Tier: M

## Rationale

Signals assessed against the standard conduct set (models, integrations, auth, state machines,
story count):

- **Models / persistence:** none. No schema migration, no new durable artifact — Approach A was
  chosen specifically to avoid one.
- **Integrations:** none new. `gh` and `git` boundaries are untouched.
- **Auth:** none.
- **State machines:** one existing machine is modified, not introduced. The FINISH publication
  disposition union in `finish-publication.ts` gains an optional `detail` field on its
  `human_required` arm, and the halt-reason rendering seam changes. The routing itself
  (`routeFinishPublicationDisposition` -> `writeHaltMarker(..., 'needs-human')` -> `daemon-rekick`
  skip) is already correct and stays as-is.
- **Story count:** ~4 — the reason-expansion map, the disposition `detail` field, the provider
  verdict contract in `skills/finish/SKILL.md`, and the intent-resolution reason audit.

## Why not S

`isExactDisposition`'s `human_required` arm is a strict exact-key guard (`hasOnly('kind', 'reason')`).
Widening it to admit `detail` moves the guard, every construction site that builds a `human_required`
disposition, and the existing tests that assert the exact-key shape. That fan-out across an engine
type boundary is past the Small tier's single-seam bar.

## Why not L

No new subsystem, no new artifact, no new external boundary, and no cross-phase coupling. The blast
radius is one engine module, its tests, and one SKILL.md.
