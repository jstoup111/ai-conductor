# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-28T18:54:10.376Z
Slug: preserve-project-owned-pr-body-sections-through-fi
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-preserve-project-owned-pr-body-sections-through-fi
Head SHA: 2425365e4338de7573e45c14f37e805784198ded
Halted at: 2026-09-28T17:48:25.170Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 negative: Given a template region whose content contains the heading `## Reduced build-review coverage` or the accepted-risk start marker, when the project config loads, then loading fails with an error naming the region's step key and the engine-owned text it contains.
Task ids: 2
Done when checks: `loadConfig` in `src/conductor/src/engine/config.ts`, given `.github/pull_request_template.md` with a region naming a declared custom step ordered before `finish`, succeeds and reports that step as the region's owner in the loaded config, and given two regions naming two such steps succeeds with each step owning exactly its own region, as asserted by the region-owner config tests in `src/conductor/test/engine/config.test.ts` | `loadConfig` succeeds with zero region owners for a template with no markers and for a repository whose only marked template is at the repository root rather than `.github/pull_request_template.md`, as asserted by the unmarked-template and root-template config tests | `loadConfig` fails with an error naming the marker key and the broken rule for a region naming built-in step `finish` (built-in steps cannot own a region), an undeclared key `release-disposiiton` (undeclared step), and a declared step whose `after:` orders it after `finish` (a region owner must run before `finish`), as asserted by the three owner-rule config tests | `loadConfig` fails with an error naming the offending step key for the duplicate-key, unclosed, and nested (naming both keys) templates, and naming the step key and the engine-owned text it contains for the engine-owned-text template, as asserted by the four template-shape config tests; the duplicate-key error also states that the named key owns more than one region
Missing assertion: The cited check requires rejection of unspecified engine-owned text, but does not explicitly require rejection for `## Reduced build-review coverage` or the accepted-risk start marker.
```
