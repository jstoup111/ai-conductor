# Complexity: Refuse unsupported plugin kinds at load

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change edits two production files that already own the behavior: the plugin kind union and its validation list, and the manifest validator's kind branch. It removes two union members, adds one refusal branch with a named message, updates the one existing test that referenced a retired kind, adds unit and discovery coverage, adds a type-level guard binding each remaining kind to its retrieval site, and updates the page that documents plugin manifests. It introduces no new module, no service, no schema record, no storage, no configuration key, and no telemetry channel; the refusal travels on the existing `PluginManifestError` and the existing discovery warning, so the event spine is untouched. It designs no execution seam for the retired kinds and changes nothing about how the four supported kinds are discovered, registered, resolved, or invoked. Small-tier architecture, conflict-check, and coherence artifacts are not required.
