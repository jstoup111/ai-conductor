# Components: Release-Time Smoke and Eval Gate

**Last updated:** 2026-08-04
**Scope:** To-be view for `no-release-time-smoke-or-eval-gate-releases-cut-wi`
(jstoup111/ai-conductor#1259, Tier M, technical track). Adds a single auto-discovering
smoke entry point, per-file capability declaration with explicit skip reporting, a
classify/publish split in the release publisher, and a release-time smoke gate that
blocks tagging. Reuses the shipped `live-daemon-e2e.yml` (#1124, closed) rather than
rebuilding a live-agent tier.

## Diagram

```mermaid
graph TD
    subgraph Runner["Smoke entry point (src/conductor)"]
        Script["npm run smoke<br/>(NEW — package.json script)"]
        SmokeCfg["vitest.smoke.config.ts<br/>(NEW — include globs<br/>test/smoke/**, **/*.smoke.test.ts<br/>exclude: [] )"]
        DefaultCfg["vitest.config.ts<br/>(UNCHANGED — MUST keep both<br/>smoke exclusion globs)"]
        Ledger["Capability ledger reporter<br/>(NEW — per-file ran / skipped /<br/>failed + reason + evidence path)"]

        Script --> SmokeCfg
        SmokeCfg --> Ledger
    end

    subgraph Caps["Capability declaration (NEW — replaces ad-hoc env gates)"]
        Hermetic["hermetic<br/>finish-record, surgical-finish-retry,<br/>autoresolve"]
        Toolchain["toolchain / network<br/>publish-interrupted (npm),<br/>backlog-priority (gh),<br/>codex-provider (codex binary)"]
        Credentialed["credentialed<br/>claude-provider, build-token-auth,<br/>daemon-e2e-live<br/>(CLAUDE_CODE_OAUTH_TOKEN)"]

        Hermetic --> Ledger
        Toolchain --> Ledger
        Credentialed --> Ledger
    end

    subgraph Publisher["Release publisher (release-publisher-action.ts)"]
        Classify["classifyReleasePublication<br/>(NEW export — extracted pure prefix,<br/>API reads only, ZERO mutation)"]
        Publish["runReleasePublisherAction<br/>(CHANGED — consumes classify,<br/>keeps idempotent tag/release writes)"]

        Classify -- "ignored / rejected / publishable" --> Publish
    end

    subgraph Workflows[".github/workflows"]
        ReleaseYml["release.yml<br/>(CHANGED — classify, then gate,<br/>then publish)"]
        LiveYml["live-daemon-e2e.yml<br/>(REUSED — workflow_call,<br/>require_credentials: true)"]
        CiYml["ci.yml<br/>(UNCHANGED — smoke stays OFF<br/>every pull request, by cost decision)"]

        ReleaseYml -- "1. classify (free)" --> Classify
        ReleaseYml -- "2. only when publishable" --> Script
        ReleaseYml -- "2b. credentialed tier" --> LiveYml
        ReleaseYml -- "3. only when smoke green" --> Publish
    end

    Guard["test/structural/<br/>test-execution-policy.test.ts<br/>(UNCHANGED GUARD — fails if either<br/>exclusion glob leaves vitest.config.ts)"]
    Guard -.-> DefaultCfg
```

## Sequence: one release, one paid smoke run

```mermaid
sequenceDiagram
    participant Main as push to main
    participant Rel as release.yml
    participant Cls as classifyReleasePublication
    participant Smk as npm run smoke + live-daemon-e2e
    participant Pub as runReleasePublisherAction
    participant GH as GitHub tag + Release

    Main->>Rel: commit «sha»
    Rel->>Cls: event, PR provenance, audit check, VERSION/CHANGELOG
    alt ordinary merge (not the bot release PR)
        Cls-->>Rel: ignored
        Rel-->>Main: exit 0, NO smoke, NO LLM spend
    else designated release PR merge
        Cls-->>Rel: publishable, version «X.Y.Z»
        Rel->>Smk: run full tier (require_credentials true)
        alt smoke fails or credentials unavailable
            Smk-->>Rel: failed, per-case ledger + evidence path
            Rel-->>Main: job FAILS, no tag, no Release
            Note over Rel,GH: Recovery: fix forward, re-run on the<br/>same «sha». Publisher is idempotent, so<br/>re-classify then re-smoke then publish.
        else smoke green
            Smk-->>Rel: passed
            Rel->>Pub: publish «X.Y.Z»
            Pub->>GH: annotated tag + GitHub Release
            GH-->>Main: v«X.Y.Z» published
        end
    end
```

## Legend

- **`vitest.smoke.config.ts` (NEW)** — the single entry point's config. Its `include`
  globs mirror the default config's `exclude` globs, so any newly added smoke file is
  picked up with no list to edit. `exclude: []` is deliberate: Vitest merges `exclude`
  arrays additively, so this config must not extend the default one. Same pattern as the
  existing `vitest.live-smoke.config.ts`.
- **`vitest.config.ts` (UNCHANGED)** — keeps both smoke exclusion globs. This is not a
  stylistic choice: `test/structural/test-execution-policy.test.ts` re-reads the file and
  fails with `vitest.config.ts: default run includes smoke tests` if either glob is
  removed. The gate is additive; it never widens the default run.
- **Capability declaration (NEW)** — each smoke file declares what it needs (hermetic,
  toolchain/network, or credentialed) instead of carrying a bespoke env var. This
  replaces three incompatible polarities in use today: opt-in vars
  (`AUTORESOLVE_SMOKE_TEST`, `CODEX_CLI_SMOKE_TEST`, `PRIORITY_GH_SMOKE`), kill-switch
  vars (`MODEL_UNAVAILABLE_SMOKE=0`, `AUTH_FAILURE_SMOKE=0`, `BUILD_TOKEN_AUTH_SMOKE=0`,
  `DAEMON_E2E_LIVE_SMOKE=0`), and three files with no gate at all. A single opt-in
  variable would silently disable the kill-switch files, which are meant to run by
  default when credentials exist.
- **Capability ledger reporter (NEW)** — makes failures attributable and makes an
  uncredentialed run impossible to mistake for a pass. Reports every discovered file as
  ran / skipped / failed, with the unmet capability named and the evidence path printed.
  At release time an unmet capability is an error, not a skip.
- **`classifyReleasePublication` (NEW export)** — an extraction, not a redesign. The
  publisher already computes full publish authority from event, PR provenance, the
  head-bound `release-candidate-audit` check, and the committed `VERSION`/`CHANGELOG.md`
  before it mutates anything. Splitting that prefix out lets the workflow answer "would
  this push publish?" using API reads only.
- **The cost seam** — `release.yml` triggers on *every* push to `main`, and most of those
  are ordinary feature merges the publisher already returns `ignored` for. Running smoke
  before classify would charge an LLM run per merge. Classifying first reduces that to one
  paid run per release, which is the operator's binding constraint on this feature.
- **`live-daemon-e2e.yml` (REUSED)** — already carries `workflow_call`, a
  `require_credentials` input, and explicit credentialed-vs-skipped step-summary
  reporting. #1124 shipped and is closed; this feature wires it to a trigger rather than
  rebuilding it.
- **`ci.yml` (UNCHANGED)** — deliberately keeps smoke off pull requests. Earlier detection
  was weighed and rejected on cost: a credentialed live run on every PR is continuous
  token spend for a signal this feature only needs to be true at release.
- **Recoverability** — a smoke failure performs no mutation, so nothing must be undone.
  The publisher's existing skip-if-tag-exists and skip-if-release-exists behavior makes a
  re-run on the same commit safe and convergent.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-04 | Initial generation | To-be architecture for #1259 |
