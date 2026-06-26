// `conduct brain` command handler (Phase 9.3, Task 32 — FR-1 wiring).
//
// NON-INTERACTIVE entry: dispatched by index.ts BEFORE the interactive pipeline
// boots, exactly mirroring the registry-cli.ts pattern for `register`/`create`.
//
// The loop body (tasks 33/34) is NOT implemented here — this file only wires
// the subcommand detection/dispatch and provides the minimal stub entry that
// the CLI routes to. The real `runBrainMode` lives in src/engine/brain/loop.ts
// and will be imported dynamically once it exists.

// Dispatch descriptor — mirrors RegistryDispatch from registry-cli.ts.
export type BrainDispatch = { kind: 'brain' };

// Detect whether argv targets the `brain` subcommand. Returns the dispatch
// descriptor when argv[2] === 'brain' exactly, or null for all other invocations
// (normal pipeline runs, registry subcommands, flags, feature descriptions).
//
// Contrast with registry detection: `brain` takes no positional args at the
// wiring level (options TBD in task-33/34), so detection is a strict equality
// check on argv[2].
export function detectBrainCommand(argv: string[]): BrainDispatch | null {
  // argv is process.argv: [node, entry, sub, ...]
  const sub = argv[2];
  if (sub === 'brain') {
    return { kind: 'brain' };
  }
  return null;
}

// Dispatch to the brain entry. The real loop is imported dynamically so this
// file has zero coupling to the not-yet-complete loop module. When loop.ts
// does not exist yet (task-33 pending), the stub returns 0 and prints a message.
export async function dispatchBrain(_d: BrainDispatch): Promise<number> {
  try {
    // Dynamic import: succeeds once task-33 lands src/engine/brain/loop.ts with
    // a `runBrainMode` export. Until then, the catch block below handles it.
    const { runBrainMode } = (await import('./brain/loop.js')) as {
      runBrainMode: (deps: Record<string, unknown>) => Promise<{ exitCode?: number }>;
    };
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const io = {
      prompt: (): Promise<string | null> =>
        new Promise((resolve) => {
          rl.question('brain> ', (line) => resolve(line));
          rl.once('close', () => resolve(null));
        }),
      print: (s: string): void => {
        process.stdout.write(s + '\n');
      },
    };
    const result = await runBrainMode({ io });
    rl.close();
    return result?.exitCode ?? 0;
  } catch (err: unknown) {
    // Narrow to module-not-found only. Once loop.ts exists, real runtime errors
    // from runBrainMode must propagate rather than being silently swallowed —
    // only a missing module file should fall back to the placeholder stub.
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
      // Loop not yet implemented — print a placeholder and exit 0.
      // This is intentional: the stub lets wiring tests assert dispatch without
      // requiring the full loop implementation (task-33/34).
      console.log('[brain] conduct brain mode — not yet implemented (task-33/34 pending)');
      return 0;
    }
    // Any other error (loop.ts exists but threw at runtime) must propagate.
    throw err;
  }
}
