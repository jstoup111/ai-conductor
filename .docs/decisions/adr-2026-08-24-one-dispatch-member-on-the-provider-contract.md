# ADR: The provider contract has one dispatch member; live observation is a seam on it

**Date:** 2026-08-24
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1857
**Amends:** `adr-2026-07-22-build-dispatch-json-usage-capture` — its consequence *"Interactive path
(`invokeInteractive`) is unchanged in this feature; its sessions are recorded as unmetered where
they occur"* only. That ADR's usage-capture decision stands untouched.
**Relates to:** `adr-2026-08-19-live-provider-stream-observation` (established that a live stream
and a parseable result are the same artifact; its observation-only boundary is preserved here and
named as the future extension point), `adr-2026-07-27-cost-unmetered-is-a-first-class-state` (the
three-valued metering model, unchanged), `adr-2026-08-12-live-provider-coverage-from-plugin-registry`
(the plugin registry as provider enumeration authority)

## Context

`LLMProvider` publishes two dispatch members, `invoke` and `invokeInteractive`
(`llm-provider.ts:342,349`). They are not two capabilities; they are two copies of one dispatch
that have drifted apart twice.

**Drift one (#829, E2BIG).** `invoke()` was fixed to deliver the prompt on stdin because a large
`build_review` projection exceeded `MAX_ARG_STRLEN` and made `exec()` fail before the provider
started. `invokeInteractive()` was left on the argv path. The comment recording this is still in
the tree (`claude-provider.ts:700-716`): *"#829 closed that hole in `invoke()` and left it open
here, and `step-runners.ts` routes rubric dispatch through this method."*

**Drift two (#1857, this issue).** `invoke()` requests a machine envelope —
`--print --output-format stream-json --verbose` on claude (`claude-provider.ts:640`), `exec --json`
on codex (`codex-provider.ts:939`) — and passes `jsonOutput=true` to its classifier.
`invokeInteractive()` requests neither and passes `false`, whose branch is literally
`{ output: stdout, tokenUsage: undefined }` (`claude-provider.ts:754`, `codex-provider.ts:467`).

The second drift is not confined to interactive sessions, and that is what falsifies the amended
consequence above. When `adr-2026-07-22-build-dispatch-json-usage-capture` recorded that interactive
sessions are "unmetered where they occur", `invokeInteractive` was the interactive path. It is not
any more: `streamingProviderRuntimes` (`step-runners.ts:1234-1258`) exists specifically to make
`invoke` route through `invokeInteractive` for every streaming step, and every step outside
`AUTONOMOUS_STEPS` (`step-runners.ts:135`) is a streaming step. "Where they occur" is now most
dispatches — 26 of 30 claude dispatches on the feature measured in #1857, including all 15 `opus`
`prd_audit` dispatches.

**What the contract actually is.** This was verified rather than assumed, because an earlier draft
of this ADR asserted that removing `invokeInteractive` would hard-break third-party plugins at load
time. That assertion is false, and the corrected facts change which option wins:

- The `LLMProvider` **type is not published**. `src/conductor/package.json` declares no `types`
  field, and `src/conductor/src/index.ts` does not re-export it. The reference plugin reaches it by
  relative path into the source tree (`plugins/recorder-provider/index.ts:3`, with a `tsconfig`
  path mapping at `plugins/recorder-provider/tsconfig.json:16-17`).
- The only **enforced** contract is a runtime duck-type check: `plugin-loader.ts:36-41` throws when
  an `llm_provider` entrypoint exports no `invoke` or no `invokeInteractive`. Dropping the second
  check is strictly more permissive — no plugin that loads today stops loading.
- The only **stated** contract is one prose sentence, `docs/guides/multiprovider.md:192`.
- A class with an extra method still satisfies `implements`, so removing the member from the
  interface breaks no implementor's compile.
- No third-party provider plugin exists: there is no `~/.ai-conductor/plugins/` and no
  `.ai-conductor/plugins/`. The only other implementation is `plugins/recorder-provider`, which
  `docs/guides/multiprovider.md:197` describes as "reference material only and is never
  auto-loaded".

**The forward-looking force.** `ProviderStreamObservation` (`llm-provider.ts:30-41`) already carries
running `uncachedInputTokens`, `cachedInputTokens`, `outputTokens`, and `activeChildren`, and both
adapters already emit it (`claude-provider.ts:582`, `codex-provider.ts:337`). The raw material for
live context management therefore already exists; it is simply not wired on the streaming path.
Whatever shape this decision takes must not cap that.

Confidence 97%, basis: verified — every file:line above was read at `461f7a4c3`.

## Options Considered

### Option A: Patch the flags in `invokeInteractive` and keep both members
- **Pros:** Smallest diff; delivers the measurement at roughly half the cost.
- **Cons:** Repairs the symptom and preserves the seam that produced it twice. Worse, it caps the
  future: any later capability built on the dispatch — a burn budget, a live context control, a
  mid-flight abort — must be written twice or silently miss every streaming step, which is the
  expensive population (`prd_audit` on opus, as-built, finish).

### Option B: Remove `invokeInteractive` from the interface and the plugin contract (chosen)
- **Pros:** One member, no vestigial surface. A member that does not exist cannot be rewired by a
  future contributor, so the drift guarantee is structural rather than conventional. Costs nothing
  at load time: dropping a required check is a loosening, and no currently-loadable plugin stops
  loading.
- **Cons:** A plugin author whose `invokeInteractive` goes inert gets no signal from the type,
  because the type is gone. The signal has to come from documentation and the release note instead.

### Option C: Retain `invokeInteractive` as optional and deprecated
- **Pros:** The type itself carries the obsolescence notice.
- **Cons:** Buys that signal on a type no plugin author can currently import, and pays for it by
  leaving the second member on the interface where a future contributor can wire it back — which
  is precisely the failure this ADR exists to make impossible.

B and C are identical on breakage, on streaming, and on context headroom. They differ only in the
drift guarantee (B is structural, C is conventional) and in where the obsolescence signal lives
(B: docs and release note; C: the unpublished type). B is chosen because the guarantee is the
thing this ADR is for, and the signal is recoverable elsewhere.

## Decision

1. **The engine calls exactly one dispatch member: `invoke`.** Every caller — autonomous steps,
   streaming steps, the REPL recovery path, and `attribution-lane`'s delegator — reaches the
   provider through it. The `streamingProviderRuntimes` invoke→`invokeInteractive` swap
   (`step-runners.ts:1249-1258`) is deleted; the wrapper survives only if it still has other
   delegation to do, and its prototype-delegation contract is preserved verbatim if so.

2. **`invokeInteractive` is removed** from `LLMProvider` and from `plugin-loader`'s required
   member check. An `llm_provider` entrypoint must export `invoke` and nothing more.

3. **Live observation is a seam on the dispatch, not a boolean.** `InvokeOptions` gains one
   additive optional field carrying a **stream consumer** — an object, not a flag — whose presence
   both selects live dispatch and names who receives the observations. Modeling it as an object is
   deliberate: a boolean answers only "render live?", whereas the consumer is the thing a later
   feature can grow without another interface change. Absent, the field reproduces exactly the
   buffered behavior `invoke()` has today, so no existing caller changes meaning.

4. **The consumer's authority stays exactly what `adr-2026-08-19-live-provider-stream-observation`
   granted: none.** It observes; it may not time out, kill, retry, or otherwise affect dispatch
   (`llm-provider.ts:301-304`). This ADR does not widen that, and #1857 does not ask it to.

5. **The named extension point.** Should a future feature need burn-based control — abort a
   dispatch exceeding a context budget, compact, or reroute on observed burn — the seam to extend
   is this consumer, and the decision to revisit is
   `adr-2026-08-19-live-provider-stream-observation`'s observation-only boundary. Recorded here so
   that work starts from a named seam and a named prior decision rather than re-deriving both.

6. **`InvokeOptions.interactive` continues to select REPL versus one-shot** and is unchanged. The
   REPL is the one dispatch that supplies no stream consumer.

7. **Built-in adapters implement dispatch once.** Neither adapter may keep a second private
   dispatch body. Argument construction and completion classification are reached by one path whose
   behavior varies by option, so a fix to one can no longer miss the other.

## Consequences

### Positive
- A future change to dispatch cannot land on one path and miss the other; there is one path, and
  no second member remains to reintroduce one.
- The usage-capture gap closes as a consequence of unification rather than as a special case.
- `onProviderStream` becomes reachable on every dispatch, so the live `daemon status` surface built
  in #1441 covers streaming steps — and the seam that would carry future context control exists,
  wired, on every dispatch.
- `plugin-loader` becomes strictly more permissive; a single-method provider plugin becomes valid.

### Negative
- A third-party plugin that implemented behavior in `invokeInteractive` finds it inert, with no
  type-level notice, because the member is gone. This is mitigated by documentation and a release
  note, not by the type.
- The provider contract's only remaining statement lives in prose and a runtime check. Publishing a
  real types entry point would be better, and is deliberately out of scope here.
- Streaming dispatches now ask the provider CLI for a different output format, a real behavior
  change on every streaming step, decided in
  `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope`.

### Follow-up Actions
- [ ] Update `docs/guides/multiprovider.md` — the "must export both `invoke` and
      `invokeInteractive`" sentence at line 192 — in the same PR, per Documentation Upkeep.
- [ ] Update `plugins/recorder-provider` so the reference example matches the new contract.
- [ ] Declare a release note so the contract change reaches consumers.
- [ ] Confirm at implementation time whether `streamingProviderRuntimes` retains any duty once its
      swap is removed; delete it if not.
- [ ] Consider a published types entry point for the provider contract as a separate intake.
