# Track: build_review / ci_watch partial-block preservation (#1002)

Track: technical

Internal config-validator normalization bug. No user-facing product requirements and no new
product surface — the only externally visible change is that two already-documented config keys
start working and that malformed keys warn instead of silently dropping siblings. Acceptance
criteria live in the stories.
