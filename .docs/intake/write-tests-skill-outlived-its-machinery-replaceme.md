# Intake origin: write-tests-skill-outlived-its-machinery-replaceme

Source-Ref: jstoup111/ai-conductor#1389
Owner: jstoup111

## Desired outcome

- A single decision is recorded on whether `write-tests` is superseded, partially superseded, or still needed — with the specific machinery named for each section it claims to replace.
- Whatever the decision, provider parity holds: a repository-local skill is discoverable from every supported host, or from none, never from one.
- If it is removed, no committed artifact still points at a path that does not exist — including `AGENT_INSTRUCTIONS.md`, `scope-check`, and the merged plans that cite it as their test contract.
- If it is kept, the sections machinery already enforces are cut, so the skill only carries judgment a gate cannot make.
- Negative path: the test-authoring conventions that are *not* machine-enforced (seam selection, avoiding false integration tests, faithful fakes at third-party boundaries) remain binding and reachable from every host — removal must not quietly drop them.
