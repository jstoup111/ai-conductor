**Status:** Accepted

# Retro Follow-ups — Per-step provider routing (#927)

Track: technical. Source: 2026-07-25 retrospective for PR #935.

## Story RF-927-1: Missing cost telemetry is visibly incomplete

As an operator, I want a shipped feature with a missing event ledger to be marked
unmetered so that a clean zero-cost record cannot hide absent accounting.

### Acceptance Criteria

#### Happy Path

- Given a feature with a readable event ledger containing no dispatch events,
  when its shipped cost record is generated, then the record reports zero
  dispatches and zero unmetered dispatches because the observed ledger is
  genuinely empty.

#### Negative Paths

- Given a feature whose event ledger does not exist, when its shipped cost
  record is generated, then the record is still written but carries a
  machine-readable incomplete/unmetered marker whose count is greater than zero.
- Given a feature whose event ledger cannot be read, when its shipped cost
  record is generated, then the read failure is not represented as a clean
  all-zero rollup and shipping remains non-blocking.
- Given a missing-ledger regression test, when the generated Cost block contains
  `unmetered.count: 0`, then the test fails even though the word `unmetered`
  appears in the block.

### Done When

- [x] The missing-ledger acceptance test asserts a non-zero incomplete/unmetered
      value rather than matching only the field name.
- [x] `computeCostRollup` distinguishes a readable empty ledger from an absent
      or unreadable ledger.
- [x] `conduct kpi` marks the resulting shipped record incomplete and excludes
      it from clean aggregate cost claims.

## Story RF-927-2: Provider candidate execution stays reviewable

As a maintainer, I want provider candidate orchestration split into bounded
units so that fallback, session, attribution, and warning changes can be
reviewed independently without changing behavior.

### Acceptance Criteria

#### Happy Path

- Given the existing provider-routing acceptance suite, when candidate
  execution is decomposed, then candidate ordering, provider-native settings,
  session handling, attribution, and fallback warnings remain byte-for-byte
  equivalent at public result and event boundaries.

#### Negative Paths

- Given authentication, rate-limit, session-expiry, or ordinary failure, when
  the decomposed candidate executor handles the result, then it does not advance
  to another provider.
- Given a cached run-wide provider failure or complete native model exhaustion,
  when the decomposed executor advances candidates, then attempt metadata and
  transition warnings retain the original causal order.
- Given an exception after a live invocation starts, when the decomposed
  executor propagates it, then same-step retry continuity is preserved and a
  cached skip is not marked as a created session.

### Done When

- [x] The candidate loop delegates native-config resolution, invocation/session
      handling, and attempt-result construction to separately testable helpers.
- [x] No extracted function combines more than one of those responsibilities.
- [x] The 26 provider-routing acceptance scenarios and focused provider
      execution/session suites pass unchanged.
