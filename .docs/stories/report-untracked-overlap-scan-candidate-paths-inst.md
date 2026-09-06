**Status:** Accepted

# Stories: Report untracked overlap-scan candidate paths instead of a false clean verdict (#875)

Track: technical

Tier: S

Approved by the operator on 2026-09-06 (delegated). Scope is candidate-path classification, the clean-verdict rule, and candidate capture at the command line. Rename detection, name-only-diff detection, the intersection rule, branch enumeration, and the blocker sweep remain outside this slice. The scan stays advisory and still exits 0 in every case below.

## Story 1: Never print a clean verdict the scan did not earn

As a plan author, I want the advisory overlap scan to tell me which candidate paths it could not find in my checkout, so that a planned-new file cannot silently turn a contended file set into a "no overlap detected" report.

### Acceptance Criteria

#### Happy Path

- Given a candidate list holding one path present in the checkout that an unmerged sibling branch also changes and one path absent from the checkout, when the scan runs, then the report names the sibling branch with the present path and separately names the absent path as not present in the checkout.
- Given every candidate path is present in the checkout and no sibling overlap, blocker, or degradation applies, when the scan runs, then the report is the existing single clean line and names no candidate path.
- Given a candidate path is absent from the checkout but an unmerged sibling branch creates it, when the scan runs, then the report still names that branch and that path as an overlap alongside the not-present notice.

#### Negative Paths

- Given every candidate path is absent from the checkout, when the scan runs, then the report names each absent path and does not contain the clean "no overlap detected" line.
- Given no candidate paths were supplied at all, when the scan runs, then the report states that nothing was scanned for overlap and does not contain the clean "no overlap detected" line.
- Given the git invocation that classifies candidate paths fails, when the scan runs, then the report carries an advisory note naming that failure, still lists every sibling-branch overlap it found, and the command exits 0.

### Done When

- [ ] A real-git scan over a mixed present/absent candidate list yields both the sibling-branch overlap line for the present path and a notice naming the absent path.
- [ ] A real-git scan whose candidate paths are all present and uncontended still renders exactly the existing single clean line.
- [ ] A scan with zero present candidate paths, and a scan with zero candidate paths at all, each render a report with no clean line.
- [ ] A failing classification command yields an advisory note and a still-populated overlap list, with the command's exit code unchanged at 0.

## Story 2: Keep every candidate path the operator passed

As a plan author, I want every path I hand to `--files` to reach the scan, so that a path list written with spaces rather than commas cannot silently shrink to its first entry.

### Acceptance Criteria

#### Happy Path

- Given `--files` is followed by several space-separated paths, when the command line is parsed, then every one of those paths is a candidate path.
- Given `--files` appears more than once, and some occurrences carry comma-separated values, when the command line is parsed, then every value from every occurrence is a candidate path, in the order given.

#### Negative Paths

- Given `--files` is followed immediately by another recognized option and its value, when the command line is parsed, then neither the option nor its value becomes a candidate path and that option keeps its own parsed value.

### Done When

- [ ] Parsing a space-separated `--files` list yields every listed path as a candidate.
- [ ] Parsing repeated `--files` occurrences with mixed comma and space separation yields the union of their values in order.
- [ ] Parsing `--files` immediately followed by another option yields an empty candidate list and the correct value for that other option.
- [ ] A single real dispatch over a mixed present/absent, space-separated list prints the present path's sibling overlap and the absent path's notice, and returns exit code 0.

## Negative-category review

Invalid input is covered by the absent-path, zero-candidate, and option-adjacency criteria — those are the only ways this command's input can be wrong. Dependency unavailability and partial failure are covered by the failing classification command, which must degrade to an advisory note rather than suppress findings; that criterion also covers the resource/permission family, since every failure mode of the probe surfaces identically through its exit code. Auth, concurrency, idempotency, cascade deletion, immutability, and data-integrity categories are inapplicable: the scan is read-only, holds no state between invocations, writes no record, and calls no third-party service on any path exercised here. Timeouts against the linked-issue blocker sweep are already owned by existing coverage and are unchanged by this slice.
