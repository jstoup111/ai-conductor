# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-10-03T15:52:05.045Z
Slug: report-absent-overlap-scan-candidate-paths-instead
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-report-absent-overlap-scan-candidate-paths-instead
Head SHA: f9d84673f3a7c590847e1a5e5efde6457aff3b43
Halted at: 2026-10-03T13:22:57.877Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 negative: Given no candidate paths were supplied at all, when the scan runs, then the report states that nothing was scanned for overlap and does not contain the clean "no overlap detected" line.
Task ids: 2
Done when checks: The scan appends one advisory note per absent candidate path, one note when classification failed, and one note stating nothing was scanned when the candidate list is empty. | A real-git case over a mixed present/absent candidate list renders both the sibling-branch overlap line for the present path and a notice naming the absent path. | A real-git case whose candidate paths are all present and uncontended renders exactly the existing single clean line unchanged, and a real-git case whose candidate paths are all absent renders no clean line. | A scripted-git case proves a failing classification command still returns every sibling-branch overlap found in that run and never throws. | A real-git case proves a candidate path absent from the checkout but created by a sibling branch is still reported as an overlap on that branch.
Missing assertion: does not contain the clean "no overlap detected" line

Criterion: Story 1 negative: Given the git invocation that classifies candidate paths fails, when the scan runs, then the report carries an advisory note naming that failure, still lists every sibling-branch overlap it found, and the command exits 0.
Task ids: 1, 2
Done when checks: The helper returns exactly the candidate paths absent from the combined tracked-and-present listing, in input order, with repeats collapsed to one entry. | The helper returns its classification-failed result naming the git exit status when the listing command exits non-zero, and reports no path as absent in that case. | Unit cases cover present-only, absent-only, mixed, and empty candidate lists plus the leading-dot-slash and backslash spellings, and the helper throws in none of them. | The scan appends one advisory note per absent candidate path, one note when classification failed, and one note stating nothing was scanned when the candidate list is empty. | A real-git case over a mixed present/absent candidate list renders both the sibling-branch overlap line for the present path and a notice naming the absent path. | A real-git case whose candidate paths are all present and uncontended renders exactly the existing single clean line unchanged, and a real-git case whose candidate paths are all absent renders no clean line. | A scripted-git case proves a failing classification command still returns every sibling-branch overlap found in that run and never throws. | A real-git case proves a candidate path absent from the checkout but created by a sibling branch is still reported as an overlap on that branch.
Missing assertion: the command exits 0

Criterion: Story 2 happy: Given `--files` appears more than once, and some occurrences carry comma-separated values, when the command line is parsed, then every value from every occurrence is a candidate path, in the order given.
Task ids: 3
Done when checks: Parsing `--files` followed by several bare tokens yields every token as a candidate path, and a repeated `--files` yields the union of every occurrence's values in the order given. | Parsing `--files` immediately followed by another recognized option and its value yields an empty candidate list and leaves that option's own parsed value correct. | A real dispatch over a space-separated mixed candidate list prints the present path's sibling-branch overlap line and the absent path's notice and returns exit code 0.
Missing assertion: some occurrences carry comma-separated values
```
