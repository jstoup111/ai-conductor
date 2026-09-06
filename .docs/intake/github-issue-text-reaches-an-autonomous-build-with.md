# Intake origin: github-issue-text-reaches-an-autonomous-build-with

Source-Ref: jstoup111/ai-conductor#1479
Owner: jstoup111

## Desired outcome

- Text originating from a tracker issue is distinguishable from operator-authored instruction at the point it is consumed, and instruction-shaped content inside it does not alter the phase's behavior.
- An issue body containing directive-shaped prose produces the same DECIDE behavior as one describing the same problem neutrally.
- When inbound content is neutralized, altered, or refused, that fact is recorded where the operator can see it after the fact.
- The protection holds for every writer to this path, including automated filers, not only for human-filed issues.
- Ordinary technical issue content — stack traces, code fences, shell transcripts, quoted log lines — still survives intact and usable as evidence.
