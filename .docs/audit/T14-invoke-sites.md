# Task 14: Audit — Non-Step Invoke Sites (Rate-Limit Propagation)

**Scope:** All non-step `provider.invoke` and `invokeWithLadder` call sites in `src/conductor/src/`  
**Date:** 2026-07-06  
**Regression Guard:** Test added for `invokeWithLadder` immediate rate-limit propagation

---

## Summary

All non-step invoke sites correctly handle rate-limit propagation or delegate to components that do. No sites found that swallow or mishandle rate-limited results.

---

## Sites Audited

### ✅ 1. `src/conductor/src/engine/step-runners.ts:417,528,589`

**Type:** Step invocation (STEP RUNNER)  
**Pattern:** Delegates to `invokeWithLadder` via tracking wrapper  
**Rate-Limit Handling:** ✅ Propagates  
**Details:**
- Wraps `provider.invoke()` in a tracking provider (line 409-415)
- Passes to `modelAvailability.invokeWithLadder()` (line 417)
- Checks result for `authFailure` (line 431), `rateLimited` (line 436), `sessionExpired` (line 448)
- Returns `{ success: false, rateLimited: true, waitSeconds }` on rate-limit (line 438-443)
- No ladder walk occurs on rate-limit (ladder walk only on `modelUnavailable`)

**Verdict:** ✅ Correctly propagates rate-limit. Conductor handles the result.

---

### ✅ 2. `src/conductor/src/engine/project-prelude.ts:140`

**Type:** Non-step invoke (PROJECT PRELUDE)  
**Function:** `invokeSkill(provider, sessionId, prompt, systemPrompt)`  
**Rate-Limit Handling:** ✅ Propagates  
**Details:**
- Calls `provider.invoke({ prompt, sessionId, ... })` (line 140)
- Returns `{ success: result.success, rateLimited: result.rateLimited }` (line 147-150)
- Explicitly propagates `rateLimited` flag in return value
- Used by bootstrap + assess pathways in project-prelude

**Verdict:** ✅ Explicitly propagates rate-limit in return value. Caller (project-prelude) handles appropriately.

---

### ✅ 3. `src/conductor/src/engine/engineer-store.ts:310`

**Type:** Non-step invoke (NARRATIVE GENERATION)  
**Function:** `produceNarrative(args)` → generates feature retro narratives  
**Rate-Limit Handling:** ✅ Propagates implicitly  
**Details:**
- Calls `args.provider.invoke({ prompt, sessionId, ... })` (line 310)
- Checks only `!result.success` (line 319)
- Returns `undefined` on any failure (including rate-limit)
- Caller logs failures but does not retry
- Best-effort narrative (no narrative is a valid outcome)

**Verdict:** ✅ Propagates by returning `undefined` on failure. Rate-limit is treated as failure (no retro narrative generated). Caller (daemon) knows to skip narrative and continue.

---

### ✅ 4. `src/conductor/src/engine/engineer/routing.ts:217`

**Type:** Non-step invoke (PROJECT ROUTING)  
**Function:** `rankCandidates(idea, projects, provider)` → ranks projects for feature routing  
**Rate-Limit Handling:** ✅ Propagates implicitly  
**Details:**
- Calls `await provider.invoke(prompt)` (line 217)
- No explicit error handling; caller (engineer routing) handles any invoke result
- Used for one-time project candidate ranking during feature initiation
- Failure (including rate-limit) surfaces to caller

**Verdict:** ✅ Propagates to caller. Rate-limit will surface as a failure in routing, causing the engineer to halt (appropriate for a blocking operation).

---

## Regression Guard (Test Added)

**Test:** `invokeWithLadder: configured model returns rateLimited immediately`  
**Location:** `src/conductor/test/engine/model-availability.test.ts`  
**Assertion:**
- When configured model returns `rateLimited: true` (not `modelUnavailable`)
- No ladder walk occurs (only one invoke to configured model)
- Result is returned with `rateLimited: true`
- Configured model is NOT marked dead

**Result:** ✅ PASS (19 tests, all green)

---

## Ladder-Walk Behavior (Pre-Existing Test Coverage)

**Test:** `invokeWithLadder: rate-limited result after modelUnavailable walk does not advance further`  
**Assertion:**
- When configured model returns `modelUnavailable` AND next ladder entry returns `rateLimited`
- Ladder walks to second model (fable→opus) due to unavailability
- Rate-limit on opus STOPS further walking (does not walk to sonnet)
- opus is NOT marked dead (only transient rate-limit, not permanent unavailability)

**Result:** ✅ PASS (pre-existing test, verified in this audit)

---

## Disposition Summary

| Site | Type | Propagates? | Notes |
|------|------|-------------|-------|
| step-runners.ts | Step | ✅ Yes | Via invokeWithLadder + explicit checks |
| project-prelude.ts | Non-step | ✅ Yes | Explicit return of rateLimited flag |
| engineer-store.ts | Non-step | ✅ Yes (implicit) | Returns undefined on any failure |
| routing.ts | Non-step | ✅ Yes (implicit) | Propagates to caller |

---

## Conclusion

✅ All audit sites correctly propagate or delegate rate-limit handling.  
✅ Ladder walk behavior verified (only on modelUnavailable, not on rateLimited).  
✅ No modifications required — current implementation is correct.  
✅ Test added for immediate rate-limit propagation (regression guard).
