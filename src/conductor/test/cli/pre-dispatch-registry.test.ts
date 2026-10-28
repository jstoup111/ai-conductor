// Covers: task:10
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PRE_DISPATCH_COMMANDS,
} from '../../src/cli-pre-dispatch.js';
import { diffDetectorSets, undeclaredRegistryCommands } from './support/cli-catalog-checks.js';
import { createProgram } from '../../src/cli.js';

describe('pre-dispatch command registry', () => {
  // Covers: task:10
  it('registers stack land with its pre-dispatch detector and declared command path', () => {
    expect(PRE_DISPATCH_COMMANDS).toContainEqual({
      detector: 'detectStackLandCommand', commandPath: ['stack', 'land'], helpOwner: 'router',
    });
  });

  // Covers: task:1, task:19
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

  // Covers: task:4, task:19
  it('declares every pre-dispatch registry command path in the CLI catalog', () => {
    expect(undeclaredRegistryCommands(PRE_DISPATCH_COMMANDS, createProgram())).toEqual([]);
  });

  // Covers: task:4
  it('names a registry command path that the CLI catalog does not declare', () => {
    const registry = [
      { detector: 'detectUndeclaredCommand', commandPath: ['undeclared'], helpOwner: 'router' },
    ] as const;

    expect(undeclaredRegistryCommands(registry, createProgram())).toEqual(['undeclared']);
  });
});
