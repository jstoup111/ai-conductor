# Complexity assessment: engineer handoff pushes the spec branch

Tier: S

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / entities | None. No schema, no data model. |
| Integrations | One: an added `git push` subprocess alongside the existing `gh` subprocess, both already injected. |
| Auth / identity | Untouched. |
| State machines | None. Linear: push → create PR → (on no-remote) skip. |
| Story count | 3 (push-then-PR happy path, genuinely remote-less fallback, push failure that is NOT no-remote). |
| Files touched | `handoff.ts` (add injected git runner + push step), `engineer-cli.ts` (wire real `git push`), plus targeted tests. |
| Blast radius | Contained to the handoff step's shell-out path; no cross-cutting change. |

All signals point to **Small**: a single primitive gains one injected step, with a
sharpened no-remote classification. Per the tier rules this Small technical fix
**skips** conflict-check, architecture-diagram, and architecture-review; the
land gate requires only track + stories + plan + this complexity marker.
