# halt-issues fixtures

`monitor-log-real.txt` — lines 1–162 are a verbatim excerpt of the operator-local
`~/.ai-conductor/halt-monitor/monitor.log`, captured 2026-07-09. It spans every
`HALT <slug> -> filed #N` verdict on record at capture time (the 11 historical
issues #297, #300, #302, #354, #358, #385, #386, #403, #407, #415, #416), plus
the surrounding `NEW HALT` ISO-timestamp lines, `covered by` verdicts, and
non-verdict `RESULT:`/`TRIAGE INCOMPLETE` noise lines exactly as logged.

The trailing block marked `SYNTHETIC` is hand-added (not verbatim log content):
a single RESULT line embedding two verdicts, and a malformed `HALT -> filed #`
line. These edge cases do not occur naturally in the captured excerpt but are
required by the story's negative-path acceptance criteria. Fake slugs/issue
numbers use the 9xx range so they can never collide with a real filed issue.
