# Complexity: External-boundary ports, registry, and ratchet

Tier: L

## Rationale

- A cross-cutting architectural convention. One typed boundary registry governs LLM, git, gh,
  tmux, process spawn, clock, OTel export, and filesystem, and binds every engine module and
  every entry point (`conduct` CLI and daemon).
- It needs a new ADR (a boundary and integration-pattern decision), which also sets the frame
  that the decomposition roadmap's git-port slice (#3043) implements.
- It adds a new repo-wide structural ratchet with a large shrink-only allowlist, and every
  later feature that touches an external call meets it.
- It touches multiple layers: `types/` or `execution/` for ports and adapters, the entry-point
  composition roots, and `test/structural/`.
- It governs eight follow-on per-boundary migrations, so getting the convention wrong costs
  rework in all of them.
- Operator-confirmed tier: L (2026-11-07). The source issue carries `size: L`.

Per tier rules, the full set runs: architecture-diagram, full architecture-review,
conflict-check, coherence-check, and plan-review.
