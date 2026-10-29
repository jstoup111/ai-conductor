# Intake origin: routed-remediation-skips-re-run-steps-on-stale-chi

Source-Ref: jstoup111/ai-conductor#3455
Owner: jstoup111

<<< INBOUND sourceRef=jstoup111/ai-conductor#3455 digest=d089df93d564570e32a3a54a8ff5139713dff814a41f9aa7000ed53840b33e25 >>>
## Desired outcome

- After a routed round re-pends a host child's region steps, every one of those steps actually runs again for that child. None is skipped because of a verdict recorded before the round was admitted.
- A routed repair build is always followed by a fresh `test_suite` and `build_review` run on the host child, and both appear in the daemon log.
- A dispatch never ends with "loop ended without DONE or HALT marker" because routed selection found nothing admissible. If it cannot proceed, it writes a HALT that names the routed round and the reason.
- Verdicts from steps that were genuinely completed within the current round are still honored, so finished work is not redone after a resume.
<<< END INBOUND >>>
