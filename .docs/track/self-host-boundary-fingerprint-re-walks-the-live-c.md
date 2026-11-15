# Track: Self-host boundary fingerprint re-walks the live checkout per reviewer

Track: technical

Scope boundary: one self-host step dispatch (for `build_review`, one lap) shares one live-boundary snapshot across all of its provider candidates, including baseline preparations: the live checkout is fingerprinted once and verified once per dispatch, each distinct provider home is fingerprinted once and verified once per dispatch, and one fingerprint event is emitted per snapshot taken. Excluded: sharing snapshots across dispatches or features, any change to the exclusion lists, any change to what counts as drift or to containment semantics, and moving the fingerprint log line to another level.

Internal engine efficiency and log-noise fix with no user-facing capability; chosen approach is a dispatch-scoped, reference-counted shared snapshot whose single verification runs after the dispatch has ended and its last candidate has torn down (source: intake jstoup111/ai-conductor#3621).
