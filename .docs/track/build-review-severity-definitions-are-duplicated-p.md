# Track: build_review severity definitions have one engine-owned source

Track: technical

Scope boundary: Balanced (composer-delegated 2026-10-28; the five desired outcomes of #3381). In
scope: one engine-owned severity definition text, rendered word for word into every build_review
rubric dispatch prompt, built-in (the shared rubric prompt assembled in `dispatchBuildReviewRubric`)
and custom (`renderBuildReviewPolicyContract`), next to the result schema; removal of the severity
paragraphs from the three built-in rubric skills and of the inlined severity sentence in the custom
contract; a test that fails when any registered rubric's dispatch prompt, or the custom prompt, is
missing or rewording the shared text, or when a rubric SKILL.md defines the scale again; an amendment
note on `adr-2026-10-19-build-review-finding-severity-advisory-threshold` D1 moving reviewer-guidance
ownership to the engine. Excluded: severity guidance in the remediate adjudicator's prompt or
`skills/remediate/SKILL.md` (it assigns `adjudicatedSeverity`, but is not a rubric dispatch);
per-concern-kind severity calibration; any change to the severity values, their order, the result
schemas, the rubric contract versions (built-in v4, custom v2) or finding identity; human-facing
documentation (none restates the scale today).

Engine prompt-assembly and shipped-skill text change with no user-facing product behavior; acceptance
criteria live in stories. Chosen approach A (engine-owned constant rendered by both prompt assemblers,
the filer's hypothesis, which won on merits) over B (carry the meanings as JSON Schema `description`
on the `severity` property and render them through `renderRubricContractShape`: the shape renderer
ignores descriptions today, and putting prose into the native output schema widens the provider
schema surface for a wording concern) and C (one shared skill fragment that each rubric skill
includes: providers load a single SKILL.md with no include mechanism, and custom rubrics have no
built-in skill, so the custom prompt would still need its own copy). Source: jstoup111/ai-conductor#3381.
