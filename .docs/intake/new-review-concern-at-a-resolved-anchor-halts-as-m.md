# Intake origin: new-review-concern-at-a-resolved-anchor-halts-as-m

Source-Ref: jstoup111/ai-conductor#2464
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2464 digest=315765da70ae78b29845c2d9c8151169cf683cd6f9089b56edd5e7f9dceb4dbb >>>
## Desired outcome

- A newly identified concern at a previously reviewed test anchor receives an actionable disposition without a false malformed-store halt.
- A truly recurring or regressed concern retains its prior case history and the applicable retry limits; a new case must not silently bypass those limits.
- A rejected proposed transition is distinguishable from corrupt persisted history, with enough evidence for the operator to recover.
- Recovery preserves applied effects and resolved-case evidence and does not require clearing history or accepting unresolved findings.
<<< END INBOUND >>>
