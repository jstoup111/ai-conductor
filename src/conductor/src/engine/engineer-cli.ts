// `conduct engineer` command handler (Phase 9.3, Task 32 — FR-1 wiring).
//
// NON-INTERACTIVE entry: dispatched by index.ts BEFORE the interactive pipeline
// boots, exactly mirroring the registry-cli.ts pattern for `register`/`create`.
//
// Task 34: wires the real provider (ClaudeProvider) and gh runner into both
// dispatch paths (injected-io and production readline).

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { EngineerIO, EngineerDeps } from './engineer/loop.js';
import { ClaudeProvider } from '../execution/claude-provider.js';

/**
 * Production DECIDE seam: gates each authoring step through the io surface.
 * Presents the prompt and waits for the operator to provide the approved artifact.
 * An empty response → rejected (blocks authoring). NO claude subprocess spawned.
 */
function makeProductionDecide(io: EngineerIO): NonNullable<EngineerDeps['decide']> {
  return async ({ step, idea, project, prompt }) => {
    io.print(`\n── DECIDE: ${step} — project "${project}" — idea: ${idea}`);
    io.print(prompt);
    io.print(
      `Provide the approved ${step} artifact as your next response (empty = reject, blocks authoring):`,
    );
    const line = await io.prompt();
    const artifact = line ?? '';
    if (artifact.trim() === '') return { approved: false, artifact: '' };
    return { approved: true, artifact };
  };
}

const execFileP = promisify(execFileCb);

// Dispatch descriptor — mirrors RegistryDispatch from registry-cli.ts.
export type EngineerDispatch = { kind: 'engineer' };

// Detect whether argv targets the `engineer` subcommand. Returns the dispatch
// descriptor when argv[2] === 'engineer' exactly, or null for all other invocations
// (normal pipeline runs, registry subcommands, flags, feature descriptions).
//
// Contrast with registry detection: `engineer` takes no positional args at the
// wiring level (options TBD in task-33/34), so detection is a strict equality
// check on argv[2].
export function detectEngineerCommand(argv: string[]): EngineerDispatch | null {
  // argv is process.argv: [node, entry, sub, ...]
  const sub = argv[2];
  if (sub === 'engineer') {
    return { kind: 'engineer' };
  }
  return null;
}

// Construct the real gh runner used in production.
function makeProductionGh(): EngineerDeps['gh'] {
  return async (args: string[], opts: { cwd: string }) => {
    const result = await execFileP('gh', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

// Dispatch to the engineer entry. The real loop is imported from engineer/loop.ts.
//
// `deps.io` is an optional injectable EngineerIO for non-interactive / test callers.
// When omitted, the production path constructs a real readline interface from
// process.stdin (unchanged behaviour).
export async function dispatchEngineer(_d: EngineerDispatch, deps?: { io?: EngineerIO }): Promise<number> {
  const { runEngineerMode } = await import('./engineer/loop.js');

  // Construct a real provider (no-op/constructible for tests; the test injects io
  // that EOFs immediately so the provider is never actually invoked).
  const provider = new ClaudeProvider();
  const gh = makeProductionGh();

  // ── Injected io path (tests / non-interactive callers) ───────────────────
  if (deps?.io) {
    const decide = makeProductionDecide(deps.io);
    const result = await runEngineerMode({ io: deps.io, provider, gh, decide });
    return result?.exitCode ?? 0;
  }

  // ── Production path: build a real readline io from process.stdin ─────────
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const io: EngineerIO = {
    prompt: (): Promise<string | null> =>
      new Promise((resolve) => {
        rl.question('engineer> ', (line) => resolve(line));
        rl.once('close', () => resolve(null));
      }),
    print: (s: string): void => {
      process.stdout.write(s + '\n');
    },
  };
  const decide = makeProductionDecide(io);
  const result = await runEngineerMode({ io, provider, gh, decide });
  rl.close();
  return result?.exitCode ?? 0;
}
