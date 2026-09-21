Waives: outcome-1, outcome-2, outcome-3, outcome-4

Rationale: these are the four declaration-mechanism outcomes of jstoup111/ai-conductor#1219 (a
project-declarable live-boundary fingerprint exclusion and its safety properties). This spec
deliberately does not deliver them. The pre-stories architecture review returned BLOCKED on the
mechanism: it contradicts approved adr-2026-08-17-structural-live-checkout-containment decision 4
("no exclusion is added"), and its latency premise is falsified by measurement (the generated tree
costs about 20 ms of a 410 ms walk, and both bulk-cost candidates were already excluded before the
2026-07-31 incident). The operator selected resolution R-1 on 2026-09-21: ship the
fingerprint-duration signal (outcome-5) with the guard pinned unchanged (outcome-6), and defer the
declaration mechanism until the emitted duration attributes the pre-provider interval. Issue #1219
stays open, narrowed to these four outcomes; the spec PR references it without closing it.
