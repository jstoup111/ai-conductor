# Intake origin: build-review-accept-and-findings-refuse-every-stac

Source-Ref: jstoup111/ai-conductor#3448
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3448 digest=9ff8d77342325c04f79563b62bb5f19816dc46d3fc5508dce20c702a9f8eed98 >>>
## Desired outcome

- `build-review findings --feature <slug> --child <k>` lists child k's current findings, cases, and lap id for a stacked feature.
- `build-review accept` can accept a finding on a specific child of a stacked feature.
- When a required artifact is missing or malformed, both commands name the artifact and the reason instead of the generic "invalid or unavailable" message.
- Flat (non-stacked) features keep their current behavior.
<<< END INBOUND >>>
