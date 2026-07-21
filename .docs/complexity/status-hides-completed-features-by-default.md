# Complexity assessment: status hides completed features unless an option is passed

Tier: S

## Rationale

| Signal | Assessment |
| --- | --- |
| New models / entities | None. Reuses `InheritedState`/`ProcessedEntry`. |
| Integrations | None. Pure display filtering + one boolean CLI flag. |
| Auth / identity | Untouched. |
| State machines | None. No change to dispatch, gating, or lifecycle. |
| Story count | 3 (default omits completed; flag includes them on console; daemon.log never shows completed). |
| Files touched | `daemon-dashboard.ts` (gate the PROCESSED push), `daemon-cli.ts` (sink split at the emit), `daemon-command.ts` (+1 flag + interface field), `index.ts` (thread-through), README ×2. |
| Blast radius | Contained to the startup inherited-state dashboard's render + emit path; no behavioral change to dispatch or gates. |

Points to **Small**. The only edge toward Medium is that the CLI arg schema
(`DaemonCommandOptions`) gains one field + one flag — but it is a single additive
display flag with no behavioral change, so **S**. Per the tier rules this Small
technical fix **skips** conflict-check, architecture-diagram, and architecture-review;
the land gate requires only track + stories + plan + this complexity marker. The
mandatory non-trivial detail (called out in the plan): the daemon.log-vs-console sink
split at `daemon-cli.ts:1292`.
