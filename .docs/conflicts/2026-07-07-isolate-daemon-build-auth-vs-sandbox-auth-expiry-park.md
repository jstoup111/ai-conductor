# Conflict Report: isolate-daemon-build-auth-from-operator-oauth

**Date:** 2026-07-07
**New stories:** .docs/stories/isolate-daemon-build-auth-from-operator-oauth.md (TR-1…TR-6)
**Scanned against:** all .docs/stories/ (34 files), .docs/specs/, prior .docs/conflicts/
**Result:** 2 blocking conflicts found → RESOLVED (supersession); re-check clean

## Conflict 1: Park-resume credential re-copy vs zero operator-credential reads

**Stories involved:** sandbox-auth-expiry-park TR-3 ("Shared park-and-poll with sandbox
credential refresh on resume") vs isolate-daemon-build-auth TR-2 ("Sandbox authenticates
from the daemon token — operator credentials never read")
**Files:** .docs/stories/sandbox-auth-expiry-park.md vs
.docs/stories/isolate-daemon-build-auth-from-operator-oauth.md
**Type:** contradiction
**Severity:** blocking (confidence ~95% — texts directly oppose)

**Description:** Old TR-3 requires the sandbox `.credentials.json` be re-copied from the
operator file on park-resume and declares "resume-without-refresh is forbidden"; it also
parks on the OPERATOR credentials file. New TR-2 requires `refreshSandboxCredentials` be
deleted with zero callers and instruments the fs seam to prove ZERO reads of the operator
credentials file. Both cannot be live requirements.

**Resolution options:**
1. Supersede old TR-3 (annotate; new stories govern) — matches the already-APPROVED
   adr-2026-07-07-daemon-owned-build-credential which amends adr-2026-07-04.
2. Narrow old TR-3 to api-key mode — incoherent (api-key mode has no credentials file).
3. Kick back to architecture — only if the daemon-token design were still unsettled.

**Resolution:** Option 1, operator-approved. Supersession note added to
sandbox-auth-expiry-park.md.

## Conflict 2: Pre-flight fail-open vs fail-closed on a missing credential source

**Stories involved:** sandbox-auth-expiry-park TR-2 ("Pre-flight credential expiry check
with fail-open") vs isolate-daemon-build-auth TR-3 ("Missing daemon token HALTs with mint
instructions — never a silent fallback")
**Type:** behavioral overlap
**Severity:** blocking (confidence ~90%)

**Description:** Old TR-2 reads the operator's `claudeAiOauth.expiresAt` before dispatch
and FAILS OPEN when the file is missing (dispatch proceeds). New TR-3 reads the daemon
token before dispatch and FAILS CLOSED when it is missing (HALT naming `claude
setup-token`). In daemon-token mode both pre-flights cannot govern the same dispatch.

**Resolution:** Option 1 (supersede old TR-2), operator-approved — same supersession note.
Old TR-4's HALT-naming requirement generalizes: the new TR-4 timeout HALT names the daemon
token path instead of the operator credentials path; also covered by the note.

## Explicitly preserved (no conflict)

- sandbox-auth-expiry-park TR-1 — `AUTH_FAILURE_RE` classification (new TR-4/TR-5 reuse it).
- sandbox-auth-expiry-park TR-5 — `auth_park_timeout_minutes` knob (new TR-4 bounds parks
  with it unchanged).
- harness-self-host-guardrails stories — no credential-copy story text exists there;
  TR-5/TR-6 provisioning invariants are strengthened, not touched.
- operator-park marker / park-unpark CLI verbs — orthogonal (human-placed parks).
- Open PR #392 (rate-limit episode) — adjacent conductor retry-loop branch, different
  classification path; merge-adjacency only, no requirement conflict.
- resolved-config: `build_auth` fields are additive beside `auth_park_timeout_minutes`.

## Re-check

After supersession annotation: zero blocking conflicts remain; no degrading conflicts
accepted. PASS.
