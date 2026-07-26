# Complexity: First-Class Codex Harness Skills and Guidance (#904)

**Date:** 2026-07-25
**Tier:** M
**Status:** Approved

## Rationale

The feature changes three bounded integration seams: provider-native lifecycle invocation in the
existing candidate loop, ownership-safe installation and migration for the Codex skill catalog,
and shared host-compatible skill/guidance contracts. It adds no service, datastore, schema,
external integration, authentication policy, or new runtime state machine. Thirteen stories and
their negative paths require Medium-tier architecture, conflict, coherence, acceptance-spec, and
pipeline gates, but the approved design avoids a plugin system, generated provider trees, provider
runtime redesign, legacy `bin/conduct`, and the separately tracked #905/#906/#759 surfaces.

The operator approved Medium tier during the #904 DECIDE phase on 2026-07-25.
