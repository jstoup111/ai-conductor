import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diffDetectorSets,
  PRE_DISPATCH_COMMANDS,
} from '../../src/cli-pre-dispatch.js';

describe('pre-dispatch command registry', () => {
  // Covers: task:1
  it('covers exactly the detectors invoked by the pre-dispatch chains', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'index.ts'), 'utf8');

    expect(diffDetectorSets(source, PRE_DISPATCH_COMMANDS)).toEqual({
      unregistered: [],
      stale: [],
    });
  });

  // Covers: task:1
  it('names an unregistered detector invoked by a dispatcher', () => {
    const source = `
      export async function dispatchNonDispatchingCliCommand() {
        detectRegisteredCommand(process.argv);
        detectExtraCommand(process.argv);
      }
      async function dispatchCliCommand() {}
    `;
    const registry = [{ detector: 'detectRegisteredCommand', commandPath: ['registered'], helpOwner: 'router' }] as const;

    expect(diffDetectorSets(source, registry)).toEqual({
      unregistered: ['detectExtraCommand'],
      stale: [],
    });
  });

  // Covers: task:1
  it('names a stale registry entry whose detector is never dispatched', () => {
    const source = `
      export async function dispatchNonDispatchingCliCommand() {
        detectRegisteredCommand(process.argv);
      }
      async function dispatchCliCommand() {}
    `;
    const registry = [
      { detector: 'detectRegisteredCommand', commandPath: ['registered'], helpOwner: 'router' },
      { detector: 'detectStaleCommand', commandPath: ['stale'], helpOwner: 'router' },
    ] as const;

    expect(diffDetectorSets(source, registry)).toEqual({
      unregistered: [],
      stale: ['detectStaleCommand'],
    });
  });
});
