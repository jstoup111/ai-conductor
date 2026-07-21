# Track: noevidenceattempts-persists-across-unpark-so-re-di

Track: technical

## Rationale

Pure engine-behavior bug fix (issue jstoup111/ai-conductor#667). No user-facing product
requirements: the change alters how the daemon's evidence-budget counter interacts with the
operator park/unpark lifecycle and makes the halt message truthful. Acceptance criteria live
in the stories; no PRD is required on the technical track.
