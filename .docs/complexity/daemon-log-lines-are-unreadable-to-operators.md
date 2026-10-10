# Complexity: Daemon log lines are unreadable to operators (#2867, covers #2367)

Tier: M

Rationale: Cross-cutting but bounded presentation change. It touches the daemon renderer (`renderDaemonEvent`), the daemon logger (`daemon-log.ts`), the halt-retention and fresh-session emitters, the raw warning/halt log sites in the daemon and halt-PR modules, the build_review completion reason, and the conductor's build_review adjudication exit. It adds one `ConductorEvent` variant and one optional field on `step_failed`, both on the existing spine. No new subsystem, persistence model, config key, CLI surface or migration; `.pipeline/events.jsonl` is unchanged apart from the additive event. The widest risk is the number of existing byte-exact renderer tests whose expected lines change, which is test churn rather than design risk.
