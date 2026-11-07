# Track: Successful stacked restack halts on a stale reopen of the gate it re-pended

Track: technical

Scope boundary: Balanced. Two engine changes cover all three recorded call sites of #3469 and the
same-shape #3394. First, a conduct-state mutation batch evaluates each mutation by the approved
port's per-field rules, so a field that already holds its target value is idempotent success
instead of a conflict, and the batch still writes nothing when any field genuinely conflicts.
Second, the conductor adopts the durable value of every field it has not changed locally right
after the three boundaries where engine code writes conduct state outside the conductor's own
store calls: the resume stack preflight, the rebase step, and the rebind to a child's BUILD region.
A field the conductor has changed but not saved is never overwritten, and a peer write that lands
after an adoption still fails closed on the next write. Excluded: routing restack and leaf-return
writes through the conductor's store (attribution machinery), a new spine event for the routed
leaf return, any change to which gates a restack or leaf return re-pends, and the stacked no-op
rebase verdict (#3479, already merged).

Engine-internal state-consistency defect with no user-facing product surface; acceptance lives
directly in stories.
