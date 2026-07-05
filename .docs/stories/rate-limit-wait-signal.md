**Status:** Accepted

# Stories: rate-limit wait signal for conduct-ts

Technical track (no PRD). Acceptance criteria derive from the technical intent of
ai-conductor#222 and the chosen approach: conduct-ts computes rate-limit wait
duration from the `claude` CLI output it already captures, rather than from the
hook-written `.pipeline/rate-limit-hit` marker (which in turn depends on the
never-written `.pipeline/conduct.log`).

Small tier ⇒ at least one negative path per story.

---

## Story: Engine parses wait seconds from the rate-limit error output

**Requirement:** Technical — provider-side parse

As the conductor engine, I want to extract the wait/reset duration directly from
the `claude` CLI's rate-limit error text, so that I can wait the correct amount
without relying on any externally-written log or marker file.

### Acceptance Criteria

#### Happy Path
- Given a rate-limit `output` containing `retry after 450 seconds`, when the provider
  parses it, then it yields `waitSeconds === 450`.
- Given an `output` containing `try again in 5 minutes`, when parsed, then the
  minutes-heuristic applies (a bare value `< 60` is treated as minutes) and it yields
  `waitSeconds === 300`.
- Given an `output` containing a future reset time such as `resets at 23:00` or a bare
  `resets 11pm`, when parsed, then it yields the whole-seconds difference between now
  and that future instant (and rolls to the next day when the clock time has already
  passed today).

#### Negative Paths
- Given a rate-limit `output` with no recognizable retry/reset phrase (or a nonsensical
  value like `retry after 0 seconds`), when parsed, then it returns the default `300`
  rather than `0`, a negative number, `NaN`, or throwing.

### Done When
- [ ] A pure parse function (e.g. `parseRateLimitWaitSeconds(output: string): number`)
      exists in `src/conductor/src/execution/` and is unit-tested for: `retry after N seconds`,
      minutes conversion (`< 60`), `resets HH:MM`, bare `am/pm`, past-time next-day rollover,
      and the unparseable → `300` default.
- [ ] The function never returns a value `<= 0` and never throws on arbitrary input.

---

## Story: Provider returns waitSeconds on the invoke result

**Requirement:** Technical — result contract

As the conductor engine, I want the `claude` provider to attach the parsed
`waitSeconds` to its `InvokeResult` whenever it flags `rateLimited`, so the wait
value travels with the same result object that already carries `rateLimited`.

### Acceptance Criteria

#### Happy Path
- Given a `claude` invocation that exits non-zero with rate-limit text carrying a
  reset time, when the provider returns, then the `InvokeResult` has
  `rateLimited === true` and a `waitSeconds` matching the parsed value.
- Given `InvokeResult` gains an optional `waitSeconds?: number` field, when the provider
  is not rate-limited, then `waitSeconds` is `undefined` (no behavioral change to
  non-rate-limited results).

#### Negative Paths
- Given a rate-limited invocation whose text has no parseable reset info, when the
  provider returns, then `rateLimited === true` and `waitSeconds === 300` (the default),
  so downstream never receives a rate-limit result with a missing/zero wait.

### Done When
- [ ] `InvokeResult` in `src/conductor/src/execution/llm-provider.ts` declares
      `waitSeconds?: number`.
- [ ] `ClaudeProvider.invoke` populates `waitSeconds` from the parse function on the
      rate-limited branch; a unit test drives a faked rate-limit `claude` output and
      asserts both `rateLimited` and the expected `waitSeconds`.

---

## Story: Conductor waits the parsed duration without depending on conduct.log or the hook marker

**Requirement:** Technical — decouple from bash-era signals

As the conductor engine, I want to derive the rate-limit wait from the provider's
`InvokeResult.waitSeconds`, so that rate-limit waits stay accurate even after
`bin/conduct` (and thus `.pipeline/conduct.log`) is removed in the v1.0 cutover (#226).

### Acceptance Criteria

#### Happy Path
- Given the step runner receives a `rateLimited` `InvokeResult` carrying `waitSeconds`,
  when it builds the step result, then it uses the provider's `waitSeconds` (it no longer
  reads `.pipeline/rate-limit-hit` to obtain the wait) and the conductor sleeps for that
  duration and retries without burning the retry budget.
- Given `.pipeline/conduct.log` does not exist anywhere in the run, when a rate limit
  occurs, then the computed wait still reflects the real reset time from the `claude`
  output (no silent degradation to a flat default).

#### Negative Paths
- Given a `rateLimited` result whose `waitSeconds` is somehow absent, when the conductor
  handles it, then it falls back to `300` (preserving today's `result.waitSeconds ?? 300`
  guard) and does not crash or wait `0`.

### Done When
- [ ] `step-runners.ts` no longer calls `readRateLimitWait()` / reads
      `.pipeline/rate-limit-hit` to source the wait; the value comes from the provider's
      `InvokeResult.waitSeconds`.
- [ ] `grep -rn "conduct.log" src/conductor/src` returns no reference used to source the
      rate-limit wait (the engine has no dependency on that file for this signal).
- [ ] An engine-level test proves a rate limit is waited accurately with no
      `.pipeline/conduct.log` and no hook-written `.pipeline/rate-limit-hit` present.
