# Track: rate-limit wait signal for conduct-ts

Track: technical

Internal engine plumbing fix (ai-conductor#222): conduct-ts must compute rate-limit
wait duration from its own signal instead of the never-written `.pipeline/conduct.log`.
No user-facing behavior — acceptance criteria live directly in the stories.
