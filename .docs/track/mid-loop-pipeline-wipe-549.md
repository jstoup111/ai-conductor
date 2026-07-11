# Track: mid-loop-pipeline-wipe-549

Track: technical

Engine crash + state-durability bug fix in the conductor (ai-conductor#549). No
user-facing product behavior — the deliverable is (a) a root-cause regression test
pinning the finish→build kickback transition, (b) crash-proofing every `.pipeline`
bookkeeping read/write against a missing file, and (c) scoping any kickback/teardown
cleanup to its own artifacts, never the shared `.pipeline` root. Acceptance criteria
live directly in the stories; there are no product requirements to spec, so no PRD.
