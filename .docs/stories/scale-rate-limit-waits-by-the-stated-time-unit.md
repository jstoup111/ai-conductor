**Status:** Accepted

# Stories: Scale rate-limit waits by the stated time unit (#2168)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is the duration branch of the Claude and Codex provider adapters. Reset-time and timezone parsing, rate-limit classification, and the episode coordinator's escalation ladder remain outside this slice.

## Story 1: Derive waits that honour the stated time unit

As an operator whose daemon hit a provider rate limit, I want the wait to match the duration the provider actually stated so the run sleeps through the window instead of re-hitting the limit dozens of times.

### Acceptance Criteria

#### Happy Path

- Given a Claude rate-limit message states "Please retry after 450 seconds", when the provider derives its wait, then the wait is 450 seconds.
- Given a Claude rate-limit message states "try again in 2 hours", when the provider derives its wait, then the wait is 7200 seconds.
- Given a Claude rate-limit message states "retry after 90 minutes", when the provider derives its wait, then the wait is 5400 seconds.
- Given a Codex rate-limit message states "rate limit exceeded; retry after 90 minutes", when the provider invoke result reports its wait, then the wait is 5400 seconds.

#### Negative Paths

- Given a rate-limit message states a non-positive duration such as "retry after 0 minutes", when the provider derives its wait, then the wait is that call's existing default rather than a zero-length or negative wait.

### Done When

- [ ] Claude duration fixtures return 7200 for an hour-phrased message and 5400 for a minute-phrased message.
- [ ] A Codex invoke fixture whose stderr carries a minute-phrased retry reports 5400 rather than the 300-second fallback.
- [ ] Every pre-existing second-phrased fixture on both adapters returns its stated second value unchanged.

## Story 2: Bound a wait whose unit is absent or unrecognized

As an operator, I want an unparseable or unit-less duration to produce a conservatively long wait rather than a fast retry, so an unfamiliar phrasing degrades into sleeping too long instead of hammering the limit.

### Acceptance Criteria

#### Happy Path

- Given a Claude rate-limit message states a bare number with no unit such as "retry after 45", when the provider derives its wait, then the number is read as minutes and the wait is 2700 seconds.
- Given a Claude rate-limit message states a bare number whose minute reading exceeds one hour such as "retry after 450", when the provider derives its wait, then the wait is capped at 3600 seconds.

#### Negative Paths

- Given a Claude rate-limit message states a bare number whose minute reading is below the existing default such as "retry after 2", when the provider derives its wait, then the wait is 300 seconds rather than 120 seconds.
- Given a Claude rate-limit message states an unrecognized unit such as "retry after 3 fortnights", when the provider derives its wait, then the wait is 300 seconds rather than a scaled reading of that number.
- Given a Codex rate-limit message states an unrecognized unit such as "retry after 3 fortnights", when the provider invoke result reports its wait, then it reports that call's existing fallback wait rather than a scaled reading of that number.

### Done When

- [ ] Claude bare-number fixtures return 300 below the floor, the minute-scaled value inside the band, and 3600 at the ceiling.
- [ ] A Claude fixture carrying an unrecognized unit word returns 300, and a Codex fixture carrying one reports its unchanged fallback wait.
- [ ] No wait derived from an absent or unrecognized unit is shorter than 300 seconds or longer than 3600 seconds.

## Negative-category review

Invalid input is the dominant category here and is covered in depth: non-positive values, bare numbers above and below the inferred band, and unrecognized unit words each have a criterion, on both adapters where both can reach the phrasing. Resource exhaustion is the failure this slice exists to prevent — a mis-scaled short wait re-hits the account limit — and the bounded inferred band plus the honoured explicit unit are its guards. Timeouts and dependency unavailability are inapplicable: this code performs no call and reads only a string already captured from a completed process. Auth failures, concurrent access, partial failure and rollback, data integrity, cascade deletion, immutability, and idempotency are inapplicable: the derivation is a pure function of one message with no shared state, no persistence, and no side effect. Exception-hierarchy coverage is inapplicable because the existing outer guard already collapses any thrown error to the default wait and that guard is unchanged.
