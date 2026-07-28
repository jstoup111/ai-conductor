**Status:** Accepted

## Story: Generated interactive model rows describe both supported hosts

As a harness operator, I want every interactive model-table row to state the model-selection contract for both Claude and Codex so that I can predict which provider and model context will execute a skill or agent.

### Acceptance Criteria

#### Happy Path
- Given the interactive skills and agents registered outside the autonomous engine policy, when the model-selection table is generated, then every row is identified as a supported-host interactive path and contains non-empty Claude and Codex model-selection semantics.
- Given Codex has no per-skill model field in its supported skill metadata, when an interactive row is rendered, then its Codex cells describe inheritance from the applicable Codex session or spawned-agent configuration rather than naming a Claude model or implying cross-provider fallback.

#### Negative Paths
- Given an interactive metadata row with a missing Codex model or effort contract, when model-table validation runs, then validation fails and identifies the incomplete row instead of generating a blank provider cell.
- Given an interactive metadata row that assigns a Claude-only model alias to Codex, when provider-contract validation runs, then validation rejects the row instead of presenting the alias as a Codex model.

### Done When
- [ ] The generated model-selection table contains no Claude-only execution-path label or blank Codex contract for interactive rows.
- [ ] Focused automated checks prove incomplete and cross-provider interactive metadata cannot pass generation or drift validation.
- [ ] The generated table remains reproducible from its canonical metadata source with no hand-edited rows.
