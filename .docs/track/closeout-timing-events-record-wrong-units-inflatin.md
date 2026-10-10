# Track: closeout timing events record wrong units (#2049)

Track: technical

Scope boundary: every desired outcome of intake jstoup111/ai-conductor#2049 — closeout timestamps are stamped by the recording command rather than supplied by the caller, and every reader of a closeout record (build-tail rollup, daemon log line, terminal UI, OTel export) applies one shared trust check so an untrustworthy record is reported as unavailable instead of being rendered or summed. Excluded: rewriting or backfilling closeout records already on disk, adding new closeout obligations, enforcing the gate for obligations other than evaluator, and any latency-reduction work.

Engine/CLI telemetry correctness fix with no product surface beyond an internal pipeline-skill command; acceptance criteria live in stories, no PRD.
