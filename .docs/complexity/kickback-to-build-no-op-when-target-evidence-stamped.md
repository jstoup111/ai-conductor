# Complexity: Kickback to build is a no-op when the target task's evidence is still stamped (#647)

Tier: M

## Rationale

Medium (small end). A bounded, additive set of deterministic guards at one existing seam — the
kickback→build re-entry in `conductor.ts` — reusing signals the engine already records. No new
subsystem, no change to the completion-derivation core, no LLM.

- **One seam carries the logic.** The remediation kickback→build path already exists at four call
  sites that share the same `navigateBack(state, target, steps)` + `state.build = 'stale'` +
  `pendingRetryHints.set` shape (`conductor.ts:2861-2870`, `:2938-2947`, `:2995-3013`,
  `:3083-3097`), all fed by `planRemediation` (`:871-930`). The guards attach here and to
  `planRemediation`'s route decision — a small, well-localized change surface.
- **Signals already exist.** Net-progress detection is already computed and persisted around the
  build step: `headShaBeforeBuild`/`headShaAfterBuild` (`conductor.ts:1642`, `:2139`),
  `countResolvedTasks`, and `taskEvidence.lastResolvedCount` stamped at every build exit
  (`:2243`, `:2328`, `:2615`, `:2630`, #601). Gate verdicts and their kickback provenance are
  durable (`gate-verdicts.ts:44-48`, `readVerdict`). The kickback count per gate is tracked
  (`kickbackCounts`, `:1350`; `MAX_KICKBACKS_PER_GATE`, `:196-201`). The work is *wiring these
  into the re-entry decision*, not building new measurement.
- **Why the existing zero-work machinery does not already cover this.** `detectZeroWorkProduct` +
  the `zero_work_product` event (`conductor.ts:2145-2160`) fire only *inside* the build retry loop
  on a completion-gate **miss**. The incident's build **passed** the gate (derived complete), so the
  step succeeded and none of that path ran. The new guard must live at the kickback re-entry /
  post-build-success boundary — a genuinely uncovered case, hence M not S.
- **Breaking-surface check:** no `bin/conduct` CLI, `settings.json` schema, hook wiring, or skill
  symlink change. The optional config toggle to disable the new escalation is additive (mirrors
  `build_progress_halt.enabled`). No CHANGELOG Migration block; plain `### Fixed` (+ `### Added` for
  the toggle if included).

Not L: no new step, no new store, no cross-run state, no daemon-scheduler change, and the
completion-derivation authority (`autoheal.ts`/`artifacts.ts`) is untouched. The escalation is a
fail-closed HALT reusing the existing HALT-marker + `surfaceRemediationPr` plumbing. Negative paths
(genuine rework still dispatches; reviewer-wrong caps without ping-pong; idempotent re-evaluation)
are cheap deterministic unit cases against on-disk fixtures.
