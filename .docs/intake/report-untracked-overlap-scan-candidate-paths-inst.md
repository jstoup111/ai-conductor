# Intake origin: report-untracked-overlap-scan-candidate-paths-inst

Source-Ref: jstoup111/ai-conductor#875
Owner: jstoup111

## Desired outcome
- A scan invocation whose --files list mixes existing and nonexistent paths still reports every overlap/blocker finding for the existing paths.
- Nonexistent paths are surfaced explicitly (per-path notice such as "not in tree — skipped"), so a planned-new file is visibly excluded rather than silently voiding the report.
- A clean report is only printed when the scan actually evaluated every existing path; scanning zero existing paths is distinguishable from a genuine all-clear.
