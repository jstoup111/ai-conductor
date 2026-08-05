# Intake origin: no-release-time-smoke-or-eval-gate-releases-cut-wi

Source-Ref: jstoup111/ai-conductor#1259
Owner: jstoup111

## Desired outcome

- Running one documented command executes the entire smoke tier; a maintainer does
- Cutting a release cannot succeed while the smoke tier is failing — a smoke
- A smoke file that is added to the repository is picked up by that gate without
- There is a signal that exercises the pipeline against a real agent (not a
- Its failures are attributable: when the gate blocks, the output identifies which
- A release whose smoke tier requires credentials that are unavailable reports that
