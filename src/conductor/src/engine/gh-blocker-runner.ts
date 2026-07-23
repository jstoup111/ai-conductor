// Real BlockerRunner adapter — shells out to the actual `gh` CLI.
//
// Every other call site of BlockerResolver uses an injected fake runner
// (see blocker-resolver.test.ts) for fast, deterministic unit tests. This
// module is the one production implementation of the BlockerRunner contract
// and is exercised directly by the gh real-binary smoke test, since an
// injected fake cannot catch drift in gh's actual flag names or response
// shape (Task 9).

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { BlockerRunner } from './blocker-resolver.js';

const execFile = promisify(execFileCb);

/** Creates a BlockerRunner that shells `gh <args>` via the real `gh` binary. */
export function createGhBlockerRunner(): BlockerRunner {
  return async (args: string[], opts: { cwd: string }) => {
    const { stdout } = await execFile('gh', args, { cwd: opts.cwd });
    return { stdout };
  };
}
