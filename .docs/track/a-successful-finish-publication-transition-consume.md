# Track: A successful FINISH publication transition consumes a retry

Track: technical

Engine retry-accounting correctness inside the FINISH publication coordinator. Forward
progress and genuine failure currently share one counter, so a fully-successful ship
arrives at its retry ceiling with no margin. No user-facing product capability is added
and no operator-facing command or flag changes — acceptance criteria live directly in the
stories, so there is no PRD.
