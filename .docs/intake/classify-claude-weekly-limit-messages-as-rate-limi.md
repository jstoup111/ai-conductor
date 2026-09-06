# Intake origin: classify-claude-weekly-limit-messages-as-rate-limi

Source-Ref: jstoup111/ai-conductor#1006
Owner: jstoup111

## Desired outcome
- A step that fails solely because of a provider rate limit does not lose retry budget for it — the
  budget remains available for genuine failures.
- Hitting a rate limit does not terminate the feature; the run waits for the condition to clear (as
  the existing credential park-and-poll recovery does) or ends in a state an operator can resume
  without hand-clearing a HALT.
- Retries against a condition with a known future reset time are not issued immediately in a tight
  loop — attempts are spaced against when the condition can actually clear.
- Negative path: an ordinary step failure still consumes budget and still halts on exhaustion; this
  must not become a blanket "never exhaust retries".
- Negative path: a rate-limit condition that never clears still terminates eventually rather than
  waiting forever, with a reason naming the limit.
- Observable: replaying the log excerpt above yields no `retries exhausted` halt attributable to the
  limit, and the step's attempt counter is unchanged by it.
