# Intake origin: nothing-proves-a-faithful-fake-still-matches-its-r

Source-Ref: jstoup111/ai-conductor#1990
Owner: jstoup111

## Desired outcome

- A behavioral divergence between a fake and its real counterpart at any external boundary is detectable by running an existing, named test target.
- The default suite and CI remain free of real external calls; the real-side check stays explicitly opt-in.
- When the real-side check fails, the output identifies which boundary and which contract expectation diverged.
