**Status:** Accepted

# Stories: Self-host builds isolate and fingerprint Pi operator state (#1887)

Technical track (no PRD). The source is the operator-confirmed scope in
`.docs/track/self-host-builds-isolate-and-fingerprint-pi-operat.md` and
adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D23–D26, applying
adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation §3. Out of scope: OS
write containment (#2851), HOME-relative `~/.agents/skills` isolation, and providers registered by
Pi extensions or packages.

## Story 1: A Pi self-host build runs in an isolated Pi home holding only its selected credential

**Requirement:** TI-1 — Pi declares `selfHost`; a Pi self-host candidate runs in a throwaway `PI_CODING_AGENT_DIR` whose only credential is the dispatched provider's key, resolved by Pi from the operator's live home (ADR D23, D25).

As an operator, I want a Pi self-host build to run against a throwaway Pi home, so that the build never reads or writes my live `~/.pi/agent/` state and never holds credentials for providers it is not using.

### Acceptance Criteria

#### Happy Path
- Given the pi catalog descriptor, when `supportsProviderCapability` is queried for `selfHost`, then it returns true, and `PROVIDER_CAPABILITY_OWNERS` no longer has a `selfHost` entry.
- Given a self-host dispatch whose candidate is pi with model `openrouter/some-model` and a resolver that prints key `K`, when the candidate is prepared, then the child environment's `PI_CODING_AGENT_DIR` names a fresh directory under the feature worktree's `.daemon/scratch` and not the operator's Pi home.
- Given the same dispatch, when the candidate is prepared, then the isolated home's `auth.json` parses to exactly one entry, keyed `openrouter`, with `type` `api_key` and `key` `K`, and has file mode 0600.
- Given the same dispatch, when the candidate is prepared, then the credential resolver was invoked once as `pi auth print-api-key --provider openrouter` with the operator's live Pi home, and the isolated home's `skills/` holds the worktree skills minus the operator-only skills.
- Given a pi candidate whose model provider is `deepseek` after an earlier `openrouter` candidate, when each candidate is prepared, then each isolated home's `auth.json` holds only that candidate's own provider entry.

#### Negative Paths
- Given a pi candidate whose credential resolver exits non-zero, when the candidate is prepared, then preparation fails as a provider-setup refusal naming pi and the provider, no pi model subprocess is spawned, and the scratch lease is released.
- Given a pi candidate whose model provider is registered only by a Pi extension so the resolver prints `Unknown provider`, when the candidate is prepared, then preparation fails as a provider-setup refusal naming that provider and no isolated home remains on disk.
- Given a pi candidate whose resolver exits 0 with empty or whitespace-only output, when the candidate is prepared, then preparation fails as a provider-setup refusal and no `auth.json` is written.
- Given a resolver failure whose stderr contains the key text `K`, when the refusal diagnostic, events and HALT text are produced, then none of them contain `K`.
- Given a prepared pi candidate, when its invocation argv and environment are inspected, then neither contains the key `K`.
- Given a parent environment that sets `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_OAUTH_TOKEN`, when a pi isolated home builds its child environment, then `PI_CODING_AGENT_DIR` is the isolated home and the other four are absent.
- Given an operator Pi home whose `auth.json` holds entries for five providers, when a pi candidate for one of them is prepared, then the isolated `auth.json` holds no entry for the other four.

### Done When
- [ ] provider-catalog tests assert pi declares `selfHost` and that `PROVIDER_CAPABILITY_OWNERS` has no `selfHost` key.
- [ ] pi self-host auth tests, using a fake resolver, assert the one-entry `auth.json` content and 0600 mode and the resolver argv, and assert refusal for non-zero exit, unknown provider and empty output.
- [ ] provider-home tests assert the pi child environment scrubs every catalog provider-home variable, `PI_CODING_AGENT_SESSION_DIR` and `CLAUDE_CODE_OAUTH_TOKEN`.
- [ ] A redaction test asserts the key never appears in argv, child env, refusal text or emitted events.

## Story 2: Routine Pi churn does not halt a build, but a write to Pi config does

**Requirement:** TI-2 — the live Pi home is fingerprinted with a Pi volatile list of `sessions`, `models-store.json` and the selected auth path `auth.json`; every other path stays fingerprinted, and provider-state drift halts whether or not the dispatch is contained (ADR D24, D26).

As an operator, I want my own Pi sessions and Pi's caches to stop tripping self-host builds, while a real write into my Pi configuration still stops the run.

### Acceptance Criteria

#### Happy Path
- Given a pi self-host candidate fingerprinted against a live Pi home, when only files under `sessions/` are added or changed before verification, then live-boundary verification passes.
- Given the same candidate, when only `models-store.json` and `auth.json` change before verification, then live-boundary verification passes.

#### Negative Paths
- Given a pi self-host candidate, when `settings.json` in the live Pi home changes before verification, then verification fails with a reason naming the provider state surface and `settings.json`, and the run halts at the next dispatch boundary.
- Given a pi self-host candidate, when a file is added under `extensions/` or `trust.json` changes in the live Pi home, then verification fails naming that path.
- Given a pi self-host candidate whose dispatch is proven contained, when the operator edits `settings.json` in the live Pi home during the dispatch, then verification still fails naming `settings.json`, the same result a contained claude dispatch gets for a Claude `settings.json` edit.
- Given a pi self-host candidate, when a file named `sessions.json` is added at the live Pi home root, then verification fails, because only the `sessions` directory itself is excluded.

### Done When
- [ ] live-boundary tests assert the pi volatile list excludes exactly `sessions`, `models-store.json` and `auth.json`.
- [ ] live-boundary tests assert a pi `settings.json`, `trust.json` or `extensions/` change fails verification both with and without a contained verdict.
- [ ] Provider-state volatile lists live in a table keyed by the self-host provider id type, so a `selfHost` provider without an entry fails `tsc`.

## Story 3: Interrupted Pi self-host runs do not leak isolated homes

**Requirement:** TI-3 — Pi isolated homes use the existing scratch lease, teardown and sweep lifecycle with no Pi-specific branch (ADR D23).

As an operator, I want an interrupted Pi self-host run to leave no orphaned Pi home behind, matching claude and codex.

### Acceptance Criteria

#### Happy Path
- Given a pi candidate whose dispatch completes, when its teardown runs, then the isolated home directory is removed and its scratch lease is released.
- Given a pi scratch lease left by a run that was killed before teardown, when the next scratch sweep runs for that worktree, then the abandoned pi home and its lease are removed, exactly as for an abandoned codex lease.

#### Negative Paths
- Given a pi candidate whose dispatch fails or is aborted, when the candidate's teardown runs, then the isolated home is removed and the one-entry `auth.json` no longer exists on disk.
- Given a pi candidate whose credential resolution fails after the scratch lease was acquired, when preparation unwinds, then the lease is released and no `self-host-pi-` directory remains under `.daemon/scratch`.
- Given a live pi lease owned by a running attempt, when a concurrent sweep runs, then that lease and its home are kept.

### Done When
- [ ] provider-scratch tests cover acquire, release and sweep for a pi lease alongside the existing claude/codex cases.
- [ ] A provisioning-failure test asserts the pi lease is released and the home removed when the resolver fails.

## Story 4: Self-host shape comes from the catalog, so Pi never takes Claude-only paths

**Requirement:** TI-4 — isolation kind, selected auth path, Claude-only preflights and extra scrub variables are declared per `selfHost` descriptor and read by the conductor, provider home and live boundary; claude and codex behavior is unchanged (ADR D24).

As an operator, I want each provider's self-host path declared in the catalog, so that adding Pi does not route it through Claude's preflights or Codex's special cases, and claude and codex keep working exactly as today.

### Acceptance Criteria

#### Happy Path
- Given a pi self-host dispatch with daemon-token build auth configured and no token file present, when the dispatch starts, then no daemon build-token HALT is written and the pi candidate is prepared.
- Given a pi self-host dispatch with no `harness_self_host.build_auth` block and an expired operator Claude credential, when the dispatch starts, then the operator Claude credentials preflight does not run for it.
- Given a claude self-host dispatch with daemon-token build auth configured and no token file present, when the dispatch starts, then the existing daemon build-token HALT is written as today.
- Given claude, codex and pi self-host candidates, when each fingerprints its live provider home, then the excluded selected auth path is `.credentials.json` for claude and `auth.json` for codex and pi.

#### Negative Paths
- Given a codex self-host candidate, when it is prepared, then its isolated home still receives the `.agents/skills` link and its child environment is unchanged from today apart from the added scrub of `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR`.
- Given a pi self-host candidate whose runtime provider lacks `prepareSelfHostAuth` or `resolveSelfHostExecutable`, when the candidate is prepared, then preparation refuses with a provider-setup refusal naming pi and the self-host-isolation capability, before any fingerprint, lease or home is created.
- Given production source outside the catalog and provider adapters, when the structural provider-literal test runs, then no `homeVariable` comparison against `CODEX_HOME` or `CLAUDE_CONFIG_DIR` and no `environmentPrefix` comparison selects a self-host path.

### Done When
- [ ] conductor self-host tests assert pi skips the daemon build-token and operator Claude credential preflights while claude still runs them.
- [ ] Parity tests assert the claude and codex isolation kind, selected auth path and child environment are unchanged.
- [ ] The structural provider-literal test is extended to reject provider-id-shaped self-host branches in `conductor.ts`, `provider-home.ts` and `live-boundary.ts`.
