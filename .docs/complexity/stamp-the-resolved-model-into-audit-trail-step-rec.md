# Complexity: Stamp the resolved model into audit-trail step records

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is bounded to two optional fields on an existing record type and the single `switch` case that projects one already-subscribed event into that record, plus the reference page that documents the record shape. It adds no event-union member, no sink declaration, no ledger, no configuration key, no CLI surface, and no consumer of the stamped value. Both values are read from fields the source event already carries, so no new plumbing crosses a step boundary. One production file changes. Small-tier architecture, conflict, and coherence artifacts are not required, and no ADR is created or amended: the governing audit-trail ADR fixes the sink and the writer, and additive optional record fields are already established practice on that record.
