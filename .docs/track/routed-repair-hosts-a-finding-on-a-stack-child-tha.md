# Track: Routed repair hosts a finding on a stack child that lacks its target file

Track: technical

Scope boundary: Fix the path evidence routed-repair hosting runs on. Resolve bare and partial file
citations to repository paths against the leaf tree, and stop counting directory citations as
prerequisite evidence. Use that same resolution in the D4 cannot-host selection and the D5
prerequisite-claim verification. Count the files cited by the text allocation renders into each
item's rem blocks as D4 prerequisite inputs, so a host always holds every file its repair blocks
cite. Add no new halt: the operator chose fewer halts and more autonomy (2026-10-31), and the leaf
always holds every resolved input, so D4 always finds a host. Excluded: splitting one finding into per-slice parts on different hosts, changes to the
residue judgement contract, and repairing the already-halted `path-policy-still-decides-feature-ownership-by-fol`
round.

Approach A, chosen by the operator 2026-10-31: engine-side citation resolution feeding the existing
D4/D5 rules. Rejected: B, hosting by the child that introduced a path, which duplicates D4 with a
parallel rule and still needs the same resolution; C, the residue judge naming target paths, which
covers residue items only, changes the judge contract, and sources git-computable evidence from LLM
output.

Internal engine routing defect (#3550) with no user-facing product behavior, so no PRD.
