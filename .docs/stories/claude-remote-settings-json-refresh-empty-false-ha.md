# Stories: Claude remote-settings.json empty-to-{} refresh false-halts self-host builds (#3096)

**Status:** Accepted
**Track:** technical
**Complexity:** Small
**Source:** jstoup111/ai-conductor#3096

---

## Story 1: Semantically empty Claude remote settings are one fingerprint state

As a harness operator running self-host builds, I want a Claude remote-settings refresh that only flips `remote-settings.json` between empty and `{}` to leave the build running, so that I stop clearing false halts by hand while real managed-policy changes still halt the build.

"Semantically empty" means the file's content is zero bytes, whitespace only, or JSON that parses to an object with no keys (surrounding whitespace allowed).

### Acceptance Criteria

#### Happy Path
- Given a Claude provider-state home whose root `remote-settings.json` is zero bytes at fingerprint time, when the file is rewritten to `{}` before verification, then `verifyLiveBoundary` returns ok with no provider-state halt
- Given a Claude provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is rewritten to zero bytes, or to `{}` followed by a newline, or to whitespace only, before verification, then `verifyLiveBoundary` returns ok with no provider-state halt
- Given a Claude provider-state home whose root `remote-settings.json` holds managed settings content at fingerprint time, when the file is left unchanged, then `verifyLiveBoundary` returns ok

#### Negative Paths
- Given a Claude provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is rewritten to a non-empty object such as `{"permissions":{"deny":["Bash"]}}`, then verification fails with a provider-state reason naming `changed remote-settings.json`
- Given a Claude provider-state home whose root `remote-settings.json` holds a non-empty object at fingerprint time, when the file is rewritten to `{}` or to zero bytes, then verification fails with a provider-state reason naming `changed remote-settings.json`
- Given a Claude provider-state home with no `remote-settings.json` at fingerprint time, when an empty or `{}` `remote-settings.json` is created before verification, then verification fails with a provider-state reason naming `added remote-settings.json`
- Given a Claude provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is deleted before verification, then verification fails with a provider-state reason naming `removed remote-settings.json`
- Given a Claude provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is rewritten to content that is not valid JSON, or to JSON that is not an object such as `[]` or `null`, then verification fails naming `changed remote-settings.json`
- Given a Claude provider-state home with a nested lookalike such as `rules/remote-settings.json` that is `{}` at fingerprint time, when that nested file is rewritten to zero bytes, then verification fails naming that nested path
- Given a Codex provider-state home whose root `remote-settings.json` is `{}` at fingerprint time, when the file is rewritten to zero bytes, then verification fails naming `changed remote-settings.json`
- Given a live checkout whose root `remote-settings.json` is untracked and `{}` at fingerprint time with containment unproven, when it is rewritten to zero bytes, then verification fails as unexplained live-checkout drift

### Done When
- [ ] `src/conductor/src/engine/self-host/live-boundary.ts` canonicalizes only the Claude provider-state root `remote-settings.json` digest when its content is semantically empty, and adds no entry to any volatile or exclusion list
- [ ] The exhaustive provider volatile table assertion in `src/conductor/test/engine/self-host/live-boundary.test.ts` is unchanged
- [ ] New tests in `src/conductor/test/engine/self-host/live-boundary.test.ts` cover every criterion above and fail against the pre-change implementation for the first two happy-path criteria
- [ ] The source comment beside `CLAUDE_PROVIDER_STATE_VOLATILE` records why `remote-settings.json` is normalized rather than excluded, citing #3096
