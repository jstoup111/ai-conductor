**Status:** Accepted

# Stories: Remediation-gate budget readable from one place that agrees with enforcement

Source: jstoup111/ai-conductor#2577. Track: technical (no PRD). Tier: S.

The engine bounds `prd_audit` and `architecture_review_as_built` remediation by laps recorded in the
kickback ledger. An operator who read the ledger's generic `count`/`cumulative` counters saw `0` for
a gate the engine then halted at `1/1`. These stories make the kickback-budget reading — through
`ai-conductor kickback-budget inspect` and `ai-conductor daemon status` — the one place that states
remaining remediation budget, and make it agree with what the engine will enforce at the next
charge. Cap values, charging, settlement, raise/reset, and the ledger schema are unchanged (see
#2894 and #2413 for those concerns).

## Story 1: kickback-budget inspect reports the remediation budget the engine will enforce

**Requirement:** #2577 desired outcomes 1, 2, 3, 4

As an operator deciding whether to wait for the daemon's own remediation or fix a blocked gate by
hand, I want `kickback-budget inspect` to report the same consumed, limit, and remaining values the
engine will enforce, so that I can predict whether the next remediation proceeds or halts on the cap.

### Acceptance Criteria

#### Happy Path
- Given a feature whose `architecture_review_as_built` ledger entry records 1 consumed remediation lap with `count` 0 and `cumulative` 0, and no configured or raised lap cap, when the operator runs `ai-conductor kickback-budget inspect --feature <slug>`, then the human output reports `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining` and the `--format json` view for that gate carries `consumed: 1`, `limit: 1`, and `remaining: 0`.
- Given a feature with no `architecture_review_as_built` ledger entry and a feature config setting `architecture_review_as_built.max_remediation_laps: 3`, when the operator runs inspect, then that gate reports `0/3 consumed; 3 remaining`.
- Given a feature whose pending repair carries an uncharged 1-lap charge for `architecture_review_as_built` while that gate's recorded laps are 0 and its cap is 1, when the operator runs inspect, then the gate reports `0/1 consumed; 0 remaining`, the human output includes the line `Pending charge: 1 lap (charged when build dispatches)`, and the JSON view carries `pendingLaps: 1` and `remaining: 0`.

#### Negative Paths
- Given a feature whose `architecture_review_as_built` entry records `count` 2, `cumulative` 5, and 0 laps with cap 1, when the operator runs inspect, then the gate reports `0/1 consumed; 1 remaining` — the generic counters contribute nothing to remediation consumption.
- Given a feature whose pending repair charges only `prd_audit`, when the operator runs inspect, then the `architecture_review_as_built` output contains no `Pending charge:` line, its JSON view carries `pendingLaps: 0`, and its remaining equals its limit minus its recorded laps.
- Given a feature whose `architecture_review_as_built` entry records 1 lap with cap 1 and whose pending repair also carries a 1-lap charge for that gate, when the operator runs inspect, then the gate reports `0 remaining` (never a negative number) and the `Pending charge: 1 lap` line.

### Done When
- [ ] `kickback-budget inspect` human and JSON output for remediation gates derive consumed from recorded laps, limit from the raised cap or the engine's own cap resolver, and remaining from limit minus laps minus any pending-repair lap charge, floored at 0.
- [ ] The JSON view for each remediation gate carries a `pendingLaps` number; the human view prints a `Pending charge:` line only when it is greater than 0.
- [ ] `build_review` inspect output is unchanged.

## Story 2: daemon status shows each remediation gate's budget before any halt

**Requirement:** #2577 desired outcomes 1, 2, 4

As an operator watching `ai-conductor daemon status`, I want every in-progress or halted feature to
show its `prd_audit` and `architecture_review_as_built` remediation budget even before a cap halt,
with the same values `kickback-budget inspect` reports, so that the status view and the inspect
command never disagree with each other or with enforcement.

### Acceptance Criteria

#### Happy Path
- Given an in-progress feature whose `architecture_review_as_built` entry records 1 lap and has no cap evidence and no adjustment history, when the operator runs `ai-conductor daemon status`, then the output includes a `KICKBACK BUDGET [<slug>]:` line containing `Kickback budget (architecture_review_as_built): 1/1 consumed; 0 remaining`.
- Given an in-progress feature with no ledger entry for either remediation gate and no configured lap caps, when the operator runs daemon status, then the output includes one `KICKBACK BUDGET [<slug>]:` line for `prd_audit` and one for `architecture_review_as_built`, each containing `0/1 consumed; 1 remaining`.
- Given an in-progress feature whose config sets `architecture_review_as_built.max_remediation_laps: 3` and whose entry records 1 lap, when the operator runs daemon status and kickback-budget inspect, then both report `1/3 consumed; 2 remaining` for that gate.

#### Negative Paths
- Given an in-progress feature whose ledger pending repair is malformed, when the operator runs daemon status, then the command exits 0, and for each of `prd_audit` and `architecture_review_as_built` the output contains a `KICKBACK BUDGET [<slug>]:` line reading `<gate>: budget unavailable (durable entry failed validation)` and no `consumed;` figure for that gate.
- Given an in-progress feature whose `build_review` entry has no cap evidence and no adjustment history, when the operator runs daemon status, then no `KICKBACK BUDGET` line names `build_review` for that feature.

### Done When
- [ ] `daemon status` renders a remediation-gate budget line for both remediation gates of every in-progress or halted feature through the same projection and cap resolver as `kickback-budget inspect`.
- [ ] An unreadable remediation-gate entry renders as unavailable, never as an unspent budget, and does not abort the status command.
- [ ] `build_review` status rendering conditions are unchanged.
