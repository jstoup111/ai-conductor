# Intake origin: make-every-gate-verdict-recoverable-from-the-event

Source-Ref: jstoup111/ai-conductor#2067
Owner: jstoup111

## Desired outcome
- A gate's verdict — pass or fail, with its reason — is recoverable from `.pipeline/events.jsonl`
  after the run, for every gate including `prd_audit`.
- An operator watching the daemon log can tell whether a gate passed without opening a report
  artifact, and without inferring it from the absence of a kickback.
- A signal that reads as "passed" means the gate passed: the provider-completion marker, the
  report's summary line, and the gate verdict are visually distinguishable from one another.
- A report whose summary says PASS while rows route work back to build states that plainly.
- A gate that audits story criteria rather than a PRD is not named in a way that implies a PRD was
  consulted.
