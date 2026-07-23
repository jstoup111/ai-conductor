# Track: wiring_check retries on evidence it invalidated itself (#897)

Track: technical

Engine-internal correctness fix to the `wiring_check` completion predicate's evidence-freshness
check (`src/conductor/src/engine/artifacts.ts`). No user-facing product surface, no new
capability — acceptance criteria live directly in the stories.
