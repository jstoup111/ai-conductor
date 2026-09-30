# Track: plans-cannot-declare-ordered-slices-of-one-feature

Track: technical

Scope boundary: All seven desired outcomes of jstoup111/ai-conductor#2723 — a default-off `stacked_prs.enabled` config block; a `## Slices` manifest table (Slice, Title, Tasks) placed before the first task; land refusal for every named malformation (task in no slice or two slices, empty slice, duplicate order position, unknown task id, dependency on a later slice); a fixed engine bound of 5 slices refused at land with the bound named; slice-free plans valid with the flag on or off; and re-validation of slice declarations when an amended plan is resealed (the #1700 reseal → coverage_binding path). Strict `**Dependencies:**` parsing applies only to plans that declare slices. Excluded: any build-loop, FINISH, PR-body, or merge-order behavior (#2724–#2727), lifecycle awareness (#2715), restack (#2716), and slice assignment of engine-appended remediation tasks (exempt from membership here; #2724 decides).

Engine plan grammar, land gate, and a config key for harness operators — no end-user product requirement, so acceptance criteria live in stories and no PRD is authored.
