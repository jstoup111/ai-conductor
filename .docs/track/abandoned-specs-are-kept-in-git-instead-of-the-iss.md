# Track: abandoned-specs-are-kept-in-git-instead-of-the-iss

Track: technical

Scope boundary: docs + migration, no new engine machinery. One canonical abandonment procedure
(delete DECIDE artifacts; the record is a closed GitHub issue) in a runbook, with the
daemon-triage skill and docs/reference/artifacts.md pointing to it. Migrate all 9 files under
.docs/retired/ (5 delivered + 4 abandoned) to a closed issue each and delete the directory.
Excluded: any conduct-ts abandon verb, any in-repo tombstone register.

Process/docs consolidation and artifact migration — no user-facing runtime behavior, so no PRD;
acceptance criteria live in stories. (Source: jstoup111/ai-conductor#1574.)
