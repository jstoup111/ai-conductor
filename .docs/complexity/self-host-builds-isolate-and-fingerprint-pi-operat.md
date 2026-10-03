# Complexity: self-host-builds-isolate-and-fingerprint-pi-operat

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None — one new catalog descriptor field family for self-host isolation shape |
| External integrations | Pi CLI home layout (`PI_CODING_AGENT_DIR`, `auth.json`, `models-store.json`, `sessions/`) |
| Auth / permission surface | Yes — operator credential copy into a throwaway home; live-boundary leak detector for Pi state |
| State machines | None new; reuses scratch lease/sweep and live-boundary fingerprint → verify lifecycle |
| Story count | ~4 behaviors (isolated home + auth, volatile fingerprint, leak sweep, catalog-driven preflights), happy + negatives |
| Files touched | ~6 production (`provider-catalog.ts`, `provider-home.ts`, `live-boundary.ts`, `conductor.ts`, `pi-provider.ts`, a new Pi self-host auth helper) plus tests |
| New runtime code | Moderate — table-izing claude/codex ternaries into catalog fields, Pi auth preparation |

## Rationale

Medium: the change crosses the security-sensitive self-host isolation boundary in several modules
and replaces provider-id branches in `conductor.ts` with catalog-declared fields, which needs an
architecture check against the provider-neutral self-host isolation ADRs. It is not Large: no new
subsystem, no new persistence, and every lifecycle (scratch lease, sweep, fingerprint/verify,
containment) already exists and is only widened to a third provider.
