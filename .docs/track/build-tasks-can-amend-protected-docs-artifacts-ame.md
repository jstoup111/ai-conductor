# Track: BUILD tasks can amend protected .docs artifacts; amendments belong to DECIDE

Track: technical

Refs: jstoup111/ai-conductor#1293

Harness-internal contract and tooling change: DECIDE gains a sanctioned act for amending
already-accepted `.docs/` artifacts, and a deterministic authoring-time check rejects any plan
task that assigns such an amendment to BUILD. No user-facing product surface, so acceptance
criteria live directly in the stories.
