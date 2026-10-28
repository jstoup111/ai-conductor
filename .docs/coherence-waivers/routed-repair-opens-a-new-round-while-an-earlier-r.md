Waives: outcome-1, outcome-2

Rationale: both narrowings are operator decisions made during DECIDE on 2026-10-26.

outcome-1 asks that no routed round open while another round has a pending, admitted, repairing or
built host. Read literally, that forbids the revalidation round that `adr-2026-10-12-routed-whole-feature-repair`
decisions 6 and 14 deliberately nest inside an open audit round: its child hosts are settled, its
leaf host is still `pending`, and host selection returns the queue before the leaf. The operator chose
a kind-aware fence. An `audit` round opens only when no other round is non-closed. A `revalidate`
round opens only while every other non-closed round has no `admitted`, `repairing` or `built` host
and is waiting on the queue. Story 2 specifies this, and the D7 #3445 amendment records it.

outcome-2 asks that a feature holding two open rounds halt naming both rounds. The operator chose
self-heal instead: resume finishes the round that owns the repair marker, then runs the older round's
unadmitted hosts (Story 3). Only a state that reconciliation cannot advance halts, with a `mechanical`
HALT naming every open round. The daemon re-kicks it, and the third consecutive identical stop is
written needs-human (Story 4). The outcome's core, never failing silently, is delivered. Halting
where the engine can recover was rejected under bounded autonomy.
