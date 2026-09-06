# Complexity: Fail land when a non-Small architecture artifact has no mermaid diagram

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

One production file changes. The check is a presence assertion added inside a tier-conditional branch that already exists, reusing the already-exported fence extractor and the already-resolved architecture artifact pick; it introduces no module, no interface, no configuration key, no CLI surface, no event, metric or log line, and no persisted state. The rest of the change is test-fixture repair in four existing test files plus two documentation rows and one skill sentence. No architectural decision is opened: the seam, the tier discrimination, the attribution scoping, and the refusal style are all inherited unchanged from the surrounding gate. Small-tier architecture, conflict, and coherence artifacts are not required.
