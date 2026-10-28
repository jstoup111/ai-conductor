# Intake origin: closeout-timing-events-record-wrong-units-inflatin

Source-Ref: jstoup111/ai-conductor#2049
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#2049 digest=41011c6bb0e0f66bcafabde0983af8a2ad65cd7becfbfd33eb51f355832c20ce >>>
## Desired outcome

- A recorded closeout obligation's duration matches its real wall-clock elapsed time, for every obligation and every pipeline session.
- A closeout record whose timestamps cannot be trusted never reaches an aggregate — it is rejected or reported as unavailable, never summed as if it were measured.
- `build-tail`'s rollup and the daemon log line report the same duration for the same obligation, and a two-minute evaluator pass reads as roughly two minutes.
- A caller that supplies no timing, malformed timing, or timing in the wrong unit cannot cause a plausible-looking wrong number to be recorded.
<<< END INBOUND >>>
