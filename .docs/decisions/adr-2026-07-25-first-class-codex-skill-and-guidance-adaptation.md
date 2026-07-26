# ADR: First-class Codex skill and guidance adaptation

**Date:** 2026-07-25
**Status:** APPROVED
**Deciders:** James Stoup (operator), architecture review for issue #904

**Approved:** 2026-07-25

## Context

Codex is already a built-in execution provider, but the harness still installs its Codex
skill view under `~/.codex/skills`, emits repository guidance that points there, and sends
Claude-style slash skill invocations for every daemon step. Current Codex documentation instead
defines `$HOME/.agents/skills` as the user skill scope, `AGENTS.md` as automatically loaded
repository guidance, and `$skill-name` as the explicit skill invocation form in the CLI and IDE.
Codex supports symlinked skill directories at those discovery locations.

The active TypeScript conductor already owns provider selection, candidate ordering, fallback,
provider-native model and effort resolution, and step-and-provider-local sessions. However,
`executeProviderCandidates` currently receives one static prompt and reuses it for every candidate.
Resolving a Codex prompt before that loop would therefore send Codex syntax to a later Claude
fallback. Moving all prompt interpretation into `CodexProvider` would avoid that leak only by
coupling the provider transport to harness skill semantics and by rewriting arbitrary prompt text.

The same `skills/` catalog must continue to preserve shared workflow outcomes, artifacts, and
gates for Claude and Codex. Provider-specific model names, tool assumptions, delegation behavior,
and interactive instructions cannot be presented as universal contracts. Existing Claude
frontmatter and model-policy integrity checks must remain valid.

Official behavior evidence:

- [Build skills](https://learn.chatgpt.com/docs/build-skills.md) documents standalone skill
  discovery, `$` invocation, `$HOME/.agents/skills`, and symlink support.
- [AGENTS.md guidance](https://learn.chatgpt.com/docs/agent-configuration/agents-md.md) documents
  durable repository guidance loaded by Codex.
- [Skills & Plugins](https://learn.chatgpt.com/docs/skills-and-plugins.md) distinguishes a focused
  reusable skill from a distributable plugin bundle that can also include connectors and tools.

## Options Considered

### Option A: Package Codex parity as a plugin

- **Pros:** Provides an installable distribution unit and a future path to bundle connectors or
  MCP tooling.
- **Cons:** Adds a second installation and version lifecycle for behavior that is part of the
  built-in provider; does not by itself adapt daemon prompts or shared skill contracts; plugin
  skills are not supported on every surface where standalone skills are available, including the
  IDE extension.

### Option B: Generate provider-specific skill trees

- **Pros:** Each generated tree could contain only host-native instructions and metadata.
- **Cons:** Introduces a generator/schema and generated-artifact drift for 28 workflows, duplicates
  review surfaces, and makes gate parity harder to prove. Most workflow content is already shared.

### Option C: Share one catalog and adapt only host-specific seams

- **Pros:** Keeps one authoritative workflow contract, uses documented native discovery surfaces,
  preserves direct use in Codex CLI and IDE, and confines daemon syntax adaptation to the existing
  provider candidate boundary.
- **Cons:** Shared skills need a deliberate compatibility audit and explicit conditional wording;
  tests must prove both direct discovery and every daemon dispatch path.

### Option D: Rewrite slash prompts inside `CodexProvider`

- **Pros:** Small apparent change at the point where Codex is invoked.
- **Cons:** Makes a generic provider transport parse harness workflow semantics, risks rewriting
  user-authored prompts, and leaves the provider-candidate loop unaware that fallback candidates
  require different prompt syntax.

## Decision

Choose Option C: Codex parity is first-class harness behavior built from one canonical skill
catalog, with narrow host-specific adapters at installation, repository guidance, shared
instruction content, and daemon invocation.

### 1. Keep one canonical skill source

`skills/` and `HARNESS.md` remain authoritative. #904 does not create a plugin package or generated
Claude/Codex skill trees. Shared workflow semantics, outputs, and lifecycle gates stay common.
Provider-specific instructions are explicitly scoped inside that source.

The compatibility audit must not indiscriminately remove Claude model metadata or established
integrity checks. It will distinguish valid Claude-scoped contracts from unscoped instructions
that Codex would incorrectly treat as universal.

### 2. Install to documented host discovery surfaces

The active installer maps the canonical catalog to:

- Claude: `~/.claude/skills`
- Codex: `~/.agents/skills`

Install and update create or refresh only harness-owned links. Check and uninstall evaluate the
active locations and any recognized legacy harness links. The earlier `~/.codex/skills` location
is a migration input, not a second active Codex copy.

Migration is ownership-safe: an entry may be removed or repointed only when its symlink target is
provably owned by this harness checkout/installation. Foreign links, regular files, directories,
and unrelated operator content are preserved and reported. Repeated operations converge on one
current Codex-visible harness entry per skill.

### 3. Preserve durable host-native repository guidance

Bootstrap continues to preserve existing `CLAUDE.md` and `AGENTS.md` content and appends only a
missing harness reference. Codex guidance points to the documented user skill surface and uses
`AGENTS.md`; Claude guidance remains independently valid. No provider's guidance tells the other
provider to use unsupported syntax or capabilities.

### 4. Resolve skill invocation for each actual provider candidate

The conductor retains semantic lifecycle-step intent. A pure resolver maps the supported built-in
provider key plus semantic step/arguments to an explicit skill invocation:

- Claude: `/skill-name`
- Codex: `$skill-name`

Arguments such as `--as-built` are preserved. Engine-native sentinels remain engine-native rather
than becoming fabricated skills.

For scalar execution, the step runner resolves against its actual provider. For provider-aware
execution, `executeProviderCandidates` accepts a narrow candidate-local options factory (or an
equivalent typed callback) and invokes it immediately before every candidate attempt. The callback
changes the prompt while preserving the remaining invocation options. A fallback candidate is
always resolved again; prompt syntax never crosses the provider boundary.

The candidate executor stays generic and the provider implementations remain transports. They do
not parse or rewrite arbitrary prompts. Routing order, retry classification, provider-native model
and effort selection, session isolation, and result attribution from the approved #927 design are
unchanged. Unknown/custom providers retain the existing slash behavior; third-party parity is out
of scope for #904.

### 5. Fail closed on genuinely unsupported workflow capabilities

Shared skills explicitly scope host-specific model, tool, delegation, and interactive behavior.
When a required capability has no valid Codex path, the skill stops before relying on it and names
the provider, capability, and recovery action. #904 does not introduce a generalized capability
registry unless implementation evidence proves a repeated runtime need; the initial enforcement
boundary is the skill contract plus compatibility and execution tests.

## Consequences

### Positive

- Codex support is installed and updated with the built-in provider rather than as a second
  product.
- Direct Codex use and daemon-selected Codex runs share the same authoritative workflows.
- Provider fallback cannot inherit the previous candidate's skill syntax.
- Claude behavior, provider-native policy, retries, and session isolation remain structurally
  unchanged.
- Operator-owned legacy or current skill content is not overwritten during migration.

### Negative

- Every shared skill and `HARNESS.md` must be audited for unscoped host assumptions.
- Installer check/uninstall logic must recognize both current and legacy harness-owned links
  during the migration window.
- Candidate execution gains one typed customization seam that requires scalar, preferred-provider,
  and fallback coverage.
- Changes to installed skill targets are a release-sensitive surface and require explicit upgrade
  documentation and self-host release-gate evidence.

### Follow-up Actions

- [ ] Add Codex installation, update, check, uninstall, idempotency, and ownership-safe migration
      acceptance coverage.
- [ ] Correct bootstrap guidance and prove preservation of existing `AGENTS.md` and `CLAUDE.md`.
- [ ] Add the provider-native skill invocation resolver and candidate-local options seam.
- [ ] Cover every Codex-eligible daemon step, arguments, and mixed-provider fallback direction.
- [ ] Audit shared skills and `HARNESS.md`; add deterministic compatibility checks without
      weakening existing model/frontmatter integrity contracts.
- [ ] Add actual Codex discovery/load evidence and unsupported-capability negative coverage.
- [ ] Update installation, migration, provider, and release documentation.
