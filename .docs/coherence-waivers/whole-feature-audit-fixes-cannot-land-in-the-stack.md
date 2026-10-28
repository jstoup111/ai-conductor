Waives: outcome-1, outcome-2, outcome-3, outcome-4, outcome-5, outcome-6, outcome-7, outcome-8

Rationale: jstoup111/ai-conductor#2944's design for routing whole-feature fixes to the owning stacked
child was approved in full (`adr-2026-10-12-routed-whole-feature-repair`). Its 99-task plan was too
large to build as one feature. On 2026-10-12, during this DECIDE pass, the operator split delivery
into four sequential specs (ADR decision 18). Each is blocked by the one before it, and the routing
setting stays off until the last one ships. No outcome is dropped; each has a named home:

- **outcome-1** (classification first) and **outcome-2** (owning child): jstoup111/ai-conductor#3210.
- **outcome-3** (cannot host, earliest capable child): #3210 places the work; #3211 delivers the
  verified prerequisite reroute.
- **outcome-4** (recorded before the change, observable on the event spine): this spec delivers the
  four event members, persister dedup and the outbox drain. #3210 delivers recording the routing
  decision before mutation.
- **outcome-5** (children above re-validate, leaf gates re-run): jstoup111/ai-conductor#3212.
- **outcome-6** (feature budgets stay feature-wide) and **outcome-7** (routed tasks carry their child;
  the plan stays valid): jstoup111/ai-conductor#3211.
- **outcome-8** (landing skill): jstoup111/ai-conductor#3203, split earlier in this DECIDE pass.

outcome-9 (N=1 features unchanged) is delivered here, by the N=1 golden guard and the dark-launch
setting. #3210–#3212 each preserve it.

#3210, #3211 and #3212 each block #2945 and #784, as #2944 does. #3203 is blocked by #3212. The
approved draft stories and plan tasks for each later spec, together with the review findings still
open at the split, are attached to its issue.
