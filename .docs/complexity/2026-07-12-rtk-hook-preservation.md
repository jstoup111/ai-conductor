# Complexity: RTK hook re-init on install & update

Tier: S

## Rationale

Operator-directed scope: the fix is essentially "just run `rtk init -g` on install and
update." `rtk init -g --auto-patch` is **idempotent**, so the minimal, robust change is to
run it unconditionally whenever `rtk` is on PATH — dropping the script-file gate that
currently suppresses re-init.

Signals:

- **Models / integrations / auth / state machines:** none.
- **Story count:** ~5, all observable install/update behaviors.
- **Blast radius:** a handful of lines in one bash script (`bin/install`) + a small bash test.
  No detector, no ADR, no migration ceremony — `rtk init`'s own idempotency does the work.

Small ⇒ PRD, architecture-diagram, architecture-review, and conflict-check are skipped. The
spec is track + this tier marker + stories + plan.
