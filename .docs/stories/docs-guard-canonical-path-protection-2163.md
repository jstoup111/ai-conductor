**Status:** Accepted

# Stories: Docs guard canonical path protection

Source-Ref: jstoup111/ai-conductor#2163

The operator approved both requested-path and resolved-destination enforcement on 2026-09-05. Accepted under the batch authorization for unambiguous S specifications.

## Story 1: Equivalent protected paths receive the same rejection

As an operator, I want the active .docs freeze to hold regardless of how the host spells a target.

### Acceptance Criteria

#### Happy Path
- Given an active BUILD or SHIP marker and a protected .docs target, when the host supplies a logical symlinked-root path, the physical-root path, another symlink alias, or an equivalent path using dot/traversal components, then every spelling is blocked with exit 2 unless the existing allowlist permits it.
- Given a not-yet-created file beneath an existing protected directory, when its target is supplied through an alias, then nonexistence of the leaf does not bypass protection; missing normal parent directories likewise do not prevent classification.

#### Negative Paths
- Given an active marker and an unprotected target, when the path is conclusively outside .docs in both interpretations, then the hook still exits 0, including .docs-like sibling directory names and paths outside this project.
- Given no phase marker, when any payload or no payload is supplied, then the hook exits 0 without reading stdin or attempting filesystem path resolution.
- Given an active marker and a path that cannot be resolved safely because of a symlink loop, broken symlink, permission error or invalid input, when the write is classified, then it exits 2 as undeterminable rather than treating failure as an outside-.docs path.

### Done When
- [ ] Both the generated session-hook source and committed installed hook reject equivalent protected targets, including new files and missing normal parents.
- [ ] Unprotected and .docs-like sibling targets retain exit 0; unresolved targets retain fail-closed exit 2.
- [ ] Marker absence preserves the no-stdin/no-resolution fast path.

## Story 2: Symlinks cannot grant an allowlist exemption

As an operator, I want both path interpretations checked so an allowed prefix cannot expose protected artifacts through a link.

### Acceptance Criteria

#### Happy Path
- Given a target under the allowed .docs/release-waivers prefix whose destination is also permitted by the existing policy, when the write is checked, then it exits 0.
- Given multiple equivalent spellings of the same permitted target, when each is checked, then spelling alone neither removes nor grants permission.

#### Negative Paths
- Given a requested path beneath allowed .docs/release-waivers resolves into protected .docs/plans, when the write is checked, then it exits 2.
- Given a requested protected .docs/plans path resolves outside .docs or into an allowed directory, when the write is checked, then it still exits 2 because the requested protected path is not exempt.
- Given that requested protected path uses another project-root alias, neither the current logical PWD spelling nor the physical spelling, when an inner link resolves outside the project, then it still exits 2; the root alias cannot hide the requested protected suffix.
- Given a requested non-.docs path resolves into protected .docs, when the write is checked, then it exits 2 based on the destination.
- Given traversal components escape an allowed prefix into a protected directory, or a directory name merely starts with an allowlisted directory name, when the write is checked, then the prefix does not grant permission.

### Done When
- [ ] Real temporary-directory symlink fixtures prove all three crossing directions: allowed-to-protected, protected-to-unprotected, and unprotected-to-protected.
- [ ] The protected-to-unprotected case is also blocked through a distinct alternate root alias followed by an outward inner link.
- [ ] Literal directory-segment boundaries and dot/traversal normalization cannot widen the allowlist.
- [ ] Exit-2 diagnostics retain phase, step, marker and existing recovery guidance.

Negative-category review: malformed targets, unreadable paths, symlink loops, aliasing, traversal and missing normal ancestors are covered. No third-party service or new authentication boundary is introduced. The hook remains early feedback, not an atomic filesystem-write interceptor: racing a symlink after the hook returns is still owned by existing commit/seal enforcement, not a new TOCTOU guarantee in this change.

Status: Accepted
