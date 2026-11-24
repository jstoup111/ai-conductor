# Halt record

Status: halted
Slug: manual-test-gate-commits-product-code-invalidating
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-manual-test-gate-commits-product-code-invalidating
Head SHA: d0ac79a1d00313d48da57f731826f0a6af3df758
Halted at: 2026-11-24T15:43:10.371Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
Step 'build' completed but completion check failed: test_suite pre-check failed: `npm run format:check --silent && npm run typecheck --silent && npm run typecheck:test --silent` (/home/james-stoup/code/ai-conductor/.worktrees/manual-test-gate-commits-product-code-invalidating/src/conductor) nonzero_exit; output tail:
                Types of property 'type' are incompatible.
                  Type '"ship_validator_fallback"' is not assignable to type '"session_policy"'.
test/engine/conductor-groups-and-signals.test.ts(5570,7): error TS2322: Type '{ configuredProviders: string[]; runtimes: ProviderRuntimeSet; sessions: ProviderSessionStore; config: { llm_provider: string[]; }; onAttempt: (step: StepName, attempt: Omit<Extract<ConductorEvent, { type: "provider_attempt"; }>, "type" | "step">) => Promise<...>; warn: (_message: string, transition: Extract<Conduct...' is not assignable to type 'ProviderExecutionContext'.
  Types of property 'warn' are incompatible.
    Type '(_message: string, transition: Extract<ConductorEvent, { type: "provider_fallback" | "session_policy"; }>) => Promise<void>' is not assignable to type '(message: string, transition: ProviderTransitionWarning) => void | Promise<void>'.
      Types of parameters 'transition' and 'transition' are incompatible.
        Type 'ProviderTransitionWarning' is not assignable to type '({ type: "provider_fallback"; step: StepName; failedProvider: string; reason: string; recoveryAction?: string | undefined; nextProvider: string; } & { child?: ChildId | undefined; }) | ({ ...; } & { ...; })'.
          Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '({ type: "provider_fallback"; step: StepName; failedProvider: string; reason: string; recoveryAction?: string | undefined; nextProvider: string; } & { child?: ChildId | undefined; }) | ({ ...; } & { ...; })'.
            Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '{ type: "session_policy"; step: StepName; provider: string; reason: string; } & { child?: ChildId | undefined; }'.
              Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '{ type: "session_policy"; step: StepName; provider: string; reason: string; }'.
                Types of property 'type' are incompatible.
                  Type '"ship_validator_fallback"' is not assignable to type '"session_policy"'.
test/engine/conductor-live-boundary-events.test.ts(498,24): error TS2339: Property 'cwd' does not exist on type '{ originalCatalogHome?: string | undefined; scratchRoot?: string | undefined; env: ProcessEnv; }'.
test/engine/conductor-live-boundary-events.test.ts(500,47): error TS2339: Property 'cwd' does not exist on type '{ originalCatalogHome?: string | undefined; scratchRoot?: string | undefined; env: ProcessEnv; }'.
test/engine/conductor-live-boundary-events.test.ts(501,38): error TS2339: Property 'cwd' does not exist on type '{ originalCatalogHome?: string | undefined; scratchRoot?: string | undefined; env: ProcessEnv; }'.
test/engine/conductor-live-boundary-events.test.ts(502,67): error TS2339: Property 'cwd' does not exist on type '{ originalCatalogHome?: string | undefined; scratchRoot?: string | undefined; env: ProcessEnv; }'.
test/engine/conductor-live-boundary-events.test.ts(503,79): error TS2339: Property 'cwd' does not exist on type '{ originalCatalogHome?: string | undefined; scratchRoot?: string | undefined; env: ProcessEnv; }'.
test/integration/audit-trail-completeness.integration.test.ts(58,7): error TS2741: Property 'ship_validator_fallback' is missing in type '{ otel_spool_drop: "not-audited-by-design"; otel_spool_backlog: "not-audited-by-design"; daemon_backlog_snapshot: "not-audited-by-design"; daemon_memory_sample: "not-audited-by-design"; ... 222 more ...; provider_transcripts_retention_failed: "not-audited-by-design"; }' but required in type 'Record<AuditedEventType, "friction-mapped" | "not-audited-by-design">'.
test/integration/audit-trail-completeness.integration.test.ts(309,7): error TS2741: Property 'ship_validator_fallback' is missing in type '{ otel_spool_drop: { type: "otel_spool_drop"; signal: "traces"; reason: "rejected"; batches: number; items: number; }; otel_spool_backlog: { type: "otel_spool_backlog"; signal: "metrics"; files: number; bytes: number; oldestAgeMs: number; lastFailureClass: "network"; }; ... 225 more ...; stack_tip_diverged: { ...; }...' but required in type '{ github_operation_refused: GithubOperationRefusedEvent & { child?: ChildId | undefined; }; github_operation_failed: GithubOperationFailedEvent & { ...; }; ... 226 more ...; worktree_reclaim_failed: { ...; } & { ...; }; }'.
test/integration/daemon-provider-event-persistence.integration.test.ts(164,11): error TS2322: Type '{ configuredProviders: string[]; runtimes: ProviderRuntimeSet; sessions: ProviderSessionStore; config: { llm_provider: string[]; }; onAttempt: (step: StepName, attempt: Omit<Extract<ConductorEvent, { type: "provider_attempt"; }>, "type" | "step">) => Promise<...>; warn: (_message: string, transition: Extract<Conduct...' is not assignable to type 'ProviderExecutionContext'.
  Types of property 'warn' are incompatible.
    Type '(_message: string, transition: Extract<ConductorEvent, { type: "provider_fallback" | "session_policy"; }>) => Promise<void>' is not assignable to type '(message: string, transition: ProviderTransitionWarning) => void | Promise<void>'.
      Types of parameters 'transition' and 'transition' are incompatible.
        Type 'ProviderTransitionWarning' is not assignable to type '({ type: "provider_fallback"; step: StepName; failedProvider: string; reason: string; recoveryAction?: string | undefined; nextProvider: string; } & { child?: ChildId | undefined; }) | ({ ...; } & { ...; })'.
          Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '({ type: "provider_fallback"; step: StepName; failedProvider: string; reason: string; recoveryAction?: string | undefined; nextProvider: string; } & { child?: ChildId | undefined; }) | ({ ...; } & { ...; })'.
            Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '{ type: "session_policy"; step: StepName; provider: string; reason: string; } & { child?: ChildId | undefined; }'.
              Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '{ type: "session_policy"; step: StepName; provider: string; reason: string; }'.
                Types of property 'type' are incompatible.
                  Type '"ship_validator_fallback"' is not assignable to type '"session_policy"'.
test/integration/daemon-provider-event-persistence.integration.test.ts(175,11): error TS2322: Type '{ configuredProviders: string[]; runtimes: ProviderRuntimeSet; sessions: ProviderSessionStore; config: { llm_provider: string[]; }; onAttempt: (step: StepName, attempt: Omit<Extract<ConductorEvent, { type: "provider_attempt"; }>, "type" | "step">) => Promise<...>; warn: (_message: string, transition: Extract<Conduct...' is not assignable to type 'ProviderExecutionContext'.
  Types of property 'warn' are incompatible.
    Type '(_message: string, transition: Extract<ConductorEvent, { type: "provider_fallback" | "session_policy"; }>) => Promise<void>' is not assignable to type '(message: string, transition: ProviderTransitionWarning) => void | Promise<void>'.
      Types of parameters 'transition' and 'transition' are incompatible.
        Type 'ProviderTransitionWarning' is not assignable to type '({ type: "provider_fallback"; step: StepName; failedProvider: string; reason: string; recoveryAction?: string | undefined; nextProvider: string; } & { child?: ChildId | undefined; }) | ({ ...; } & { ...; })'.
          Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '({ type: "provider_fallback"; step: StepName; failedProvider: string; reason: string; recoveryAction?: string | undefined; nextProvider: string; } & { child?: ChildId | undefined; }) | ({ ...; } & { ...; })'.
            Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '{ type: "session_policy"; step: StepName; provider: string; reason: string; } & { child?: ChildId | undefined; }'.
              Type '{ type: "ship_validator_fallback"; step: StepName; provider: string; reason: string; }' is not assignable to type '{ type: "session_policy"; step: StepName; provider: string; reason: string; }'.
                Types of property 'type' are incompatible.
                  Type '"ship_validator_fallback"' is not assignable to type '"session_policy"'.
Command failed with exit code 2: 'npm run format:check --silent && npm run typecheck --silent && npm run typecheck:test --silent'
```
