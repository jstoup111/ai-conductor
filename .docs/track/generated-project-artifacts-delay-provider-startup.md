# Track: Generated project artifacts delay provider startup

Track: technical

Scope boundary: Project-declarable fingerprint exclusions for the **live checkout** surface only,
with engine-enforced validation that a declared path cannot remove source, configuration, hooks,
credentials, or the declaration itself from boundary protection, plus a fingerprint-duration
signal on the existing event spine. Explicitly excluded: declarable exclusions for the
**provider-state** surface (a leak detector, where an exclusion trades away real detection), and
any per-surface or slowest-paths diagnostic breakdown beyond the duration signal.

> **Amended 2026-09-21 by #1219:** the scope boundary is now the **fingerprint-duration signal
> alone**. The declarable-exclusion mechanism is removed from this feature. The pre-stories
> architecture review returned BLOCKED on two grounds — it contradicts APPROVED
> `adr-2026-08-17-structural-live-checkout-containment` D4 ("no exclusion is added"), and the
> latency premise is falsified by measurement (the generated tree costs ~20 ms of a 410 ms walk;
> `node_modules` and the provider home's `projects/` were both already excluded before the
> 2026-07-31 incident). The operator selected resolution R-1 on 2026-09-21: ship the diagnostic,
> defer the declaration mechanism until the emitted duration attributes the cost. Issue #1219
> remains open, narrowed. See
> `.docs/decisions/architecture-review-2026-09-21-generated-project-artifacts-delay-provider-startup.md`.

Engine/infra guardrail change to the self-host live-boundary fingerprint: no user-facing product
behavior, so acceptance criteria live directly in stories and no PRD is authored. The operator-
facing config key is a harness configuration surface, not a product capability.
