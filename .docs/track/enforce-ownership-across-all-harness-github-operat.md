# Track: Ownership across harness GitHub operations

Track: technical

Scope boundary: All harness GitHub operations pass through a shared guarded interface. Ownership applies to mutations, including remote Git writes (pushes and remote branch deletion); reads needed for discovery and ownership verification remain available. Local Git reads, commits, and worktree operations are outside this feature. Broader Git execution consolidation is separate intake #2517, not a prerequisite.

Operator approval: 2026-09-11, confirmed shared gate, this boundary, and the technical track in chat.

This is cross-cutting enforcement of existing multi-operator ownership intent. Acceptance criteria belong in stories; no PRD.

Source: jstoup111/ai-conductor#2516

