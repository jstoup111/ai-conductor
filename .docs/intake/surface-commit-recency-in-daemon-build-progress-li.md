# Intake origin: surface-commit-recency-in-daemon-build-progress-li

Source-Ref: jstoup111/ai-conductor#1715
Owner: jstoup111

## Desired outcome
- The daemon's per-feature progress line (and/or a periodic log line) surfaces recent commit activity — e.g. the age of the newest branch commit or commits-in-last-N-minutes — alongside the task counter, so a pinned counter with fresh commits reads as working.
- The "build quiet" warning treats recent commits as activity: it fires only when both the log AND the branch are quiet, or it names commit recency so the operator can tell the two apart.
- No new polling channel outside the spine for this signal.
