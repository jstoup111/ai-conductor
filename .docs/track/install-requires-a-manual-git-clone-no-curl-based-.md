# Track: one-line curl installer (jstoup111/ai-conductor#1712)

Track: product

Scope boundary: Balanced — a hosted bootstrap script that acquires the harness over public HTTPS into a canonical location and runs the existing `bin/install`; prerequisite checks before any mutation; `--channel` / `--providers` pass-through via flags and environment; refusal of a pre-existing target directory that is not an ai-conductor checkout; re-run hands off to the existing update path; an end-to-end test of the script; README and Quickstart lead with the one-liner. Excluded: versioned/checksummed release assets, an install-location override, an uninstall one-liner, and any non-git (tarball) acquisition path.

Changes the primary install experience for every new consumer and machine, so requirements belong in a PRD.
