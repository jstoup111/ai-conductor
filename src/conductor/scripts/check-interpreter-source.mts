import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { checkInterpreterSource, type InterpreterSourceFinding } from './interpreter-source-check.js';
import * as gitHooks from '../src/engine/git-hook-assets.js';
import * as sessionHooks from '../src/engine/session-hook-assets.js';

export async function shellFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await shellFiles(root, path));
    else if (entry.isFile() && (directory === 'bin' || entry.name.endsWith('.sh'))) paths.push(path);
  }
  return paths;
}

export async function checkInventory(root: string, modules: Record<string, Record<string, unknown>> = { 'git-hook-assets': gitHooks, 'session-hook-assets': sessionHooks }): Promise<InterpreterSourceFinding[]> {
  const assets = [...await shellFiles(root, 'bin'), ...await shellFiles(root, 'hooks')].sort();
  if (assets.length === 0) throw new Error('interpreter-source inventory is empty');
  const findings: InterpreterSourceFinding[] = [];
  for (const asset of assets) findings.push(...checkInterpreterSource(relative(root, join(root, asset)), await readFile(join(root, asset), 'utf8')));
  for (const [moduleName, module] of Object.entries(modules)) {
    const scripts = Object.entries(module).filter(([, value]) => typeof value === 'string');
    if (scripts.length === 0) throw new Error(`${moduleName} generated-hook inventory is empty`);
    for (const [exportName, script] of scripts) findings.push(...checkInterpreterSource(`${moduleName}#${exportName}`, script as string));
  }
  return findings;
}

async function main(): Promise<void> {
  const findings = await checkInventory(process.argv[2] ?? process.cwd());
  for (const finding of findings) console.error(`${finding.sourceName}:${finding.line}: ${finding.message}`);
  if (findings.length > 0) process.exitCode = 1;
}
void main();
