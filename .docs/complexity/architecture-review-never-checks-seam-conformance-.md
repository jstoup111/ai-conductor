# Complexity: Architecture review never checks seam conformance (#1995)

Tier: S

Rationale: The change is instruction text in one shipped skill (`skills/architecture-review/SKILL.md` §4, §12's scope list and classification table, and its Verification list) with no new test: natural-language skill guidance is not executable behavior under `HARNESS.md` and the `tdd` skill, so verification is the reviewed diff plus the existing provider skill contract audit. Against the conduct rubric it touches no models or tables, no external integrations, no auth, and no state machine, and it needs three stories. It adds no engine code, command, option, configuration key, schema, event, or as-built check-policy entry: the as-built engine already gates `adrCompliance` on APPROVED ADRs and accepts any APPROVED ADR decision as a finding's governing reference. It makes no structural decision, so no ADR is warranted (prompt wording and workflow policy are not ADR triggers under architecture-review §7). Small-tier architecture-review, architecture-diagram, conflict-check, coherence, and plan-review artifacts are not required.

Not a hotfix (composer §3b): the change adds new review behavior that no accepted story intends, and its prose spans two passages, two Verification items, and two table rows, beyond the hotfix bound of about 15 changed production lines.
