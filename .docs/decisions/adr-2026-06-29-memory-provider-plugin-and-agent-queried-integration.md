# ADR: Memory Provider Plugin Kind & Agent-Queried Integration

**Date:** 2026-06-29
**Status:** APPROVED
**Deciders:** James (operator), Claude (architecture-review)

## Context

The Pluggable Memory PRD (`.docs/specs/2026-06-29-pluggable-memory-source.md`) requires that an
operator can back a project's memory with different platforms (FR-1), that **the LLM performs all
retrieval** against the active platform (FR-3, the architectural invariant), and that each
non-default platform carries its own LLM-facing guidance (FR-4). Open Question 1 asks *how
platforms integrate so the LLM can query them directly* (an MCP-server model vs. alternatives).

Forces:
- **FR-3 is a hard invariant.** The harness must contain **no** search, ranking, relevance, or
  embedding logic for memory. Whatever the integration mechanism, retrieval must be the agent
  talking to the platform, not the harness computing relevance.
- The harness **already has a plugin architecture** (`README.md` plugin section): kinds
  (`llm_provider`, `ui_renderer`, `step`, `hook`, `visualizer`), manifests at
  `~/.ai-conductor/plugins/<kind>/<name>/plugin.yml`, selected via a field in
  `.ai-conductor/config.yml`. Adding a memory dimension should reuse this, not invent a parallel one.
- The harness **already registers MCP servers** the agent queries directly, via
  `claude mcp add --scope user <name> -- <entrypoint>` (Serena is the working precedent;
  `bootstrap/SKILL.md:342-347`). MCP is precisely "a service the agent queries," which is the
  shape FR-3 wants for non-default platforms.
- A prior draft (`draft-memory-mcp-service.md`, 2026-03-29) proposed a hosted memory **service that
  does server-side ranking/embeddings and that the harness calls**. The PRD's superseded-drafts note
  explicitly rejects "retrieval logic in the harness" as the wrong layer. We keep that draft's MCP
  *integration* insight and discard its harness-owns-retrieval framing.

## Options Considered

### Option A: New `memory_provider` plugin kind; default = built-in local store; non-default = agent-queried MCP server
- **How:** Extend the existing plugin model with a `memory_provider` kind. The **default** provider
  is the built-in local-file store (no MCP, no service — FR-8). A **non-default** provider is
  delivered as an MCP server the agent queries directly for recall/persist; the harness's only jobs
  are *resolve which provider is active* and *make it available* (register the MCP server, surface its
  guidance). The harness never issues a search or computes relevance.
- **Pros:** Reuses the established plugin + MCP precedents (low new surface); the agent-queries-MCP
  shape *is* FR-3 by construction; default path keeps zero dependencies; symmetric with
  `llm_provider`/`ui_renderer`.
- **Cons:** Couples non-default memory to the MCP ecosystem; an operator wanting a non-MCP platform
  must wrap it as an MCP server.

### Option B: Harness-mediated provider interface (harness calls a provider API, returns results to agent)
- **How:** Define a harness-internal `MemoryProvider` interface with `recall(query)`/`store(entry)`;
  the harness calls the provider and hands results to the agent.
- **Pros:** Uniform internal abstraction; provider need not speak MCP.
- **Cons:** **Violates FR-3** — the moment the harness calls `recall(query)` and chooses what to
  return, it owns retrieval/relevance. This is the exact "wrong layer" the PRD rejects. Rejected.

### Option C: Hosted memory service with server-side semantic search (the 2026-03-29 draft)
- **Pros:** Cross-project semantic retrieval, managed decay/dedup.
- **Cons:** Server-side ranking is still *someone other than the in-context agent* deciding
  relevance, and the harness integration in that draft calls the service — same FR-3 problem at a
  different layer. Also adds infra/network/cost the PRD scopes to later phases. Rejected for Phase 1;
  may return as a *Phase 2 provider* that the agent queries via MCP (not via harness calls).

## Decision

Adopt **Option A**: a new **`memory_provider` plugin kind**.

- **Default provider** = the built-in local-file store (today's `.memory/`, behavior-identical per
  FR-9). It requires no MCP, no service, no credentials (FR-8). Recall is the agent reading the store
  and judging relevance, exactly as today.
- **Non-default providers** integrate as **MCP servers the agent queries directly**. The agent issues
  recall and persist against the provider; relevance is the agent's (and the platform's) judgment.
- **The harness's role is strictly resolve-and-expose:** determine the active provider (adr-2026-06-29-per-project-memory-provider-selection),
  register/avail its MCP server (adr-2026-06-29-platform-adoption-and-removal-surface), and surface its guidance (adr-2026-06-29-per-provider-retrieval-guidance-location). The harness adds **no**
  search, ranking, relevance, or embedding logic for any provider — including the default. This is the
  testable form of FR-3: *grep the harness; no such logic exists.*

Why: it satisfies FR-3 by construction (agent↔MCP is the integration, the harness is not in the
retrieval path), and it reuses two mechanisms the harness already ships (plugin kinds + `claude mcp
add`) instead of inventing new ones.

## Consequences

### Positive
- FR-3 holds structurally, not by discipline — there is no harness code path that could rank.
- Minimal new surface: one new plugin kind, reusing manifest + selection + MCP registration.
- Default stays zero-dependency and behavior-identical (FR-8, FR-9).
- Phase 2 platforms (managed memory service, vector store) slot in as MCP providers with no call-site
  changes (FR-5 scope note).

### Negative
- Non-default platforms must be exposed as MCP servers; a raw HTTP/SDK-only platform needs a thin MCP
  wrapper.
- Two integration shapes coexist (local-file default vs. MCP non-default); the resolver must treat
  "default" as a real provider, not a null case, to keep behavior uniform.

### Follow-up Actions
- [ ] Define the `memory_provider` plugin kind and its `plugin.yml` fields (entrypoint = MCP server
      launch; `guidance` reference per adr-2026-06-29-per-provider-retrieval-guidance-location; capability flags).
- [ ] Specify the built-in default provider as a first-class `memory_provider` (id e.g. `local`).
- [ ] Add a harness integrity check (grep-based) asserting no memory search/ranking/relevance/embedding
      logic exists, wiring the FR-3 "verifiable: no such logic exists" criterion.
- [ ] Cross-reference adr-2026-06-29-per-project-memory-provider-selection (selection), adr-2026-06-29-platform-adoption-and-removal-surface (adoption/MCP registration), adr-2026-06-29-per-provider-retrieval-guidance-location (guidance),
      adr-2026-06-29-memory-resilience-write-fallback-and-reconcile (resilience).
