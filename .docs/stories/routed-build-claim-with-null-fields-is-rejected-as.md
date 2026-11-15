**Status:** Accepted

# Stories: Routed build claims say why they are malformed, and an operator-input request wins over the claim

Source: jstoup111/ai-conductor#3643. Technical track, Tier S. Scope: the routed BUILD claim
boundary only (see `.docs/track/routed-build-claim-with-null-fields-is-rejected-as.md`).

## Story 1: A malformed routed claim names the field it got wrong

**Requirement:** #3643 desired outcomes 1, 2 and 4

As the operator, I want a refused routed BUILD claim to say which field was wrong and how, and a
claim with unused fields set to `null` to read the same as one that leaves them out, so that a
wasted attempt is diagnosable from the retry line alone.

### Acceptance Criteria

#### Happy Path
- Given the Codex payload `{"outcome":"blocked-by-prerequisite","child":null,"paths":["src/a.ts"],"symbols":null}` read back through the Codex adapter and no `.pipeline/halt-user-input-required` marker, when the routed BUILD claim is settled, then the attempt fails with detail `routed prerequisite claim is malformed: child is missing; blocked-by-prerequisite requires an integer child from 1 to 9` and that detail is the reason on the attempt's `step_retry` event.
- Given the Codex payload `{"outcome":"blocked-by-prerequisite","child":2,"paths":null,"symbols":["parseB"]}` read back through the Codex adapter, when it is parsed, then it yields the same claim as `{"outcome":"blocked-by-prerequisite","child":2,"symbols":["parseB"]}`.
- Given the Codex payload `{"outcome":"completed","child":null,"paths":["a.ts"],"symbols":null}` read back through the Codex adapter, when the routed BUILD claim is settled, then it is read as no claim and the attempt is not failed by claim settlement.

#### Negative Paths
- Given a claim whose `outcome` is `surprise`, when it is parsed, then it is refused as malformed with detail `outcome is not completed or blocked-by-prerequisite`.
- Given a `blocked-by-prerequisite` claim with symbols `["parseB"]` whose `child` is `0`, `10`, `2.5` or the string `"2"`, when it is parsed, then each is refused as malformed with detail `child is not an integer from 1 to 9`.
- Given a `blocked-by-prerequisite` claim with child 2 and both `paths` and `symbols` omitted, when it is parsed, then it is refused as malformed with detail `blocked-by-prerequisite names neither paths nor symbols`.
- Given a `blocked-by-prerequisite` claim with child 2 whose `paths` is `[]` or `[""]`, when it is parsed, then it is refused as malformed with detail `paths must be a non-empty list of non-empty strings`, and the same input in `symbols` is refused with the matching `symbols` detail.
- Given a `blocked-by-prerequisite` claim with child 2, symbols `["parseB"]` and an extra field `extra`, when it is parsed, then it is refused as malformed with detail `unknown field extra`.
- Given a claim whose `outcome` is a 5000-character string containing newlines, when it is parsed, then the malformed detail is a single line that contains none of the builder-supplied characters.

### Done When
- [ ] A parser test shows each malformed input above yields `kind: malformed` with exactly the detail stated for it.
- [ ] A settlement test shows the incident-shaped Codex payload settles as `failed` with detail `routed prerequisite claim is malformed: child is missing; blocked-by-prerequisite requires an integer child from 1 to 9`.
- [ ] A conductor test shows that detail is the `reason` of the `step_retry` event emitted for the routed BUILD attempt.
- [ ] The existing schema-agreement test still shows `parseBuilderClaim` refuses exactly the claims `PREREQUISITE_CLAIM_SCHEMA` refuses.

## Story 2: A builder's operator-input marker takes precedence over its routed claim

**Requirement:** #3643 desired outcome 3

As the operator, I want a routed builder that wrote `.pipeline/halt-user-input-required` to reach
the existing halt-marker stall handling, so that its request for input is answered by remediation
or surfaced as a halt instead of being counted as a failed claim and deleted by the next builder.

### Acceptance Criteria

#### Happy Path
- Given a routed BUILD attempt that wrote `.pipeline/halt-user-input-required` containing `Need user decision: sync the worktree` and returned a malformed claim, when the attempt settles in daemon auto mode, then a `build_stall` event with reason `halt_marker` is emitted, `.pipeline/build-stall-question.md` contains `Need user decision: sync the worktree`, the marker is cleared by the conductor, and no `step_retry` event carries a reason beginning `routed prerequisite claim`.
- Given a routed BUILD attempt that wrote the same marker and returned a well-formed `blocked-by-prerequisite` claim, when the attempt settles, then the claim is not settled, no reroute happens, the routed host's branch tip and repair marker are unchanged, and a `build_stall` event with reason `halt_marker` is emitted.

#### Negative Paths
- Given a routed BUILD attempt that returned a malformed claim and wrote no `.pipeline/halt-user-input-required` marker, when the attempt settles, then it remains an ordinary failed attempt whose `step_retry` reason is the Story 1 malformed detail and no `build_stall` event with reason `halt_marker` is emitted.

### Done When
- [ ] A conductor test with a marker and a malformed claim shows a `build_stall` event with reason `halt_marker`, the marker text in `.pipeline/build-stall-question.md`, and no `step_retry` event whose reason begins `routed prerequisite claim`.
- [ ] A conductor test with a marker and a well-formed claim shows `settleRoutedBuildClaim` is not called and the host branch tip and repair marker are unchanged.
- [ ] A conductor test without a marker shows the malformed-claim attempt still emits `step_retry` with the Story 1 detail.
