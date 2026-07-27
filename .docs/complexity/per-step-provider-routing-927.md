# Complexity: Per-Step Provider Routing (#927)

**Date:** 2026-07-24
**Tier:** L
**Status:** Approved

## Rationale

The feature crosses public configuration, registry-aware validation,
provider-native model resolution, retry escalation, model and provider
availability, interactive completion classification, step/provider session
ownership, serial and concurrent orchestration, daemon and inline composition
roots, auxiliary invocation paths, events, usage accounting, reports, and
documentation.

The highest risks are partial wiring, cross-provider native-setting leakage,
cross-step/provider session resume, failure misclassification, and scalar
configuration regression. The accepted plan therefore uses dedicated selection,
runtime, session, and execution abstractions with all-path wiring coverage.

## Decision

The operator approved Large tier during the #927 DECIDE phase on 2026-07-24.
