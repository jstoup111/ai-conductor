# Track: remediation-gap-ids-have-no-admissible-form-on-a-n

Track: technical

Scope boundary: Approach B — skill doc fix (criterion id form `S<story>.<ordinal>` in
`skills/remediate/SKILL.md` id contract + checklist, with when-it-applies guidance) plus two
small engine edits the skill cannot reach: (1) the no-admitted-gap halt detail enumerates the
rejected gap ids and the admission keys that were available; (2) prd_audit admission-map criterion
keys are normalized (uppercase) on insert so lookup is case-insensitive. Exact-match admission is
unchanged — no fuzzy id matching, fail-closed behavior preserved. Excluded: accepting
`FR-<criterion>` alias spellings (Approach C).

Internal remediation/admission machinery for the daemon pipeline; no product-facing behavior, so
no PRD — acceptance criteria live in stories.
