# Track: ADR-001 still decides "No custom runtime" against a 106k-LOC runtime

Track: technical

Scope boundary: Balanced, operator-confirmed 2026-11-07. Delete `.docs/decisions/001-harness-architecture.md` and repair the four records that cite it; author a replacement record only if one is actually needed. Add a read-only `ai-conductor decisions` query that indexes the decision corpus on demand (kind, disposition, date, title, one-line decision), classifying by filename prefix first and record content second, so it works unchanged in consumer repositories with their own legacy ADRs and in repositories with no corpus. Read every corpus location from the manifest kind table (`MANIFEST_KIND_LOCATIONS`) so the per-feature artifact layout work (#3419) and ADR relocation (#782) stay compatible. Add a conformance check over files a change adds to the corpus only. Excluded: renaming or rewriting any existing record (the protected-artifact seal and land's ADR gates forbid it), a committed index file, a bot-maintained index, a per-record subsystem field.

Rationale: internal tooling and record hygiene with no product requirements; acceptance criteria live in stories.
