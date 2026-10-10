# Track: Dependency edges are hand-maintained — intake and DECIDE never create or verify blocked_by links

Track: product

Scope boundary: Balanced. Covers only the gaps remaining in jstoup111/ai-conductor#536: (a) prose-grammar dependency declarations in newly filed or edited issues become native blocked_by links, using the three unambiguous forward-direction same-repo patterns already in `issue-dep-migration.ts`; ambiguous prose creates no edge. (b) `compose land` for an intake issue proposes implied edges, refuses while any are undecided, and writes only accepted edges. (c) A read-only drift report (`engineer dep-audit` plus an on-poll pass) covers unlinked prose deps, links to closed issues and contradictory edges, with one summary event per sweep and no mutation. Excluded: structured `--depends-on` in `intake-file` (#2831) and the issue-form depends-on field via `label-sync.ts` (both already shipped); dashboard UI; per-finding events.

New operator-facing capability with requirements and a negative path; precedent `dependency-ordered-intake-and-dispatch` is product track.
