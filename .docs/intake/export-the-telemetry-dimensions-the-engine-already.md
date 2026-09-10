# Intake origin: export-the-telemetry-dimensions-the-engine-already

Source-Ref: jstoup111/ai-conductor#1940
Owner: jstoup111

## Desired outcome

- A consumer can attribute exported telemetry to the feature it came from, using the telemetry
  alone.
- A consumer can attribute it to the responsible GitHub user.
- Provider is a dimension on exported telemetry, and a dispatch that fell back from one provider
  to another is distinguishable from one that did not, with the reason available.
- Model and reasoning effort are both dimensions, on duration and retry data as well as token
  data, so the cost/latency effect of an effort or model change is chartable.
- Usage detail the engine already computes is exported rather than discarded — at minimum
  reasoning-output volume, turn count, provider-reported duration, and whether cost came from the
  provider or the rate card.
- Metered and unmetered dispatches are distinguishable.
- Complexity tier is a dimension.
- Adding a dimension does not multiply metric series without bound; a documented decision exists
  for which dimensions are series labels and which are trace-only.
- The dimension set is extensible: adding the next one does not require touching a hardcoded list
  in more than one place.
