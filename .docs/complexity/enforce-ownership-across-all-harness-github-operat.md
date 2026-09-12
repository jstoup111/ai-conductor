# Complexity: Ownership across harness GitHub operations

Tier: L

The shared enforcement boundary crosses daemon sweeps, PR publication and rehabilitation, intake writeback, tracker adapters, and remote Git publication. It must resolve identity and target provenance, refuse ambiguous authorization without partial remote writes, and prevent alternative execution paths from bypassing the policy. These are multiple integration boundaries and failure modes, requiring full architecture review, conflict checking, and coherence mapping.

Local Git consolidation remains outside scope (#2517). No implementation is authorized by this spec-authoring session.

