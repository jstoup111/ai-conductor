---
name: build-review-security
disable-model-invocation: true
description: "Judge whether a feature diff introduces concrete security defects in the closed security vocabulary."
enforcement: gating
phase: build
---

## Purpose

Judge the Security concern for one engine-managed `build_review` rubric branch. This is a
judgement-only contract: the engine owns scope selection, evidence assembly, result validation,
finding identity, the stamped result envelope, and the outer gate verdict.

## Input projection (v3)

Use only the supplied projection version `v3`. Its closed input contains the lap ID, snapshot
digest, content digest, merge base, head SHA, and the whole changed diff by reference
(`changedFiles`: each changed path, change kind, and hunk ranges).

The session runs inside the feature worktree. The diff content is not embedded: read referenced
files and obtain any per-path diff with `git diff <mergeBase>..HEAD -- <path>` (or inspect base
content with `git show <mergeBase>:<path>`). Those worktree reads are part of this closed input.
Do not infer facts from a maker transcript, task-status narrative, a prior review, or state outside
this projection and its referenced content.

## Judgement

Judge whether the changed diff introduces a concrete, exploitable defect in the closed vocabulary
below. Report one finding per independent defect. Anchor every finding to the changed hunk that
introduces the exposure, never to an unchanged sink; cite unchanged sinks only in
`evidenceLocations`. A concern without an introducing hunk is not a finding for this rubric.

- `committed-secret` — a changed production path commits a credential that has a credible live
  credential shape and can authenticate or authorize access. **Non-finding:** an obviously fake,
  redacted, documented, or test-only fixture credential is not a committed secret.
- `injection` — a changed hunk sends untrusted input into a shell, SQL, interpreter, template, or
  equivalent execution sink without safe parameterization or escaping. **Non-finding:** a
  parameterized query or fixed command whose arguments never contain attacker-controlled input is
  not injection.
- `broken-access-control` — a changed hunk removes, bypasses, or weakens an authorization check so
  an otherwise protected action can be reached. **Non-finding:** a relocated check that still
  protects the same action, or an endpoint intentionally public by its established contract, is
  not broken access control.
- `path-traversal` — a changed hunk derives a filesystem path from untrusted input without
  containment enforcement. **Non-finding:** a normalized path checked against an allowed root, or
  a fixed application-owned path, is not path traversal.
- `unsafe-deserialization` — a changed hunk deserializes untrusted data with a mechanism that can
  construct executable or unsafe object state. **Non-finding:** parsing data with a constrained,
  non-executing parser and validating its resulting schema is not unsafe deserialization.
- `cryptographic-failure` — a changed hunk introduces broken cryptographic use, such as a
  predictable secret, obsolete primitive for a security decision, or disabled verification.
  **Non-finding:** ordinary non-security hashing, or an established modern primitive used with its
  required verification, is not a cryptographic failure.
- `security-misconfiguration` — a changed hunk enables an insecure production-facing setting,
  exposure, or default with concrete security impact. **Non-finding:** an explicitly local,
  test-only, or development setting that cannot reach a production boundary is not a security
  misconfiguration.
- `authentication-failure` — a changed hunk accepts an identity without required credential,
  session, token, or signature validation. **Non-finding:** a failed-login response, a deliberate
  anonymous route, or validation preserved in an invoked boundary is not an authentication failure.
- `integrity-failure` — a changed hunk accepts security-sensitive data or artifacts without a
  required integrity check, allowing tampering to affect a decision. **Non-finding:** data with no
  integrity requirement, or data verified before use by the changed flow, is not an integrity
  failure.
- `ssrf` — a changed hunk sends request-controlled network destinations without an allow-list or
  equivalent boundary that prevents access to internal or unintended hosts. **Non-finding:** a
  fixed destination, or a request URL constrained to an approved host set before dispatch, is not
  SSRF.

Do not report style concerns, broad architectural preferences, dependency-version changes, or
vulnerable-component claims: they are outside this vocabulary. Do not report a hypothetical risk
without concrete changed-hunk evidence that makes it exploitable.

## Result contract (v3)

Return exactly one provider payload JSON object with a required `findings` array. Do not return
`kind`, `rubric`, `contractVersion`, `lapId`, `snapshotDigest`, or `verdict`: the engine stamps the
`judged` envelope identity after validating this provider payload. Return every independent
finding; an empty array means no Security concern was found.

```json
{
  "findings": [
    {
      "concernKind": "committed-secret | injection | broken-access-control | path-traversal | unsafe-deserialization | cryptographic-failure | security-misconfiguration | authentication-failure | integrity-failure | ssrf",
      "confidence": 85,
      "summary": "string",
      "evidenceLocations": ["path:line"],
      "anchor": {
        "rubric": "security",
        "locus": {
          "path": "string",
          "contentHash": "sha256:string",
          "display": "string",
          "occurrence": "optional non-negative integer"
        }
      }
    }
  ]
}
```

**Closed vocabulary:** `committed-secret`, `injection`, `broken-access-control`, `path-traversal`, `unsafe-deserialization`, `cryptographic-failure`, `security-misconfiguration`, `authentication-failure`, `integrity-failure`, `ssrf`.

**Reference grammar:** `anchor.locus` is a `content-region` reference:
`{ path, contentHash, display, occurrence? }`. `occurrence` is the 0-based ordinal among
equal-content regions in one path. Omit it for a unique region or the first equal-content region;
for each later duplicate, supply its ordinal (for example, `1` for the second region).

Each finding has a `concernKind` from the closed vocabulary, a nested `security` anchor, an
actionable summary, and concrete evidence locations. `confidence` is an optional integer from 0
through 100: include it whenever you can calibrate it to the evidence, rather than treating
uncertainty as a reason to invent a finding. A finding that omits `confidence` is treated as
blocking by the engine (absent means blocking), so omit it only when you cannot calibrate. The anchor `locus` is the immutable changed content-region reference; it is never
flattened to the finding's top level.

The engine validates anchors, canonicalizes identities, stamps the envelope, and decides the
branch and outer verdict. This skill judges only the supplied frozen projection; it does not read,
write, or apply a disposition.

## Verification

- [ ] Every finding uses one closed-vocabulary concern kind, an integer `confidence` when one is
      supplied, and a nested `security` content-region anchor for the introducing hunk.
- [ ] Every finding has concrete evidence locations; unchanged sinks appear only there, never as
      anchors.
- [ ] Each independent defect has one finding; an empty `findings` array is used when no concrete
      defect in the closed vocabulary is introduced.
- [ ] No result invents a concern from an unchanged hunk, a design-only concern, a manifest-only
      change, or a fake test credential.
