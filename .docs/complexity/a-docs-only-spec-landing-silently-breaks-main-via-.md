# Complexity: docs-only spec landings break main via pinned corpus maxima (#3130)

Tier: S

Rationale: one concern — tests whose verdict depends on the live `.docs/` corpus are skipped by
docs-only CI and pin equality with recorded maxima. The fix regroups those existing assertions
into one test tier, relaxes two equality assertions to admission, re-records the PRD-audit maxima
from the corpus at BUILD (as the governing decision already prescribes), and adds one docs-only
CI job wired into `ci-gate`. No new models, integrations, auth surface, state machines, or
production behavior beyond the recorded maxima; no ADR is needed because the 2026-09-30 PRD-audit
architecture review (decision 1) already prescribes corpus-derived constants that fit the largest
normal input observed at BUILD. Expected 2 stories. Skips (per Tier S): architecture-diagram,
architecture-review, conflict-check, coherence-check. Technical track: no PRD.

Approach selected (explore): a live-corpus test tier asserted by admission and run on docs-only
PRs. Rejected: admission-only assertions (a genuine overflow still breaks main unseen); running
the full conductor suite on every `.docs/` PR (multi-shard cost on many spec landings a day for a
handful of corpus checks); a `compose land` limit gate alone (misses hand-made docs PRs and the
ADR-corpus checks).
