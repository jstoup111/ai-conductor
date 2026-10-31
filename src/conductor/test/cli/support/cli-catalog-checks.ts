import type { Command } from 'commander';
import type { PreDispatchCommand } from '../../../src/cli-pre-dispatch.js';

function dispatcherBody(sourceText: string, name: string): string {
  const declaration = new RegExp(`(?:export\\s+)?async\\s+function\\s+${name}\\s*\\(`).exec(sourceText);
  if (!declaration || declaration.index === undefined) return '';

  const parameterStart = sourceText.indexOf('(', declaration.index);
  if (parameterStart < 0) return '';

  let parameterDepth = 0;
  let parameterEnd = -1;
  for (let index = parameterStart; index < sourceText.length; index += 1) {
    if (sourceText[index] === '(') parameterDepth += 1;
    if (sourceText[index] === ')') {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parameterEnd = index;
        break;
      }
    }
  }
  if (parameterEnd < 0) return '';

  const start = sourceText.indexOf('{', parameterEnd);
  if (start < 0) return '';

  let depth = 0;
  for (let index = start; index < sourceText.length; index += 1) {
    if (sourceText[index] === '{') depth += 1;
    if (sourceText[index] === '}') {
      depth -= 1;
      if (depth === 0) return sourceText.slice(start, index + 1);
    }
  }
  return '';
}

function dispatchedDetectors(sourceText: string): string[] {
  const source = [
    dispatcherBody(sourceText, 'dispatchNonDispatchingCliCommand'),
    dispatcherBody(sourceText, 'dispatchStackRoundsCliEntry'),
    dispatcherBody(sourceText, 'dispatchCliCommand'),
  ].join('\n');
  const detectors = new Set<string>();
  const detectorCall = /\b(?:detect[A-Za-z]+Command|monitorCli\.detectMonitorCommand)\s*\(/g;
  for (const match of source.matchAll(detectorCall)) detectors.add(match[0].replace(/\s*\($/, ''));
  return [...detectors].sort();
}

/** Return detector names missing from either the source dispatch chain or registry. */
export function diffDetectorSets(
  sourceText: string,
  registry: readonly PreDispatchCommand[],
): { readonly unregistered: string[]; readonly stale: string[] } {
  const dispatched = new Set(dispatchedDetectors(sourceText));
  const registered = new Set(registry.map(({ detector }) => detector));
  return {
    unregistered: [...dispatched].filter((detector) => !registered.has(detector)).sort(),
    stale: [...registered].filter((detector) => !dispatched.has(detector)).sort(),
  };
}

/** Return catalog command paths that cannot be resolved through Commander declarations. */
export function undeclaredRegistryCommands(
  registry: readonly PreDispatchCommand[],
  program: Command,
): string[] {
  return registry.flatMap(({ commandPath }) => {
    let current = program;
    for (const commandName of commandPath) {
      const next = current.commands.find((command) => command.name() === commandName);
      if (next === undefined) return [commandPath.join(' ')];
      current = next;
    }
    return [];
  });
}
