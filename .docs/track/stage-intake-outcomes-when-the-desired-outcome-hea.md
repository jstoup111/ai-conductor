# Track: Stage intake outcomes when the Desired-outcome heading is plural

Track: technical

Scope boundary: Small fix for #1528, approved by the operator on 2026-09-06 (delegated). The slice covers exactly one thing — the intake staging extractor recognizes the Desired-outcome section heading whether its final word is singular or plural, and the staged file keeps the canonical shape downstream readers already parse. Resolving an issue body for a source ref that has no usable claim record, and rewording the coherence refusal that surfaces an unstaged outcome layer, are both outside this slice: they are the delivered scope of the sibling spec for #1340. Normalizing the heading at issue-filing time, accepting deeper heading levels or letter-case variants, and any change to the coherence gate or the committed intake marker are also excluded.

This is an engine defect correction with no product requirements; acceptance criteria live in technical stories rather than a PRD.

The operator's delegate chose accepting both heading forms in the reader over rejecting or rewriting the issue at file time, on 2026-09-06 (delegated): the failure is silent and surfaces a full DECIDE phase later, so tolerating the variant the filer already wrote costs one character of pattern and no new gate, while a file-time guard would need a new enforcement surface and could not repair the five issues already filed with the plural form.

Scope check: A — consumer-facing engine behavior; the intake staging path is not self-host, daemon, or release-gate machinery, and any repository that installs the harness and files GitHub intake issues gets the same defect. B — n/a, no new skill. C — provider-agnostic; no provider, model, or host surface is touched. No catalog registration is required.

Verified foundation: the extractor in outcome-staging.ts locates the section with a pattern whose literal final word is singular, so a plural heading yields no section and the writer falls back to an empty canonical heading; the writer always emits the canonical singular heading, and both the staged-file reader and the committed-marker extractor parse that canonical form, so normalization on write keeps every downstream reader unchanged. A scan of the 500 most recent issues in this repository found 466 singular headings, 4 plural, and 1 deeper-level heading, confirming the variant is live and rare rather than hypothetical.
