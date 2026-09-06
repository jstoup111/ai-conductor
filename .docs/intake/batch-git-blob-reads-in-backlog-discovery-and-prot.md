# Intake origin: batch-git-blob-reads-in-backlog-discovery-and-prot

Source-Ref: jstoup111/ai-conductor#2065
Owner: jstoup111

## Desired outcome
- An idle daemon poll's backlog scan completes in well under a second on this repo's current corpus (~300 ADRs, ~340 plans), with scan results unchanged.
- Backlog discovery cost no longer scales as one process spawn per artifact read.
- The rebase/reseal protected-artifact read never spawns an unbounded number of concurrent git processes, regardless of corpus size.
