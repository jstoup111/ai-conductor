// self-host/token-liveness.ts — verify a build-auth token is LIVE.
//
// ADR: adr-2026-07-22-token-liveness-probe-via-cli-invocation (FR-1).
//
// Rather than a raw API probe (unverified whether the API accepts setup-token
// OAuth bearers), the verifier runs the SAME headless CLI path dispatch uses
// (`claude -p`) with the candidate token in a throwaway CLAUDE_CONFIG_DIR. This
// is verified-by-construction: it exercises the exact auth path the next
// dispatch will use, so the verdict cannot drift from real dispatch behavior.
//
// Verdict mapping (fail-safe — NEVER claims valid without an explicit positive
// signal):
//   - valid        — envelope parses and `is_error` is explicitly false.
//   - invalid      — `api_error_status` is 401 or 403 (includes expired tokens).
//   - unverifiable — anything else: spawn failure, timeout, network error,
//                    unparseable envelope, unexpected status. This is the
//                    default outcome for every case that isn't an explicit
//                    positive or negative signal — the module never defaults
//                    to `valid`.
//
// The token is passed to the spawned process via environment variable ONLY —
// never as an argv element, never logged (FR-7). Detail strings surfaced on
// `unverifiable` are sanitized: they describe the failure class, not raw
// process output that might echo the token.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The trivial prompt sent to the CLI — cheap, deterministic, no side effects. */
const LIVENESS_PROMPT = 'reply with ok';

/** Cheapest available model tier — a liveness probe never needs more. */
const LIVENESS_MODEL = 'claude-haiku-4-5-20251001';

/** Tight timeout — a live/dead verdict should resolve in a few seconds. */
const DEFAULT_TIMEOUT_MS = 15_000;

/** Result of a single spawn attempt, as reported by the injected spawner. */
export interface LivenessSpawnResult {
  /** Process exit code, or null when the process did not exit cleanly. */
  exitCode: number | null;
  /** Captured stdout (expected to be a JSON envelope on success/api-error). */
  stdout: string;
  /** True iff the spawner enforced the timeout and killed the process. */
  timedOut: boolean;
}

/**
 * Injectable spawner seam — the real implementation shells out to `claude`;
 * tests inject a stub so verdict mapping is deterministic and no real
 * subprocess (or real credential) is ever required.
 */
export type LivenessSpawner = (
  argv: string[],
  env: NodeJS.ProcessEnv,
) => Promise<LivenessSpawnResult>;

/** Discriminated verdict — the only three outcomes the caller may observe. */
export type TokenLivenessVerdict = 'valid' | 'invalid' | 'unverifiable';

export interface TokenLivenessResult {
  verdict: TokenLivenessVerdict;
  /** Sanitized, human-readable detail (never contains token material). */
  detail?: string;
}

export interface VerifyTokenLivenessOptions {
  /** Candidate build-auth token to probe. Passed via env only. */
  token: string;
  /** Injectable spawner (defaults to the real `claude` CLI spawner). */
  spawner?: LivenessSpawner;
  /** Timeout in ms before the spawner is expected to abort (default 15s). */
  timeoutMs?: number;
  /** Base dir for the throwaway CLAUDE_CONFIG_DIR (defaults to OS temp dir). */
  baseDir?: string;
}

/** Shape of the `--output-format json` envelope we care about. Everything else ignored. */
interface LivenessEnvelope {
  is_error?: unknown;
  api_error_status?: unknown;
}

/**
 * Verify whether `options.token` is a LIVE build-auth credential by spawning
 * `claude -p` with a trivial prompt against a throwaway CLAUDE_CONFIG_DIR.
 *
 * Fail-safe by construction: any path that is not an explicit positive signal
 * (`is_error: false`) or an explicit negative signal (`api_error_status` 401/403)
 * resolves to `unverifiable` — this function never defaults to `valid`.
 */
export async function verifyTokenLiveness(
  options: VerifyTokenLivenessOptions,
): Promise<TokenLivenessResult> {
  const spawner = options.spawner ?? realLivenessSpawner;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let configDir: string | null = null;
  try {
    configDir = await mkdtemp(join(options.baseDir ?? tmpdir(), 'harness-token-liveness-'));

    const argv = ['claude', '-p', LIVENESS_PROMPT, '--output-format', 'json', '--model', LIVENESS_MODEL];

    // Token passed via env only — never argv, never logged.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_CODE_OAUTH_TOKEN: options.token,
    };

    let spawnResult: LivenessSpawnResult;
    try {
      spawnResult = await withTimeout(spawner(argv, env), timeoutMs);
    } catch (err) {
      // Spawn error (including our own timeout race) — never surface raw
      // error text that might contain env/credential material.
      return {
        verdict: 'unverifiable',
        detail: `liveness probe failed to spawn: ${sanitizedErrorClass(err)}`,
      };
    }

    if (spawnResult.timedOut) {
      return { verdict: 'unverifiable', detail: 'liveness probe timed out' };
    }

    let envelope: LivenessEnvelope;
    try {
      envelope = JSON.parse(spawnResult.stdout) as LivenessEnvelope;
    } catch {
      return { verdict: 'unverifiable', detail: 'liveness probe returned an unparseable envelope' };
    }

    if (envelope.api_error_status === 401 || envelope.api_error_status === 403) {
      return { verdict: 'invalid', detail: `api_error_status ${envelope.api_error_status}` };
    }

    if (envelope.is_error === false) {
      return { verdict: 'valid' };
    }

    // Every other case — unexpected status, is_error true with a non-401/403
    // status, or a missing is_error field entirely — is NOT a positive
    // signal. Fail safe: unverifiable, never valid.
    return { verdict: 'unverifiable', detail: 'liveness probe returned an unexpected status' };
  } finally {
    if (configDir) {
      await rm(configDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/** Race a promise against a timeout, rejecting (not resolving) on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Names only the error's constructor — never its message (may echo env/token data). */
function sanitizedErrorClass(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  return 'unknown error';
}

/**
 * Real spawner — shells out to the `claude` CLI. Not exercised by unit tests
 * (which inject a stub); exported implicitly as the default via
 * `verifyTokenLiveness`'s `spawner` option.
 */
const realLivenessSpawner: LivenessSpawner = (argv, env) =>
  new Promise((resolve, reject) => {
    void import('node:child_process').then(({ spawn }) => {
      const [cmd, ...args] = argv;
      const child = spawn(cmd, args, { env, stdio: ['ignore', 'pipe', 'ignore'] });
      let stdout = '';
      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.on('error', (err) => reject(err));
      child.on('close', (exitCode) => {
        resolve({ exitCode, stdout, timedOut: false });
      });
    }, reject);
  });
