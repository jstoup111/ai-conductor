# Security Audit: ai-conductor

**Scope.** `src/conductor/src/**` (TypeScript engine, ~329 non-test modules), `bin/**`,
`hooks/claude/**`, `.github/workflows/**`, generated hook assets, and the self-host
isolation surfaces. Read directly, not filename-scanned.

**Threat model used.** This is not a web app — there are no HTTP routes, no database, no
sessions, and no end users. The security-relevant boundaries are:

1. **LLM output → host execution.** Provider CLIs run with `--dangerously-skip-permissions`
   and write files the harness later parses, executes, or evaluates. LLM output is
   *semi-trusted at best* and must be treated as attacker-influenced input.
2. **GitHub issue/PR content → LLM prompt → autonomous build.** Third parties can write
   issue and PR text.
3. **CI (`.github/workflows`) → repo write / secrets.**
4. **Local privilege boundaries** — the self-host write-fence, the live-boundary guard, the
   `.daemon/grants` authorization store.

Every finding below carries a confidence % and a basis (`verified` = I read the code and
traced the path; `inferred` = derived from adjacent evidence).

---

### Auth Coverage
**Status:** NEEDS_WORK

No user-facing authN/authZ exists. The equivalent surface is *authorization of the
autonomous agent* — what a dispatched LLM may authorize on its own behalf.

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `src/conductor/src/cli.ts:328-341` | The DECIDE-grant store is deliberately placed outside the worktree (`.daemon/grants/<slug>.json`) so "a build agent writing its own `.pipeline/decide-grant.json` must not be able to authorize itself". The only thing enforcing that separation is the self-host write-fence, which is bypassable (see Injection §3) and does not exist at all for non-self-host builds. A build agent with Bash can write its own grant and self-authorize a DECIDE step. **Confidence 85%, verified** (grant path + fence coverage read; not exploited). | important |
| `src/conductor/src/engine/owner-gate/gate.ts:14-19` | Owner-gating fails open: an un-owned merged spec **always** builds; the cutover only changes the logged reason. Anything that lands a spec file on `main` is autonomously built. Acceptable for a solo repo; a real gap the moment a second contributor can merge. **Confidence 90%, verified; impact assessment tentative.** | minor |
| `src/conductor/src/engine/tracker-client.ts:216-232` | Intake capture is scoped to `--assignee @me`, which is the correct trust anchor (a third party cannot assign). Note the residual: GitHub issue **bodies remain editable by their author after assignment**, so the assignment check is not a durable content guarantee. **Confidence 95%, verified** (code); the GitHub-side editability is **inferred**. | minor |

---

### Input Validation
**Status:** NEEDS_WORK

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `src/conductor/src/engine/mergeable-sweep.ts:148-166` | `.daemon/mergeable-watch.jsonl` entries are validated only with `typeof x === 'string'`. `prUrl` gets no URL/shape validation and is then interpolated into a shell string (see Injection). A file-level write is enough to poison it, and `.daemon/` is explicitly excluded from the live-boundary guard (`self-host/live-boundary.ts:58-60`), so writes there are invisible to the leak detector. **Confidence 90%, verified.** | important |
| `src/conductor/src/engine/engineer/intake/github-issues.ts:175,235` + `engineer/loop.ts:520-540` | GitHub issue title+body flow verbatim into the DECIDE authoring prompt and from there into an autonomous build that runs a provider CLI with permissions skipped. There is **no inbound sanitization or prompt-injection boundary** — `intake/sanitize.ts` is an *outbound* scrub applied when *filing*, never on capture. A crafted issue body is directly a prompt-injection vector into an unsandboxed agent. **Confidence 88%, verified** (both code paths read end-to-end; exploitability of any specific injection string not demonstrated). | important |
| `src/conductor/src/engine/self-host/write-fence.ts:80-115` | The Bash write-detector is a regex allowlist: it recognizes `>`/`>>`, pipes into `sed`/`awk`, and `mv|cp|tee|install|dd|rsync`. `python3 -c "open('/x','w')…"`, `perl -pi -e`, `node -e`, `truncate`, `ln -sf`, and `chmod` are all classified read-only and allowed through. **Confidence 92%, verified by reading `has_write_shape`.** | important |
| `src/conductor/src/engine/session-hook-assets.ts:271` (matcher at `engine/worktree-prepare.ts:271`) | The docs-guard PreToolUse hook is registered for `Edit\|Write\|NotebookEdit` only. `echo … > .docs/plans/x.md` from Bash bypasses the frozen-spec-artifact gate entirely. The `pre-commit` hook is a partial backstop at commit time, so this is defence-in-depth loss rather than a full bypass. **Confidence 93%, verified.** | minor |
| `src/conductor/src/engine/daemon-park-cli.ts:104-107, 275-300` | `park`/`unpark` accept an arbitrary slug and join it into `.docs/plans/<slug>.md`, `.worktrees/<slug>`, `.daemon/parked/<slug>`; only `reclaim-worktree` enforces `SINGLE_SLUG`. Traversal is bounded by the `existsSync` precondition and the input is operator-supplied on a CLI, so real impact is near-zero — but the validation is inconsistent with its sibling command. **Confidence 90%, verified.** | minor |

**Validated well (verified):** `slugify` (`engine/worktree.ts:19-27`, `engineer/authoring.ts:178-184`)
strips everything outside `[a-z0-9-]` before any path or branch construction — no traversal via
slug. `cli.ts:300-311` explicitly rejects `/`, `.`, `..` in decide-grant slugs. `mermaid-renderer.ts:83-86`
sanitizes temp-file stems. `js-yaml@4` `load` uses the safe schema by default in all four
config loaders.

---

### Injection Vulnerabilities
**Status:** CRITICAL

No SQL and no rendered HTML exist, so the entire category is **command / code injection**.

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `bin/conduct:515-522` (fed by `bin/conduct:971`) | **Python code injection → RCE.** `save_state` interpolates its arguments raw into an *unquoted* `python3 << PYEOF` heredoc: `state["$step"] = "$status"`. At line 971 the value comes from `grep -oP 'Verdict:\s*\K\S+'` over `.docs/decisions/technical-assessment-*.md` — a document written by the assessment subagents, i.e. LLM output. `\S+` forbids whitespace but Python injection needs none (`"+__import__('os').popen('…').read()+"`). **Confidence 92%, verified** (both sites read; payload not executed). | critical |
| `bin/conduct:3022-3023` | **Python code injection → RCE.** `last=$(… .get('last_step',…))` is read from `.pipeline/conduct-state.json`, then interpolated into `python3 -c "… s.get('$last','pending')"`. `.pipeline/` is agent-writable, so a value containing `')` closes the call and executes arbitrary Python. The trailing `2>/dev/null \|\| echo "pending"` hides the error while the injected code still runs. **Confidence 92%, verified.** | critical |
| `src/conductor/src/engine/git-hook-assets.ts:232-241` | **JavaScript injection in the generated `commit-msg` hook → RCE.** The hook builds `ID_EXISTS=$(node -e " … ids.includes('$TASK_TRAILER') …")`, splicing the commit message's `Task:` trailer into a single-quoted JS string literal. A trailer containing `'` breaks out and executes arbitrary Node as the committing user. Bash does *not* re-expand the value, so `$( )`/backticks are inert — the JS-string breakout is the live vector. This is inconsistent with the repo's own correct pattern in `session-hook-assets.ts:83,137`, which passes the id as `process.argv[1]`. **Confidence 90%, verified.** | critical |
| `src/conductor/src/daemon-cli.ts:1761-1766` and `1883-1888` | Unvalidated `entry.prUrl` (see Input Validation) is interpolated into a shell string executed via `execFile('sh', ['-c', \`gh pr view "${entry.prUrl}" …\`])`. Double quotes do not stop `$(…)` or backticks. In practice the value originates from `gh pr create` output (`daemon-runner.ts:449-454`) so it is well-formed today; the sink is one poisoned `.daemon/mergeable-watch.jsonl` line away from RCE. **Confidence 88%, verified** (sink verified; the poisoning step is **inferred** — no in-repo writer produces a hostile URL). | important |
| `hooks/claude/block-destructive-git.sh:60-67` | `for b in $branches;` is unquoted, so branch operands parsed out of the LLM-supplied `tool_input.command` undergo word-splitting **and pathname expansion**. A branch name containing a glob that matches a file in cwd makes `git merge-base --is-ancestor "$b" "$default"` test a different ref than git will delete — the destructive-delete guard can be made to pass on an unmerged branch. Line 13 additionally fails **open** (`\|\| echo ""`) on any unparseable payload. **Confidence 85%, verified.** | important |
| `bin/migrate:516` | `bash -c 'set -euo pipefail; eval "$1"' migration-block "$script"` executes shell extracted from the harness `CHANGELOG.md` (`bin/migrate:340-437`) that `git pull` just fetched. This is by design and is genuinely gated — per-block y/n/a/s preview at line 596, non-TTY without `--yes` leaves blocks pending at line 570, SHA-256 applied-ledger prevents replay — but there is **no signature or checksum on the fetched tree** anywhere in `bin/update` (lines 175, 224 are a plain `git checkout` / `git pull --ff-only`). A compromised remote, or `--yes` in automation, is direct code execution. **Confidence 95%, verified.** | important |
| `bin/migrate:98` → `bin/install:1009` | The update path runs `npm ci` + `npm run build` on the newly fetched commit **before** any migration-block approval prompt, executing arbitrary npm lifecycle scripts from unverified content. **Confidence 90%, verified.** | important |
| `.github/workflows/shipped-record.yml:30` | `--pr "${{ github.event.pull_request.html_url }}"` interpolates an event expression directly into `run:`. `html_url` is server-generated and cannot contain quotes/backticks, so this is **not exploitable** — flagged because it is the one place breaking the env-var discipline used correctly at `ci.yml:20-22`. **Confidence 95%, verified.** | minor |
| `src/conductor/src/engine/self-host/write-fence.ts:41-42` | `WORKTREE_ROOT="${worktreeRoot}"` / `HARNESS_ROOT="${harnessRoot}"` are interpolated into generated bash with no escaping. Both are repo paths derived from sanitized slugs, so unexploitable today. **Confidence 88%, verified.** | minor |
| `src/conductor/src/execution/codex-provider.ts:781` | `'--config', \`model_reasoning_effort="${options.effort}"\`` interpolates into a TOML value with no escaping — a config-key injection sink, not a shell one. Bounded by the effort enum. **Confidence 85%, verified.** | minor |
| `bin/conduct:2327` | `osascript -e "display notification \"${message}\" …"` — AppleScript string breakout on a `"` in `message`. All current callers pass internal strings; theoretical today. **Confidence 85%, verified.** | minor |

**Clean and worth stating (verified):** every `git`/`gh`/provider-CLI invocation in the engine
uses `execa`/`execFile` with an **argv array**, not a shell string — `tracker-client.ts:44-52`,
`pr-labels.ts:38`, `worktree-shared.ts:61-107`, `autoheal.ts`, `ci-fix.ts`, `per-task-commit-floor.ts`,
`daemon-tmux.ts:81`. The three remaining `shell: true` sites (`full-suite-executor.ts:339`,
`scoped-run-cli.ts:30`, `conductor.ts:1977`) all execute an operator-authored
`test_suite.command`/`scoped_command` from `.ai-conductor/config.yml`, which is the intended
contract. `mermaid-renderer.ts:332,350` carries an explicit "MUST be a trusted literal" comment
and honours it.

---

### Secret Management
**Status:** NEEDS_WORK

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `.github/workflows/release-metadata.yml:21-36` | The workflow checks out the **PR head SHA** without `persist-credentials: false`, then runs `npm ci` + `npm run build` on that content and `await import()`s the artifact the PR just built — all with `pull-requests: write` (line 11). The `GITHUB_TOKEN` is left in `.git/config` and is readable by PR-authored lifecycle scripts. The trigger is `pull_request` (not `pull_request_target`), so GitHub caps fork tokens at read-only and withholds secrets — full exploitation needs a same-repo branch PR. The repo already knows the fix: `release-pr.yml:27` sets `persist-credentials: false`. **Confidence 90%, verified.** | important |
| `.github/workflows/shipped-record.yml:17-28` | Same pattern (untrusted head checkout, no `persist-credentials: false`, `npm ci` + build). Job permissions are read-only (lines 8-9), which caps the blast radius. **Confidence 90%, verified.** | important |
| `.github/workflows/release.yml:124-125` | `secrets: inherit` into the `live-daemon-e2e` reusable workflow passes **every** repo/org secret — including `RELEASE_PR_APP_ID` / `RELEASE_PR_APP_PRIVATE_KEY` — into a 30-minute live-agent smoke job that needs exactly one (`CLAUDE_CODE_OAUTH_TOKEN`). **Confidence 95%, verified.** | important |
| `.github/workflows/live-daemon-e2e.yml:25-26,53` | `CLAUDE_CODE_OAUTH_TOKEN` sits in **job-level** `env`, so it is present in the environment of `npm install --global @anthropic-ai/claude-code @openai/codex` — two unpinned third-party packages whose lifecycle scripts then run with a live OAuth token in scope. **Confidence 92%, verified.** | important |
| `bin/install:653-665` | `glow` is downloaded over HTTPS and extracted into `/tmp/glow-install-$$` (PID-predictable, `mkdir -p`, no `mktemp`) with **no checksum or signature**, then `mv`'d to `~/.local/bin/glow` and `chmod +x`. **Confidence 92%, verified.** | minor |
| `.claude/settings.json:10` + `.claude/settings.local.json:8` | `Bash(node:*)` and `Bash(python3 *)` in the permission allowlist are unrestricted-code-execution grants (`node -e "…"`). Irrelevant for daemon builds (which skip permissions anyway) but they hollow out the interactive-session prompt boundary. **Confidence 95%, verified.** | minor |
| `src/conductor/src/engine/otel/transport.ts:29-41` | The OTLP endpoint is taken from config with no scheme restriction and no auth headers — telemetry can be shipped to a plaintext `http://` collector. Config-driven, so operator choice. **Confidence 90%, verified.** | minor |

**Strong points (verified).** `engineer/intake/sanitize.ts:64-149` is a genuinely good outbound
scrub — 13 high-precision credential and PII classes, idempotent, applied at the filing choke
point (`intake/file-issue.ts:146`). `codex-provider.ts:755-774` removes every substring of the
API key from provider output. `full-suite-evidence.ts:116-154` redacts to a fixed point *after*
truncation, so truncation cannot resurrect a partial secret. `safety-diagnostics.ts:32-38`
redacts at the safety boundary. `types/events.ts:465-473` shows the event union is deliberately
constrained to closed classifications rather than raw output. `.gitignore:1-8` excludes
`.pipeline/`, `.daemon/`, `.worktrees/`, `.memory/`, and `.env`. `sandbox-build-env.ts:140-146`
injects the OAuth token by env rather than copying credentials, and `childEnv()` returns a copy.
**No hardcoded credential was found anywhere in the tree** (verified by targeted grep across
`src/`, `bin/`, `hooks/`, `.github/`).

---

### Rate Limiting
**Status:** PASS

No network-exposed endpoints exist, so classic rate limiting does not apply. The analogous
controls — bounds on unbounded autonomous work — are present and were verified:

| File:Line | Finding | Severity |
|-----------|---------|----------|
| `src/conductor/src/execution/claude-provider.ts:14,27,47` | Provider rate-limit / session-limit / auth-failure classification with backoff and model laddering. | covered |
| `src/conductor/src/engine/engineer/intake/github-issues.ts:169-174` | `REOPEN_ATTEMPTS_CAP` parks churning issues as `needs-manual`. | covered |
| `src/conductor/src/engine/mergeable-sweep.ts:658` | `MAX_WATCH_ENTRIES` cap on the watch registry. | covered |
| `src/conductor/src/engine/worktree-prepare.ts:584-590` | Project teardown is time-bound (default 120s) with no way to disable the bound. | covered |
| `src/conductor/src/engine/session-hook-assets.ts:24,172` | Hook stdin is bounded (`timeout 3 head -c 1048576`) against hang/OOM. | covered |
| `src/conductor/src/engine/worktree-prepare.ts:641-646` | `runProjectSetup` is **not** time-bound (only teardown is), so a hostile or hung `bin/setup` in a worktree blocks the daemon's critical path indefinitely. **Confidence 90%, verified** (the module docblock at lines 29-34 states the asymmetry is deliberate). | minor |

---

### OWASP Top 10
**Status:** NEEDS_WORK

| Category | Finding | Severity |
|----------|---------|----------|
| A01 Broken Access Control | `.daemon/grants` self-authorization is reachable once the write-fence is bypassed (`cli.ts:328-341` + `write-fence.ts:80-115`); owner-gate fails open for un-owned specs (`owner-gate/gate.ts:14-19`). | important |
| A02 Cryptographic Failures | No secret is stored at rest by the harness; tokens are env-injected, never copied. OTLP export may be plaintext HTTP (`otel/transport.ts:29-41`). | minor |
| A03 Injection | Three verified code-execution injections: `bin/conduct:515-522`, `bin/conduct:3022-3023`, `git-hook-assets.ts:232-241`. Plus the `sh -c` prUrl sink and the glob-splitting guard bypass. | critical |
| A04 Insecure Design | Untrusted GitHub issue text reaches an unsandboxed `--dangerously-skip-permissions` agent with **no prompt-injection boundary** (`github-issues.ts:175,235` → `engineer/loop.ts:520-540` → `session.ts:90`). Gate verdicts are parsed out of artifacts the graded agent can itself write. | important |
| A05 Security Misconfiguration | `secrets: inherit` (`release.yml:125`); job-scoped token during unpinned global npm installs (`live-daemon-e2e.yml:25-26,53`); `Bash(node:*)`/`Bash(python3 *)` allowlist entries. | important |
| A06 Vulnerable/Outdated Components | Dependency set is small and current (execa 9, js-yaml 4, semver 7, otel 1.30/0.57, vitest 2). No known-bad pin observed. `lycheeverse/lychee-action@v2` (`ci.yml:125`) is the only non-GitHub action and is tag-pinned, not SHA-pinned. Full audit belongs to `cto-dependencies`. | minor |
| A07 Identification/Auth Failures | `release-metadata.yml:18` and `release-pr.yml:17` gate on `github.event.pull_request.head.ref`, which the PR author chooses — a branch literally named `automation/release-pr` skips release-metadata validation. The publish path uses the stronger `appLogin` check (`release.yml:63,180`), so only the metadata check is spoofable. **Confidence 88%, verified.** | important |
| A08 Software/Data Integrity Failures | `bin/update` fetches and `bin/migrate:516` evals with no signature/checksum; `bin/install:1009` runs `npm ci` on the fetched tree pre-approval; `bin/install:653-665` installs an unverified binary; `ci.yml:27` executes the docs-only detector **from the PR's own tree** — a PR editing `.github/scripts/ci-detect-docs-only.sh` to print `docs_only=true` skips integrity, shellcheck, lint, typecheck and conductor jobs while `ci-gate` (lines 131-153) still reports success, because skipped ≠ failure. **Confidence 90%, verified.** | important |
| A09 Logging/Monitoring Failures | Strong: one event spine, closed event schema, `.pipeline/events.jsonl` + `.daemon/daemon.log`, redaction at the safety and evidence boundaries. Gap: **the injection sinks above fail silently** — `bin/conduct:3023` and the same `2>/dev/null \|\| echo` pattern at lines 1020, 1274-1289, 2026, 2546-2548, 2821, 2856 swallow the error while injected code still executes. | important |
| A10 SSRF | Only two user-supplied URL surfaces: the OTLP endpoint (config, no scheme validation) and PR/issue URLs handed to `gh` (which resolves them server-side). No fetch of arbitrary user-supplied URLs. | covered |

---

### Summary

**Overall Verdict:** NEEDS_WORK

**Critical findings:** 3
**Important findings:** 15
**Minor findings:** 13

**Critical findings detail:**

- **`bin/conduct:515-522`** (source `bin/conduct:971`) — `save_state` splices its arguments raw
  into an unquoted `python3 << PYEOF` heredoc (`state["$step"] = "$status"`). The
  `assess_verdict` value is grepped out of an LLM-authored assessment markdown, giving
  LLM-controlled text a direct path to arbitrary Python execution as the operator.
  *Fix shape:* pass values via `env` and read them with `os.environ`, never by interpolation.
  **Confidence 92%, verified.**

- **`bin/conduct:3022-3023`** — the `last_step` value read from the agent-writable
  `.pipeline/conduct-state.json` is interpolated into `python3 -c "… s.get('$last','pending')"`.
  A crafted state file executes arbitrary Python; the `2>/dev/null || echo "pending"` fallback
  hides the failure while the code runs. *Fix shape:* same — `env` + `os.environ`, and stop
  degrading to a default on parse failure.
  **Confidence 92%, verified.**

- **`src/conductor/src/engine/git-hook-assets.ts:232-241`** — the generated `commit-msg` hook
  builds `node -e "… ids.includes('$TASK_TRAILER') …"`, splicing the commit message's `Task:`
  trailer into a JS string literal. A single quote in the trailer escapes into executable
  JavaScript. The repo's own `session-hook-assets.ts:83,137` already demonstrates the correct
  fix — pass the id as `process.argv[1]`.
  **Confidence 90%, verified.**

**The pattern behind all three.** Every critical is the same defect class: a value that
originates from LLM output or agent-writable state is spliced into an interpreter's source
text instead of being passed as data. The harness already has the correct idiom in two places
(`session-hook-assets.ts` argv passing; `tracker-client.ts` argv arrays for every `gh`/`git`
call) — the failures are the sites that drifted from it. Per this repo's own "deterministic
where possible" principle, the durable fix is a shellcheck/integrity check that rejects
`$VAR` inside `python3 -c`/`node -e`/heredoc bodies in `bin/` and in the hook-asset string
literals, not a review convention.

**Highest-leverage non-critical fixes, in order:**
1. `persist-credentials: false` on the untrusted-head checkouts (`release-metadata.yml:21-23`,
   `shipped-record.yml:17-19`).
2. Replace `secrets: inherit` (`release.yml:125`) with an explicit single-secret mapping.
3. Run `ci-detect-docs-only.sh` from the base ref, and make `ci-gate` treat `skipped` as
   not-passing (`ci.yml:27,131-153`).
4. Quote the `for b in $branches` loop in `hooks/claude/block-destructive-git.sh:67` and make
   its payload-parse failure fail closed.
5. Validate `prUrl` shape on read in `mergeable-sweep.ts:148-166`, and replace the `sh -c`
   `gh pr view` calls in `daemon-cli.ts:1761,1883` with argv arrays.

**Explicitly not assessed here:** full dependency CVE audit (belongs to `cto-dependencies`),
test coverage of these paths (belongs to `cto-testing`).
