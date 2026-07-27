# ADR: Codex unattended readiness and bounded execution stay provider-local

**Date:** 2026-07-25
**Status:** SUPERSEDED
**Feature:** Codex authentication, sandbox, and permission readiness (#905)
**Deciders:** James Stoup (operator), architecture review for issue #905
**Related:** `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope`,
`adr-2026-07-04-auth-failure-park-and-poll`,
`adr-2026-06-30-sandbox-build-isolation`

**Superseded by:** `adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness`

**Approval:** Approved by James Stoup on 2026-07-25, including the fail-closed
valid-API-key compatibility assumption below.

## Context

The built-in Codex provider can execute `codex exec`, classify several Codex-native
failure strings, and participate in provider-aware model and provider fallback. It
does not establish which Codex authentication source an unattended run selected,
prove that source is usable before dispatch, or set an explicit bounded permission
policy. Its current interpretation of the shared `dangerouslySkipPermissions`
option is `--dangerously-bypass-approvals-and-sandbox`, which removes both controls.

The conductor's recovery layer is also still Claude-specific. An `authFailure`
enters credential-file or daemon-token park logic that names Claude variables and
paths. Concurrent-group outcomes discard the provider and auth context before the
join handles the failure. A Codex result must not enter either path.

The approved PRD requires both cached ChatGPT sign-in and a per-execution API key,
deterministic API-key precedence, no auth-source or provider fallback, four
fail-closed readiness states, explicit workspace-bounded automatic approval review,
zero retry/escalation budget for auth failure, and no change to Claude behavior.

Current Codex 0.145.0 and the 2026-07-25 official manual establish these relevant
native seams:

- `CODEX_API_KEY` selects an API key for one `codex exec`; without it, Codex can use
  cached authentication under `CODEX_HOME`;
- `codex doctor --json` emits a redacted, versioned report covering configured auth,
  selected auth mode, provider reachability, and authenticated WebSocket health;
- `sandbox_mode="workspace-write"`, `approval_policy="on-request"`, and
  `approvals_reviewer="auto_review"` keep the workspace sandbox while routing
  exceptional actions to an automatic reviewer; and
- the default spawned-command environment filter removes variable names containing
  `KEY`, `SECRET`, or `TOKEN` unless explicitly disabled.

Direct probes confirmed that cached ChatGPT auth produces a successful authenticated
WebSocket handshake, while a deliberately invalid `CODEX_API_KEY` produces a 401 in
the structured report. The report's overall status does not itself distinguish that
invalid key, and its diagnostic detail can contain a partially redacted key. The
harness therefore cannot forward the report or trust only its overall status.

## Options Considered

### Option A: Codex-adapter preflight plus explicit native policy

Have the Codex adapter select the auth source, run and strictly parse `codex doctor`
before each unattended invocation, construct a sanitized readiness result, and add
the bounded Codex config overrides to both initial and resumed `codex exec` calls.
Retain provider/auth metadata through the existing execution result so the conductor
can choose Codex-specific failure disposition.

- **Pros:** one seam covers normal, grouped, resumed, fallback-model, and auxiliary
  calls; the diagnostic and execution receive the same auth environment; no paid
  model probe; no new service, credential parser, container, or permission engine.
- **Cons:** adds a bounded diagnostic before every unattended dispatch; strict parsing
  must track a versioned external schema; failure metadata must survive grouped and
  auxiliary adapters.

### Option B: One daemon-level auth check and call-site policy flags

Check auth when the daemon accepts a feature, then add Codex flags at each engine
dispatch site.

- **Pros:** fewer diagnostics and a small provider change.
- **Cons:** resumed and auxiliary paths can bypass or drift from the check; a long run
  can dispatch after auth has become unusable; duplicated flags recreate the all-path
  wiring risk that provider-aware execution was introduced to remove.

### Option C: Probe with `codex exec` and use danger bypass or an outer container

Use a minimal model prompt to prove auth, then run with the existing danger-bypass
mapping, optionally adding a container around the daemon.

- **Pros:** tests the exact paid execution path; an external container can constrain
  an otherwise unbounded client.
- **Cons:** readiness initiates model work and consumes usage; danger bypass discards
  the approved safety posture; an outer container duplicates Codex's native boundary
  and materially expands deployment and credential plumbing.

## Decision

Choose **Option A**.

### 1. Select one authentication source without storing it

For each harness process run, a non-empty `CODEX_API_KEY` selects `api-key`;
otherwise the source is `cached-login`. The selection is retained for every Codex
diagnostic, initial invocation, retry, and resume in that process. The key is passed
only in the child environment of the diagnostic and matching `codex exec`; it is not
added to harness configuration, state, events, artifacts, or command arguments.

The harness does not parse, copy, refresh, or relocate cached Codex credentials. It
lets Codex read the selected cached source through its native `CODEX_HOME` behavior.
When an API key is selected, the same child environment is used for readiness and
execution. Failure of either selected source never causes the other source to be
tried.

### 2. Gate every unattended invocation with a strict `doctor` parser

Immediately before every Codex invocation marked unattended by the existing runner
contract, the adapter runs `codex doctor --json --summary` with the selected auth
environment and a bounded timeout. Interactive calls that retain human approval do
not acquire this daemon readiness gate.

The parser accepts only a supported `schemaVersion` and explicit evidence for the
selected auth mode. It produces exactly one internal and operator-facing state:

- `missing`: the selected source is not configured;
- `unusable`: the selected source has explicit expiry, rejection, 401, or 403
  evidence;
- `ready`: the selected source is configured and the diagnostic reports a successful
  authenticated transport check for that source; or
- `unverifiable`: timeout, spawn failure other than installation readiness, malformed
  or unknown-schema output, network/service failure, conflicting auth-mode evidence,
  or any result that is neither explicit success nor explicit rejection.

Only `ready` permits `codex exec`. All other states return a provider-attributed,
source-specific, sanitized auth failure with the substantive invocation marked as
skipped. The adapter captures all diagnostic output; neither stdout nor stderr is
inherited by the daemon terminal. It constructs its own message from the readiness
enum and never includes raw report details.

The parser treats an unknown future report shape as `unverifiable`; compatibility
drift can block Codex safely but cannot silently claim readiness.

### 3. Replace danger bypass with one explicit Codex policy

For every unattended initial or resumed Codex invocation, the adapter supplies these
CLI config overrides:

```text
sandbox_mode="workspace-write"
approval_policy="on-request"
approvals_reviewer="auto_review"
shell_environment_policy.ignore_default_excludes=false
```

The adapter does not emit `--dangerously-bypass-approvals-and-sandbox` for unattended
Codex work. It does not add writable directories beyond the invocation's feature
worktree. The explicit shell-environment override prevents user configuration from
turning off Codex's automatic `KEY`/`SECRET`/`TOKEN` filter for model-generated
commands.

`on-request` retains an escalation boundary; `auto_review` changes the reviewer from
a waiting human to the native reviewer. Approved exceptional operations, including
network and Git publication, may proceed. Denied, timed-out, or failed reviews remain
denied and must not trigger a retry with weaker settings. The same overrides are
present on resume, where config overrides are supported even when a dedicated
`--sandbox` flag is not.

### 4. Preserve source context through recovery

Codex completion and readiness results carry the selected auth source, readiness
state, and sanitized reason through `InvokeResult` and `StepRunResult`. The existing
provider executor continues to give auth failure recovery precedence, so it neither
walks the provider candidate list nor poisons a model-availability ladder.

The conductor gains a small provider-specific auth disposition at its existing
serial and concurrent-group auth joins:

- `claude` retains the current credential park/token behavior byte-for-byte;
- `codex` writes an actionable HALT immediately, using only the sanitized provider
  result, and consumes no task retry or model escalation attempt.

Concurrent-group no-verdict outcomes retain the failed provider and sanitized auth
context instead of collapsing everything to the string `authFailure`. Auxiliary
adapters must likewise preserve or surface the same context; none may replace it with
a Claude remediation message or a generic retries-exhausted failure.

For API-key execution, Codex subprocess output is not live-inherited before
classification. Explicit auth failures are replaced with a canned source-specific
message, preventing upstream partial-key redaction from becoming harness output.

### 5. Branch self-host setup by the selected build provider

The self-host build path resolves the build step's preferred provider before applying
provider-specific setup:

- a Claude build retains the existing relink, Claude auth preflight, throwaway
  `CLAUDE_CONFIG_DIR`, token injection, and write fence unchanged;
- a Codex build skips every Claude credential/config preparation step and uses the
  same Codex readiness and bounded policy as any other unattended Codex dispatch.

For Codex, the feature worktree is the only writable root. The parent main checkout,
the linked worktree Git directory, and protected `.git`, `.agents`, and `.codex`
surfaces remain outside or read-only under Codex's native sandbox. Exceptional Git or
network work crosses that boundary only through auto-review. The existing provider-
neutral version and release-artifact self-host gates still run.

This decision does not create a throwaway `CODEX_HOME`, copy Codex credentials, add an
outer container, or port the Claude hook sandbox. It also does not adapt skill
discovery or slash commands; issue #904 owns Codex skill and repository-guidance
surfaces. #905 must not mutate global skill links as a substitute.

### 6. Make readiness observable without credential fingerprints

Provider attempt/audit output identifies `codex`, the selected source (`api-key` or
`cached-login`), and the four-state readiness verdict. Messages may name
`CODEX_API_KEY`, `codex login`, or `codex doctor` as remediation commands, but may not
include credential values, prefixes, suffixes, hashes, cached credential paths, or raw
diagnostic payloads.

## Consequences

### Positive

- The adapter is the single all-path enforcement point; normal, grouped, auxiliary,
  initial, and resumed work cannot drift in policy.
- Both auth sources use Codex's native credential implementation, including keyring
  storage, without a second credential lifecycle in the harness.
- Automatic Git/network approvals retain a real safety decision while allowing the
  daemon to continue without a person at the terminal.
- Claude behavior and its established self-host sandbox remain unchanged.

### Negative

- `codex doctor` adds several seconds to every unattended Codex dispatch and can make
  an external outage fail closed before model work begins.
- A Codex CLI diagnostic schema change blocks unattended Codex until the parser is
  updated.
- Group outcomes and a few auxiliary adapters need wider auth metadata plumbing even
  though provider candidate selection itself does not change.
- Auto-review uses additional model calls and can deny an operation the build needs;
  that denial is an intentional HALT, not permission to weaken the sandbox.

## Compatibility Assumption Requiring Approval

For the supported Codex CLI, a valid `CODEX_API_KEY` is expected to produce the same
explicit successful authenticated-transport evidence that cached ChatGPT auth
produced in the direct probe. Confidence is **85%**, inferred from the paired cached-
success/invalid-key probes and the official description of `doctor` as an auth and
runtime diagnostic. If wrong, valid API-key runs fail closed as `unverifiable`; no
unsafe dispatch occurs, but FR-2 is unavailable on that CLI version. Approval of this
ADR accepts that fail-closed compatibility posture. Implementation must include
fixture coverage and an opt-in real-binary smoke when a valid key is available.

## Follow-up Actions

- [ ] Add the auth-source selector, bounded doctor runner, strict schema parser, and
      redaction-safe diagnostics to the Codex adapter.
- [ ] Apply the explicit policy config to initial and resumed unattended Codex args.
- [ ] Retain auth source/readiness through normal, grouped, and auxiliary outcomes.
- [ ] Route Codex auth failure to immediate provider-specific HALT while preserving
      Claude park behavior.
- [ ] Branch self-host build preparation before any Claude-specific auth/config work.
- [ ] Add fixture, integration, negative-path, resume-parity, no-fallback, no-budget,
      self-host isolation, and optional real-binary smoke coverage.
- [ ] Reconcile the approved architecture diagram's resolved open questions after
      ADR approval, while leaving issue #904's skill-surface ownership explicit.
