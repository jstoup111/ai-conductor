# Intake origin: operator-command-to-inspect-and-recover-wedged-rou

Source-Ref: jstoup111/ai-conductor#3459
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3459 digest=05403e7eb319c6c7e5cfadf3e112f520526b76303e64c73f187b0030fc32ca2e >>>
## Desired outcome

- A routed round is never admitted in a way that leaves an earlier open round unable to advance. Either at most one round is open per feature, or open rounds are processed in an order where admission cannot deadlock.
- When stack preflight cannot proceed, the run always writes a HALT naming the routed round and the reason. The daemon never reports "loop ended without DONE or HALT marker" for this path.
- An operator has a supported, documented way to recover a feature whose routed rounds are wedged, without editing `refs/conductor/*` by hand.
- Features with a single open round keep advancing exactly as they do today.
<<< END INBOUND >>>
