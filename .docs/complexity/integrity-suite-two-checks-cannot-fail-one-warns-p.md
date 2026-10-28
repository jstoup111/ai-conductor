# Complexity: Integrity suite hardening (#1014)

Tier: M

Rationale: Five independent defects in one shell suite plus small coupled edits — `model: opus` pins
on five SKILL.md files, a new reasoned allowlist contract for check 5, check 5c's fixture redirected
to a temp copy through the existing `GENERATE_DOCS_GUARD_HOOK_OUT` seam, and removal of the matching
known-limitation notes. No new runtime behavior, but multiple files and a new allowlist contract
exceed Small; the filer also sized it M.
