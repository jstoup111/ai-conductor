/**
 * Regression test for jstoup111/ai-conductor#1003 — the post-install success
 * banner printed a command the CLI itself rejects: a bare `conduct "your
 * feature description"`. The preferred automated path is now the daemon, and
 * the banner must keep printing the real `conduct-ts daemon start` invocation.
 *
 * A hardcoded expected-string assertion would pass even if the banner
 * drifted back to the broken form (it already drifted once). To keep this
 * regression coupled to the ACTUAL banner text, this test:
 *
 *   1. Reads bin/install and extracts the literal daemon-start command from
 *      its `echo -e "..."` source line.
 *   2. Shell-tokenizes that extracted string exactly as a terminal would.
 *   3. Feeds the resulting argv through the real daemon supervisor parser.
 *   4. Asserts the parser accepts it as a daemon start invocation and that
 *      the binary name is conduct-ts.
 *
 * If the banner ever reverts to the bare `conduct "..."` form (or any other
 * shape the parser rejects), this test fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectDaemonSupervisorCommand } from '../../src/engine/daemon-command.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/cli/ -> test/ -> conductor/ -> src/ -> repo root
const REPO_ROOT = resolve(__dirname, '../../../..');
const INSTALL_SCRIPT_PATH = resolve(REPO_ROOT, 'bin/install');

/**
 * Extracts the literal `conduct-ts daemon start` command from bin/install's
 * `echo -e "..."` source lines.
 *
 * Scans every `echo -e "<content>"` line after the "Or automated:" marker
 * and returns the first whose content mentions "conduct" — that's the
 * invocation example line, as opposed to the `cd your-project/` line above
 * it. Un-escapes the `\"` bash uses to embed literal quotes inside the
 * double-quoted echo string, so the returned text is exactly what the
 * banner prints to the terminal.
 */
function extractAutomatedBannerCommand(installSource: string): string {
  const markerIndex = installSource.indexOf('Quick start (preferred autonomous path):');
  if (markerIndex === -1) {
    throw new Error('bin/install: preferred autonomous quick-start label not found');
  }
  const afterMarker = installSource.slice(markerIndex);

  // Matches `echo -e "<content>"` where <content> may contain backslash-escaped
  // characters (e.g. \") without prematurely terminating on them.
  const echoLineRe = /echo -e "((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = echoLineRe.exec(afterMarker)) !== null) {
    const content = match[1].replace(/\\"/g, '"').trim();
    if (content.includes('conduct-ts daemon start')) {
      return content;
    }
  }
  throw new Error('bin/install: no conduct invocation line found under "Or automated:"');
}

/** Tokenizes a shell command line the way a terminal would: quoted spans stay one token. */
function shellSplit(command: string): string[] {
  const tokenRe = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const tokens: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(command)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3]);
  }
  return tokens;
}

describe('bin/install success banner — preferred autonomous invocation', () => {
  it('prints a command the real CLI parser accepts', () => {
    const installSource = readFileSync(INSTALL_SCRIPT_PATH, 'utf8');
    const bannerCommand = extractAutomatedBannerCommand(installSource);
    const tokens = shellSplit(bannerCommand);

    // Binary name: must be conduct-ts (the TypeScript CLI), not the
    // deprecated bash `conduct` script — bin/install itself builds and
    // PATH-checks conduct-ts, not conduct.
    expect(tokens[0]).toBe('conduct-ts');

    // Simulate real process.argv and run it through the same parser index.ts
    // uses to dispatch daemon management verbs.
    const simulatedArgv = ['node', 'conduct-ts', ...tokens.slice(1)];
    expect(detectDaemonSupervisorCommand(simulatedArgv)).toEqual({ verb: 'start' });
  });
});
