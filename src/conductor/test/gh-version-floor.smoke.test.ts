import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { checkGhVersionFloor, parseGhVersion } from '../src/engine/gh-version-floor.js';

const execFileP = promisify(execFile);

it('smoke: parses the installed gh binary version', async () => {
  const { stdout } = await execFileP('gh', ['--version']);
  const text = String(stdout);
  const version = parseGhVersion(text);
  const verdict = checkGhVersionFloor(text);
  console.info(`installed gh: ${text.split(/\r?\n/, 1)[0]}; floor verdict: ${verdict.kind}`);
  expect(version).not.toBeNull();
});
