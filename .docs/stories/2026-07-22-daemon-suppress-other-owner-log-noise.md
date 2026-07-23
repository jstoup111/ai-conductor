**Status:** Accepted

# Stories: suppress other-owner gate-writeback log noise unless verbose

Technical track (no PRD). Source: issue jstoup111/ai-conductor#840. Tier: S.

Intent: on a shared-repo daemon, the gate-writeback skip notices in
`src/conductor/src/engine/gate-writeback.ts` (`announceGatedPr` no-PR + terminal-PR-state,
`announceGatedIssue` no-usable-Source-Ref) always name a **gated** spec, and every gated
spec is `other-owner` by construction (`GatedReason = 'other-owner'` — the only gating
reason). At **default** verbosity these lines are pure noise about work this daemon has
already excluded and will never build; they must be **suppressed**. A **verbose** mode
(config `daemon_verbose: true`, default `false`) surfaces them for debugging. The
suppression covers only these gate-writeback skip **logs** — the operator's OWN work
(build/start/resume/status lines, a different code path) still logs at default verbosity,
and the announce/label/comment write behavior, the existing `warnedSkips` dedup, and the
non-throwing contract are all unchanged.

The verbose signal is threaded as an optional `verbose?: boolean` on `GateWritebackDeps`
(alongside `warnedSkips`) and consulted inside `logSkipOnce`: when `verbose` is falsy the
skip notice is suppressed entirely; when `verbose` is true it logs (subject to the existing
per-`(slug, reason)` dedup). Absent `verbose` on the deps (legacy/test callers) defaults to
**suppressed for gated skips** only where the deps opt in; the daemon call site sets it from
config.

## Story 1: Default verbosity suppresses the no-PR gate-writeback skip notice

As an operator running a shared-repo daemon at default verbosity, I want the "nothing to
announce (no PR)" notice for a gated (other-owner) spec to NOT be logged, so that
`.daemon/daemon.log` is not flooded every discovery pass with lines about another operator's
spec that this daemon will never build.

### Acceptance Criteria

#### Happy Path
- Given a daemon run at default verbosity (deps with `verbose: false`) whose gated set
  contains spec `S` with no known implementation PR (`prUrl` falsy), when `announceGatedPr`
  runs on a discovery pass, then NO `[gate-writeback]` skip line is logged for `S` and no
  `gh` call is made.
- Given the same default-verbosity deps, when `announceGatedPr` runs for `S` on many
  consecutive passes, then across all passes zero no-PR skip lines are logged for `S`
  (`grep 'gated spec' daemon.log` returns nothing for `S`).

#### Negative Paths
- Given default verbosity and a gated spec `S` whose no-PR notice is suppressed, when a later
  pass finds `S` now HAS an OPEN/MERGED `prUrl`, then the announce path still proceeds
  normally — the `owner-gated` label is ensured/applied and the marker comment is upserted
  (spy on injected `runGh`) — i.e. suppression silences only the skip LOG, never the
  announcement work.
- Given deps WITHOUT a `verbose` field set and WITHOUT `warnedSkips` (a bare legacy/test
  caller), when `announceGatedPr` skips a no-PR spec, then existing behavior for that caller
  shape is preserved (the notice is not newly emitted in a way that breaks unmodified
  existing tests; any existing test asserting the old unconditional log is updated in the
  same change to construct verbose-enabled deps).

### Done When
- [ ] A test drives `announceGatedPr` with `prUrl` falsy and `verbose: false` deps, asserting
      zero `[gate-writeback]` log lines and zero `gh` calls.
- [ ] A test drives the same across two consecutive passes, asserting still zero lines.
- [ ] A test asserts that after a suppressed no-PR skip, a later pass with a real `prUrl`
      still performs the label ensure/add and comment upsert.

## Story 2: Default verbosity suppresses the terminal-PR-state and no-Source-Ref notices

As an operator, I want the "PR is CLOSED/NOTFOUND" skip (in `announceGatedPr`) and the "no
usable Source-Ref" skip (in `announceGatedIssue`) suppressed at default verbosity too, so
that every gated (other-owner) skip site is quiet by default — not just the no-PR one.

### Acceptance Criteria

#### Happy Path
- Given default-verbosity deps (`verbose: false`) and a gated spec `S` whose PR is `CLOSED`
  (or `NOTFOUND`), when `announceGatedPr` runs, then NO terminal-state `[gate-writeback]`
  skip line is logged for `S`.
- Given default-verbosity deps and a gated spec `S` whose `sourceRef` is present but
  malformed (fails `parseSourceRef`), when `announceGatedIssue` runs, then NO
  `[gate-writeback] ... no usable Source-Ref` skip line is logged for `S`.

#### Negative Paths
- Given default-verbosity deps and a gated spec `S` with a `CLOSED` PR, when `gh` errors
  during the `prMergeState` lookup on a pass, then `announceGatedPr` still returns without
  throwing (the best-effort/non-throwing contract is unchanged by suppression).
- Given default-verbosity deps, when `announceGatedIssue` runs for `other-owner` spec `S`
  with a VALID `sourceRef`, then the existing `other-owner` silent-skip (no label/comment on
  another operator's issue — the #691 fix at `gate-writeback.ts:267`) is unchanged: still no
  `gh` write and, at default verbosity, no skip line either.

### Done When
- [ ] A test drives `announceGatedPr` with a fake `runGh` reporting `CLOSED` and `verbose:
      false` deps, asserting zero terminal-state log lines.
- [ ] A test drives `announceGatedIssue` with a malformed `sourceRef` and `verbose: false`
      deps, asserting zero no-Source-Ref log lines.
- [ ] The non-throwing contract is asserted (no rejection) when the injected `runGh` throws
      mid-pass under default verbosity.

## Story 3: Verbose mode surfaces the suppressed non-assigned notices

As an operator debugging a shared-repo daemon, I want a verbose mode that re-surfaces every
suppressed gate-writeback skip notice, so that I can see exactly which other-owner specs the
daemon is gating and why.

### Acceptance Criteria

#### Happy Path
- Given verbose-enabled deps (`verbose: true`, e.g. daemon started with config
  `daemon_verbose: true`) and a gated spec `S` with no PR, when `announceGatedPr` runs, then
  the no-PR skip notice for `S` IS logged (`grep 'gated spec' daemon.log` finds it),
  subject only to the existing per-`(slug, reason)` dedup (once per daemon run).
- Given verbose-enabled deps, when `announceGatedPr` runs for a `CLOSED`-PR gated spec and
  `announceGatedIssue` runs for a malformed-`sourceRef` gated spec, then BOTH the
  terminal-state and no-Source-Ref notices ARE logged (one line each, deduped per reason).

#### Negative Paths
- Given verbose-enabled deps AND the existing `warnedSkips` set injected, when
  `announceGatedPr` runs for the same no-PR spec `S` on two consecutive passes, then the
  notice logs exactly ONCE (verbose re-enables the log; the pre-existing dedup still bounds
  it to once per `(slug, reason)` per run — verbose does not defeat dedup).
- Given verbose-enabled deps, when the announce path later has a real PR / valid ref, then
  label + comment upserts still happen exactly as at default verbosity (verbose changes only
  which skip logs appear, never the announcement work).

### Done When
- [ ] A test drives `announceGatedPr` with `prUrl` falsy and `verbose: true` deps, asserting
      exactly one no-PR skip line.
- [ ] A test asserts the terminal-state and no-Source-Ref notices appear under `verbose:
      true`.
- [ ] A test with `verbose: true` AND a shared `warnedSkips` set asserts two passes for one
      slug produce exactly one line (dedup still applies).

## Story 4: Own-work still logs at default; config wires the daemon verbose flag

As an operator, I want my OWN build/gate activity to keep logging at default verbosity while
only non-assigned (other-owner) gate-writeback notices are suppressed, and I want the verbose
mode driven by a validated config key, so the default log reads clean and the knob is
discoverable and mistake-proof.

### Acceptance Criteria

#### Happy Path
- Given default verbosity, when the daemon logs own-work lines (feature start `▶ start
  <slug>`, resume `↻ resume <slug>`, per-slug status transitions, and conductor build
  events), then those lines are logged UNCHANGED — suppression touches only the
  gate-writeback skip notices, which are a different code path.
- Given a project/user config with `daemon_verbose: true`, when the daemon constructs
  `gatedWritebackDeps` (daemon-cli.ts ~line 1093), then it sets `verbose: true` on those
  deps; with the key absent or `false`, `verbose` is `false` (default-off).

#### Negative Paths
- Given a config where `daemon_verbose` is a non-boolean (e.g. a string), when the config is
  loaded, then it is REJECTED at load time with a clear error naming the key (mirrors the
  existing typed-config validation contract in `config.ts`), never silently coerced.
- Given no `daemon_verbose` key anywhere, when the daemon runs, then it behaves exactly as
  default-off verbose (backward compatible — existing configs need no change).

### Done When
- [ ] A test asserts own-work log lines (start/resume/status) are emitted at default
      verbosity while the gate-writeback no-PR notice is suppressed in the same run.
- [ ] `config.ts` adds `daemon_verbose` to the known top-level keys and validates it is a
      boolean (reject non-boolean with a keyed error); a test covers accept-true,
      accept-false, accept-absent, reject-non-boolean.
- [ ] The daemon call site sets `gatedWritebackDeps.verbose` from `config?.daemon_verbose ??
      false`; a test/grep asserts exactly one wiring site and default-off when unset.
- [ ] `CHANGELOG.md` `[Unreleased]` gains a `### Changed` (or `### Fixed`) entry referencing
      #840; `README.md`/`src/conductor/README.md` document the `daemon_verbose` config key.
