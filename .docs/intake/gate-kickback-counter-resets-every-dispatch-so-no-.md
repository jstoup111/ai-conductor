# Intake origin: gate-kickback-counter-resets-every-dispatch-so-no-

Source-Ref: jstoup111/ai-conductor#984
Owner: jstoup111

## Desired outcome

- A gate that fails twice with the same reason, over the same source state, stops the feature
- "Same source state" is judged by something a no-op commit cannot falsify: a feature that fails,
- A run that genuinely changes the source between attempts still gets a fresh budget and is not
- When the limit trips, the resulting HALT names the repeated gate and its recurring failure
- Negative path: a step that is legitimately nondeterministic still gets its bounded retries —
- Observable: replaying tonight's scenario halts within two laps instead of looping until killed.
