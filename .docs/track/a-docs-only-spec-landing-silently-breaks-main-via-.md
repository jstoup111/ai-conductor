# Track: A docs-only spec landing silently breaks main via pinned PRD-audit corpus maxima

Track: technical

Scope boundary: every default-suite test whose outcome depends on the live repository `.docs/`
corpus (PRD-audit, remediation, and as-built projection limit checks; the ADR decision-corpus
checks; the ADR approval-corpus check; the KPI report's pinned shipped-record fixtures) runs on a
docs-only pull request and asserts admission rather than equality with recorded maxima; the
PRD-audit coherence and PRD-intent limits gain headroom so a normal new largest artifact does not
breach them. Excluded: running the full conductor suite on docs-only PRs, post-merge CI on main,
and a land-time projection-limit gate in `compose land`.

Repository-internal CI and test machinery with no user-facing behavior; acceptance criteria live in
stories (source: jstoup111/ai-conductor#3130).
