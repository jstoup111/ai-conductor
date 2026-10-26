/** Provider-facing telemetry and port types.  This module deliberately has no runtime-layer imports. */
export interface TokenUsage { input: number; output: number; reasoningOutput?: number; cacheRead?: number; cacheCreation?: number; costUsd?: number; costSource?: 'provider' | 'rate-card'; attributedModel?: string; numTurns?: number; durationMs?: number; }
export interface ProviderStreamObservation { activeChildren?: number; childObservability: 'observed' | 'unsupported'; uncachedInputTokens: number; cachedInputTokens?: number; outputTokens: number; }
export type AuthenticationSource = 'api-key' | 'cached-login';
export type CodexProbeFailureKind = 'exec-error' | 'timeout' | 'unparseable-output';
export type CodexProbeParserRejection = 'invalid-json' | 'unsupported-schema' | 'unrecognized-envelope' | 'conflicting-source-evidence' | 'ambiguous-credential-evidence';
export interface ProviderExitFacts { processErrorCode?: 'E2BIG' | 'EACCES' | 'EAGAIN' | 'ENOENT' | 'EPERM' | 'UNKNOWN'; exitCode?: number; signal?: 'SIGABRT' | 'SIGALRM' | 'SIGHUP' | 'SIGINT' | 'SIGKILL' | 'SIGPIPE' | 'SIGQUIT' | 'SIGTERM' | 'UNKNOWN'; stdoutBytes?: number; stderrBytes?: number; }
export type AuthenticationReadinessState = 'ready' | 'missing' | 'unusable' | 'probe-failed';
export interface ObservedInterval { startedAtMs: number; durationMs: number; }
/** Opaque external provider identity; only the catalog conversion can mint one. */
declare const providerIdBrand: unique symbol;
export type ProviderId = string & { readonly [providerIdBrand]: 'ProviderId' };
