# Track: Per-feature artifact manifest and one artifact lookup (#3405, spec 1 of 3)

Track: technical

Scope boundary: Spec 1 of a three-spec split, operator-confirmed 2026-10-24. In scope: a growable per-feature manifest under
`.docs/<slug>/` that lists the feature's artifact files and initially points at today's
`.docs/<kind>/<stem>.md` paths; composer `land` is its only writer (halted, shipped and release-waiver records stay
repository-wide and outside the manifest; interactive `conduct` writes no manifest until spec 3); one engine lookup that resolves a feature-scoped artifact kind for a
feature through its manifest and runs today's resolution code unchanged when no manifest exists, with every
engine reader that builds an artifact path routed through it; daemon discovery that finds specs by
manifest as well as by today's paths. Repository-wide reads (ADR and architecture corpora) and
plan-review records resolve as today. No artifact file moves. Specs without a
manifest, and consumer repositories, keep working unchanged. Legacy resolution is not reworked
(no unified identity or fallback rule): the manifest replaces it for new specs. Migrating existing
specs is not required. No hard size limits on any artifact.

Out of scope: spec 2 makes path policy (protected-artifact seal, pre-commit hook, BUILD docs
write allowlist, gate invalidation, rebase, retention, build_review scope) decide feature
ownership from the manifest instead of folder and basename, and adds manifest drift checks,
manifest file protection and registration of files added after land. Spec 3 moves new specs to the
`1-review/` and `2-machine/` layout with numbered review files, restructures artifact content (no
Done When in stories, plan summary versus full tasks), references criteria and Done-when checks by
id instead of copied text, and adds authoring writing rules. Both are filed as dependent intakes.

Rationale: reviewers cannot tell which spec artifacts to read because bookkeeping and execution
detail are mixed into them. Moving artifacts safely requires the engine to find every artifact
through one lookup, and to own path policy by manifest, before any writer produces the new layout.
