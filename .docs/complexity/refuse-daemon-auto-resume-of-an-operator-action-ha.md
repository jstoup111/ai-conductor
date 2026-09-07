# Complexity: Refuse daemon auto-resume of an operator-action halt class

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

The change adds one classification veto to two existing eligibility decisions and one log line naming the disposition that blocked each. It reuses the shipped classifier and reader without extending them, introduces no new event variant, marker, sidecar, config key, CLI verb, or state, and changes no retry budget, ceiling, or ordering. Two production files are touched — the daemon loop's bounded progress-re-kick wrapper and the daemon CLI's dependency wiring plus its episode-end sweep — with the runbook's two affected paragraphs updated alongside. The wider audit of build-stall exit stamping, inherited-halt pre-dispatch enforcement, halt-clear attribution, and operator recovery verbs is not part of this slice. Small-tier architecture, conflict-check, and coherence artifacts are not required.
