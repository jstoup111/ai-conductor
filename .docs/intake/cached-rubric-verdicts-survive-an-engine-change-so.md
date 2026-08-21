# Intake origin: cached-rubric-verdicts-survive-an-engine-change-so

Source-Ref: jstoup111/ai-conductor#1759
Owner: jstoup111

## Desired outcome

- A cached rubric verdict produced by a different engine build is not served; that rubric re-judges
  and the lap records a fresh result.
- After a rubric-behavior change ships, the next dispatch reflects it with no operator action and no
  hand-deletion of cache files.
- A cached verdict from the same engine over the same projection is still served, so the cache keeps
  its value.
- When a cached verdict is discarded because the engine changed, the daemon log says so, naming the
  rubric — a silent re-dispatch and a silent replay must not look alike.
- An operator has a supported command to discard cached rubric verdicts for a feature.
