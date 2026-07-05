# Track: prd-audit-kickback-preserves-task-status

Track: technical

Source: jstoup111/ai-conductor#302.

Internal daemon self-healing correctness bug. The `prd_audit → build` kickback loses the
completed `.pipeline/task-status.json` entries and the build completion gate cannot recover
from an empty task list, producing an infinite auto-re-kick HALT loop. There is no
user-facing surface and no product requirement to enumerate — acceptance criteria are
behavioral guarantees about the daemon's engine (task-status lifecycle, kickback merge
semantics, re-kick idempotency), so they live in stories. No PRD.
