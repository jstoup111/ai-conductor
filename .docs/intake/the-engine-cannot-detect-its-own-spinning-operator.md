# Intake origin: the-engine-cannot-detect-its-own-spinning-operator

Source-Ref: jstoup111/ai-conductor#1652
Owner: jstoup111

## Desired outcome

- The engine detects, during a build, that review/suite rounds are repeating rather than converging — at minimum: (a) the same test file or finding site failing N times across rounds, (b) finding substance recurring across laps under drifted keys, (c) kickback rate over a window — and halts needs-human with a rendered diagnosis (rounds, repeated sites, budget state) instead of running to a cap.
- The halt names what repeated, so the operator rules on substance immediately rather than reconstructing it from logs.
- A genuinely converging build (new sites each lap, findings resolving) is never interrupted by the detector.
