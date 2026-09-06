# Intake origin: scale-rate-limit-waits-by-the-stated-time-unit

Source-Ref: jstoup111/ai-conductor#2168
Owner: jstoup111

## Desired outcome
- Waits derived from provider messages respect the stated unit (seconds, minutes, hours).
- Unrecognized phrasings fall back conservatively (longer wait), never to a fast retry.
