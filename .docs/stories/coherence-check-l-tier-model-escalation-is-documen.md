**Status:** Accepted

# Stories: coherence_check L-tier model escalation (#2789)

Track: technical. Scope boundary (from `.docs/track/coherence-check-l-tier-model-escalation-is-documen.md`):
minimal — the L-tier `coherence_check` escalation on both providers; M/S tiers unchanged.

## Story 1: L-tier coherence_check resolves to the deepest-tier model on each provider

**Requirement:** Technical intent — #2789 desired outcome 1

As an operator running an L-tier spec through the daemon, I want `coherence_check` to resolve to the
deepest-tier model of the active provider so that the traceability pass gets the reasoning depth the
coherence-check skill promises for Large specs.

### Acceptance Criteria

#### Happy Path
- Given the Claude provider policy and no operator model configuration for `coherence_check`, when the resolved step config is computed for `coherence_check` at tier `L`, then the model is `opus` and the effort is `medium`
- Given the Codex provider policy and no operator model configuration for `coherence_check`, when the resolved step config is computed for `coherence_check` at tier `L`, then the model is `gpt-5.6-sol` and the effort is `medium`

#### Negative Paths
- Given the Claude provider policy, when the resolved step config is computed for `coherence_check` at tier `M`, then the model stays `sonnet` (Codex: `gpt-5.6-terra`) with effort `medium`
- Given the Claude provider policy, when the resolved step config is computed for `coherence_check` at tier `S` or with no tier, then the model stays `sonnet` (Codex: `gpt-5.6-terra`)
- Given an operator config that sets `steps.coherence_check.model` to `sonnet`, when the resolved step config is computed for `coherence_check` at tier `L` on the Claude provider, then the model is `sonnet` — operator configuration still outranks the policy tier pin

### Done When
- [ ] Resolving `coherence_check` at tier `L` returns `opus` under the Claude policy and `gpt-5.6-sol` under the Codex policy, asserted by a test
- [ ] Resolving `coherence_check` at tiers `M`, `S`, and no tier returns the unchanged base models, asserted by a test
- [ ] An operator `steps.coherence_check.model` setting overrides the L-tier pin, asserted by a test
