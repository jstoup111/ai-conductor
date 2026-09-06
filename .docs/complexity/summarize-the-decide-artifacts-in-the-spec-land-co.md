# Complexity: Summarize the DECIDE artifacts in the spec land commit body

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change is one new pure composer module plus its call site inside the existing land primitive's
commit invocation. It reuses the exported stories-block splitter, section-body reader, and plan task
enumerator; it introduces no new artifact, schema, configuration key, CLI flag, gate, hook, event, or
storage. It reads no file the land primitive does not already read and adds no I/O. Two production
files (one new, one edited) and two test files (one new, one edited). Small-tier architecture,
conflict, and coherence artifacts are not required.
