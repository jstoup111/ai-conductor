import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

type GeneratedModules = Record<string, Record<string, unknown>>;
type ModuleLoader = () => Promise<GeneratedModules>;

export async function checkInventory(
  root: string,
  modules: GeneratedModules = { 'git-hook-assets': gitHooks, 'session-hook-assets': sessionHooks },
  loadModules?: ModuleLoader,
): Promise<InterpreterSourceFinding[]> {
  const assets = [...await shellFiles(root, 'bin'), ...await shellFiles(root, 'hooks')].sort();
  if (assets.length === 0) throw new Error('interpreter-source inventory is empty');
  const findings: InterpreterSourceFinding[] = [];
  for (const asset of assets) findings.push(...checkInterpreterSource(relative(root, join(root, asset)), await readFile(join(root, asset), 'utf8')));
  // Keep module acquisition explicit so a load failure cannot be mistaken for
  // an empty/safe generated-hook inventory.
  const loadedModules = loadModules ? await loadModules() : modules;
  for (const [moduleName, module] of Object.entries(loadedModules)) {
    const scripts = Object.entries(module).filter(([, value]) => typeof value === 'string');
    if (scripts.length === 0) throw new Error(`${moduleName} generated-hook inventory is empty`);
    for (const [exportName, value] of Object.entries(module)) {
      if (typeof value !== 'string' && !(moduleName === 'git-hook-assets' && exportName === 'buildCommitMsgHook' && typeof module.COMMIT_MSG_HOOK === 'string')) {
        throw new Error(`${moduleName}#${exportName} is an unclassified generated-hook export`);
      }
    }
    for (const [exportName, script] of scripts) findings.push(...checkInterpreterSource(`${moduleName}#${exportName}`, script as string));
  }
  return findings;
}

async function main(): Promise<void> {
  const findings = await checkInventory(process.argv[2] ?? process.cwd());
  for (const finding of findings) console.error(`${finding.sourceName}:${finding.line}: ${finding.message}`);
  if (findings.length > 0) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main();
