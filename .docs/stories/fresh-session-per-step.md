**Status:** Accepted

# Stories: Fresh Session Per Step (ai-conductor#325)

Technical track, Small tier. Acceptance criteria live here (no PRD). Each story states
observable behavior at the session-dispatch seam and is asserted **structurally** (by
inspecting the session id / resume flag the conductor hands the provider), never by
convention. Source intent: the conductor must start each step in a session with no prior
step's turns present, so a step reasons from the artifact seam rather than inherited
conversational context.

Design decisions this file assumes (see `.docs/track/fresh-session-per-step.md`,
`.memory/decisions/fresh-session-per-step-approach.md`):
- Approach A — the opt-in `freshContextPerStep` flag is removed; the session reset that
  is currently gated on it (`conductor.ts:1114`) becomes unconditional.
- Within-step retry-resume is preserved (the reset already fires once *before* the
  `while (attempt…)` retry loop).
- Interactive carve-out — if unconditional fresh breaks the inline `/conduct` design REPL,
  a shared session may be retained **for interactive REPL steps only**; autonomous /
  print-mode steps always get fresh sessions.

---

## Story: Every step boundary starts a fresh session, all phases, unconditionally

**Requirement:** Fresh-per-step is the default behavior for every step in `ALL_STEPS`,
front half (`assess…plan…architecture_review`) included — not gated behind an opt-in flag
and not scoped to the daemon loop region.

As the conductor, I want each executed step to begin on a brand-new LLM session so that a
step's judgement is derived from the `.docs/` artifacts it reads, not contaminated by an
earlier step's reasoning carried in session memory.

### Acceptance Criteria

#### Happy Path
- Given a conductor run advancing across consecutive steps A then B (both autonomous), when
  step B is dispatched, then the session id handed to the provider for B differs from the id
  used for A, and B is dispatched as a session *create* (no `--resume`), so no prior step's
  turns are present.
- Given a run where the front-half steps are actually executed (not pre-seeded `done`), when
  each front-half step is dispatched, then it too receives a freshly reset session — the
  reset is not limited to the `build…finish` tail.
- Given a run started with no configuration mentioning session persistence, when it executes
  its steps, then every step boundary resets the session with no opt-in flag required.

#### Negative Paths
- Given the previous step left a live/`session-created` marker in `.pipeline/`, when the next
  step is entered, then the reset unlinks/rewrites that marker so the step dispatches a
  *create* against a new id — it must NOT resume the prior step's conversation (guards against
  "session unavailable (expired or in use)" and against silent context bleed).

### Done When
- [ ] The `resetSession()` call at the step boundary in `conductor.ts` is invoked for every
      executed step, with no `freshContextPerStep` (or equivalent opt-in) condition guarding it.
- [ ] A test drives ≥2 consecutive steps and asserts the provider received a *different*
      session id per step and a create (not resume) dispatch on the second — asserted from the
      recorded provider calls, not from a convention/comment.
- [ ] A test exercises a front-half step under execution and asserts it is reset (front-half
      reset path is covered, not only the tail).

---

## Story: The `freshContextPerStep` opt-in flag is removed

**Requirement:** Remove the `freshContextPerStep` option/field and all its wiring so fresh-per-step
cannot be turned off via that flag; the daemon no longer needs to set it.

As a maintainer, I want the escape-hatch flag gone so that the session model has one
unconditional behavior and no code path can silently reintroduce cross-step context bleed by
leaving the flag false.

### Acceptance Criteria

#### Happy Path
- Given the conductor options type, when the code is compiled/typechecked, then no
  `freshContextPerStep` field exists on the options or the conductor instance.
- Given the daemon launch path (`daemon-cli.ts`), when it constructs the conductor, then it no
  longer passes `freshContextPerStep: true` (nor any replacement opt-in) and still gets
  fresh-per-step behavior by default.

#### Negative Paths
- Given a stale reference to `freshContextPerStep` anywhere in `src/` or `test/`, when the
  build/typecheck and the test suite run, then they fail on the dangling reference — i.e. the
  removal leaves zero orphaned references (grep-clean), so no dead flag lingers.

### Done When
- [ ] `grep -rn "freshContextPerStep" src/conductor/src src/conductor/test` returns no
      production references (only historical CHANGELOG/comment mentions, if any, remain).
- [ ] `daemon-cli.ts` constructs the conductor without the flag and the daemon's tail steps
      still reset per step (covered by an existing or added daemon-path test).
- [ ] `npx tsc` / the build passes with the field removed from the options type.

---

## Story: Within-step retries resume the same session (not fresh)

**Requirement:** A step's own internal retry attempts continue that step's session — a retry
is a continuation of the same task, not a new step, so it must resume rather than reset.

As the conductor, I want retries of a failing step to reuse the step's session so that the
retry sees the partial work/errors of the prior attempt and can finish the task, while the
*step boundary* (not the retry) is the only place a fresh session is minted.

### Acceptance Criteria

#### Happy Path
- Given a step that fails its first attempt and is retried within its `maxRetries` budget, when
  the second attempt is dispatched, then it uses the *same* session id as the first attempt and
  dispatches as a resume — the session is reset once at step entry, before the retry loop, and
  not again between attempts.

#### Negative Paths
- Given a step on its second retry attempt, when the provider dispatch is inspected, then a
  test FAILS if that attempt started a fresh session (new id / create) — this guards the
  retry-resume invariant against a regression where the boundary reset leaks into the retry loop.
- Given a mid-step stale-session recovery (`sessionExpired`) fires, when the session is reset to
  recover, then the retry budget is not consumed by that reset (attempt is decremented), so the
  recovery reset is distinguishable from — and does not become — a per-attempt fresh start.

### Done When
- [ ] A test runs a step through ≥2 attempts and asserts identical session id + resume dispatch
      across attempts (retry-resume preserved).
- [ ] A test asserts the boundary reset happens exactly once per step entry (before the retry
      loop), not once per attempt.

---

## Story: Interactive inline REPL carve-out and front-half artifact-read audit

**Requirement:** Autonomous / print-mode steps always get a fresh session. IF unconditional
fresh breaks the interactive inline `/conduct` design REPL (where the human converses across
`explore→prd→stories→plan`), a shared session may be retained **for interactive REPL steps
only** (`mode !== 'auto'` and `INTERACTIVE_STEPS`). Any front-half step that leaned on
cross-step conversational memory instead of reading its artifact is surfaced and fixed to read
the artifact.

As an operator, I want fresh-per-step to hold everywhere it matters for verdict independence
without breaking the human's inline design conversation, so that the change ships without
regressing the interactive DECIDE experience.

### Acceptance Criteria

#### Happy Path
- Given any autonomous / print-mode step (all judgement steps: `architecture_review`,
  `prd_audit`, `architecture_review_as_built`, and the build/tail steps), when it is
  dispatched, then it always receives a fresh session regardless of the interactive carve-out —
  verdict independence is never traded away.
- Given the front-half audit is performed, when a step is found to rely on conversational recall
  instead of reading its `.docs/` artifact, then that step is changed to read the artifact and
  the reliance is recorded as resolved.

#### Negative Paths
- Given the interactive carve-out is applied (shared session retained for inline REPL steps),
  when an *autonomous*-mode dispatch of one of those same steps occurs, then it still resets to
  a fresh session — the carve-out must be scoped strictly to `mode !== 'auto'` interactive REPL
  steps and must NOT leak persistence into autonomous runs.
- Given unconditional fresh is applied with NO carve-out (the carve-out proves unnecessary),
  when the interactive front-half runs, then it still completes each step correctly by reading
  artifacts — i.e. the carve-out is only introduced if a concrete inline breakage is
  demonstrated, not speculatively.

### Done When
- [ ] A test asserts autonomous judgement steps receive a fresh session on every dispatch,
      independent of any interactive carve-out branch.
- [ ] If a carve-out is implemented: a test asserts it applies only under `mode !== 'auto'` for
      `INTERACTIVE_STEPS` and that the same step under `auto` still resets.
- [ ] The front-half audit is documented (in the plan or a code comment/PR note) with each
      identified conversational-recall dependence either shown absent or fixed to an artifact read.
