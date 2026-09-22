# Track: build-review-rubric-findings-arrive-as-typed-struc

Track: technical

Scope boundary: Approach A′ — build_review rubric dispatch consumes the shared provider-neutral
`nativeSchema` seam (#2429) for both providers, so no rubric output is scraped from prose; a single
engine-owned rubric contract descriptor (input projection + output JSON Schema + parser + identity)
is filled in by every catalog member — built-in `testQuality`, `security`, and the custom-policy
`custom-v1` — and one generic dispatch path renders, requests, validates (field-named rejection),
stamps, and canonicalizes for all of them; `skills/build-review-*/SKILL.md` carry judgement guidance
only, with the schema the model sees rendered from the same descriptor the engine validates against;
the provider-contract audit fails a build_review skill that re-introduces output-format prose.
Excluded: re-keying finding identity to plan position (task id + Done-when ordinal, ADR stem +
decision number). Identity stays content-anchored per adr-2026-08-18, adr-2026-08-21 D2, and
adr-2026-09-02 D6; a plan-structural re-key is a separate issue against those ADRs.

## Rationale

This changes an engine-internal contract seam and prunes duplicate schema prose from two harness
skills. No operator-facing command, flag, or config key is added; custom-rubric authors gain a
declared contract, whose acceptance criteria belong in stories. → **technical track** (skip `/prd`).
