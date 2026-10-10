**Status:** Accepted

# Stories: Rejected build_review reviewer output is retained for diagnosis

Source: jstoup111/ai-conductor#3099. Technical track, Tier S.

## Story 1: A rejected reviewer response is retained per lap, rubric, and attempt

**Requirement:** Technical intent — after the engine rejects a reviewer's structured result, the operator can read exactly what that reviewer returned, for built-in and custom rubrics alike, for every attempt on the lap, without the retention changing any review outcome.

As an operator whose `build_review` rubric keeps failing with `invalid-structured-result`, I want each rejected response kept on disk and linked from the fault event so that I can tell reviewer error from engine or snapshot error before choosing to retry, switch provider, or record reduced coverage.

### Acceptance Criteria

#### Happy Path
- Given a built-in `testQuality` reviewer whose structured result the engine rejects as `invalid-structured-result` on lap `<lap>`, when `build_review` settles that rubric, then `.pipeline/build-review-rejections/<lap>/testQuality.1.json` exists with `version` 1, `rubric` `testQuality`, `attempt` 1, `reason` `invalid-structured-result`, the same `detail` and `rejection` the fault carries, the rejected structured value, and the provider's final output text.
- Given an installed custom rubric `eventSpine` whose structured result the engine rejects on lap `<lap>`, when the custom member settles, then `.pipeline/build-review-rejections/<lap>/eventSpine.1.json` exists and its `structuredResult` deep-equals the provider's `finalStructuredResult` byte-for-byte as JSON.
- Given a retained record exists for a rejection, when the engine emits that rejection's `build_review_rubric_infrastructure_failure` event, then the event carries `retainedResponsePath` naming that record's path relative to the worktree root.
- Given `eventSpine.1.json` already exists for lap `<lap>`, when the same lap is replayed and `eventSpine` is rejected again, then `eventSpine.2.json` is written with `attempt` 2 and `eventSpine.1.json` is byte-for-byte unchanged.

#### Negative Paths
- Given the rejection retention directory cannot be created because a regular file occupies its path, when a rubric's structured result is rejected, then the fault keeps the same `reason`, `detail`, and `rejection`, the mechanical-fault classification is unchanged, and the emitted event has no `retainedResponsePath`.
- Given a reviewer whose structured result the engine accepts, when `build_review` settles that rubric, then no file is written under `.pipeline/build-review-rejections/` for that rubric.
- Given a rejected response whose final output text exceeds 1048576 UTF-8 bytes, when it is retained, then the record's `output` is the first 1048576 bytes of that text cut on a character boundary, `outputTruncated` is true, `outputBytes` is the original byte length, and `structuredResult` is not truncated.
- Given a custom-policy lap starts while a retained record from an earlier attempt of the same lap exists, when the lap's input digest settles, then that record is not listed as a changed input and the lap is not failed as `review-input-mutated`.

### Done When
- [ ] Every `invalid-structured-result` rejection from the built-in dispatch path and from the custom dispatch path writes one record at `.pipeline/build-review-rejections/<lap>/<rubric>.<attempt>.json` with the next unused attempt ordinal, never overwriting an existing record.
- [ ] The `build_review_rubric_infrastructure_failure` event for a retained rejection carries `retainedResponsePath`; an event whose retention failed omits it.
- [ ] Verdict, fault reason, detail, rejection, cache behavior, and mechanical-fault accounting are identical with and without retention.

## Story 2: The custom-rubric reviewer prompt is retained beside its lap artifact

**Requirement:** Technical intent — an operator can see the exact prompt a custom-rubric reviewer was given, as they already can for built-in rubrics.

As an operator diagnosing a custom rubric's rejected output, I want the prompt that custom reviewer received kept beside its lap artifact so that I can check whether the instructions or the frozen scope were what the reviewer misread.

### Acceptance Criteria

#### Happy Path
- Given an installed custom rubric `eventSpine` dispatched on lap `<lap>`, when its reviewer is invoked, then `build-review/<lap>/eventSpine.prompt.txt` under the lap's pipeline directory holds exactly the prompt text passed to the provider invocation.
- Given a retained rejection record for a custom rubric whose prompt file was written, when the record is read, then it carries `promptPath` naming that prompt file and `promptSha256` equal to the SHA-256 of the prompt file's bytes.

#### Negative Paths
- Given the custom prompt file cannot be written, when the custom reviewer is dispatched, then the reviewer is still invoked, its judged or rejected outcome is unchanged, and a retained rejection record for that dispatch omits `promptPath` and `promptSha256`.

### Done When
- [ ] A custom-rubric dispatch writes `<rubric>.prompt.txt` in the same lap directory as its `<rubric>.json` lap artifact, matching the invoked prompt byte-for-byte.
- [ ] A failed prompt write never fails, retries, or reclassifies the review.

## Story 3: A rejection that cites source regions records the frozen-input comparison

**Requirement:** Technical intent — for a custom rejection whose payload cites source regions, the operator can compare each cited region with what the engine reads at those bounds in the frozen lap input.

As an operator reading a rejection such as `source region <path>:<start>-<end> does not match the frozen head bytes`, I want every cited region compared against the frozen input in the retained record so that I can see whether the reviewer's bounds or hash were wrong or the frozen snapshot disagrees with what it read.

### Acceptance Criteria

#### Happy Path
- Given a rejected custom payload whose findings cite two head-side regions of a changed file, where the first region's `contentHash` matches the frozen head bytes and the second's does not, when the record is retained, then its `regionComparison` has two entries in citation order with `status` `match` and `content-hash-mismatch`, each carrying the cited bounds, the cited hash, the frozen `side` `head`, and the engine-computed `frozenContentHash`.

#### Negative Paths
- Given a rejected custom payload citing a region in a file that is not part of the frozen changed input, when the record is retained, then that region's comparison entry has `status` `outside-changed-input` and no `frozenContentHash`.
- Given a rejected custom payload citing a region whose `endLine` is past the end of the frozen blob, when the record is retained, then that region's comparison entry has `status` `range-outside-blob` and carries the frozen blob's `frozenLineCount`.
- Given a rejected custom payload that fails the root payload contract and contains no well-formed `findings[].sourceRegions[]` entry, when the record is retained, then the record is still written with the full `structuredResult` and an empty `regionComparison`.

### Done When
- [ ] Every well-formed cited region in a retained custom rejection gets one comparison entry, including regions after the first failing one.
- [ ] Comparison statuses are exactly `match`, `outside-changed-input`, `frozen-blob-unavailable`, `range-outside-blob`, and `content-hash-mismatch`, computed with the same hashing rule the engine uses for admission.
- [ ] Computing the comparison never changes the rejection detail or the admission outcome.
