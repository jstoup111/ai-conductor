# Intake origin: carry-daemon-cli-flags-across-stale-engine-restart

Source-Ref: jstoup111/ai-conductor#2366
Owner: jstoup111

## Desired outcome
- A flag passed to `ai-conductor daemon` still governs the daemon after a stale-engine auto-restart,
  for the life of that daemon process lineage.
- The reported source of each setting after a restart matches the source before it — an operator
  reading the scan line sees `source flag` continue to say `source flag`.
- If a restart genuinely cannot carry an operator setting forward, the daemon says so explicitly at
  the point of restart, naming the setting and the value it fell back to, rather than logging a
  normal-looking scan line.
- Config-sourced settings continue to work unchanged when no flag was passed.
