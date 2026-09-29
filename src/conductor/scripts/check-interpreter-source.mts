import { readdir, readFile } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkInterpreterSource, type InterpreterSourceFinding } from './interpreter-source-check.js';
import * as gitHooks from '../src/engine/git-hook-assets.js';
import * as sessionHooks from '../src/engine/session-hook-assets.js';

const shellShebang = /^#!\s*\/usr\/bin\/env\s+(?:-S\s+)?(?:ba)?sh\b|^#!.*\/(?:ba)?sh\b/;

async function isShellFile(root: string, relativePath: string): Promise<boolean> {
  if (relativePath.endsWith('.sh')) return true;
  const firstLine = (await readFile(join(root, relativePath), 'utf8')).split(/\r?\n/, 1)[0];
  return shellShebang.test(firstLine);
}

export async function shellFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(join(root, directory), { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await shellFiles(root, path));
    else if (entry.isFile() && await isShellFile(root, path)) paths.push(path);
  }
  return paths;
}

async function shellFilesIfDirectory(root: string, directory: string): Promise<string[]> {
  try {
    return await shellFiles(root, directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Every repository shell asset whose interpreter source must be checked. */
export async function interpreterSourceInventory(root: string): Promise<string[]> {
  const assets = [...await shellFiles(root, 'bin'), ...await shellFiles(root, 'hooks')];
  let skills: Dirent[];
  try {
    skills = await readdir(join(root, 'skills'), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return assets.sort();
    throw error;
  }
  for (const skill of skills) {
    if (skill.isDirectory()) assets.push(...await shellFilesIfDirectory(root, join('skills', skill.name, 'scripts')));
  }
  return assets.sort();
}

type GeneratedModules = Record<string, Record<string, unknown>>;
type ModuleLoader = () => Promise<GeneratedModules>;
const expectedGeneratedModules = ['git-hook-assets', 'session-hook-assets'] as const;

export async function checkInventory(
  root: string,
  modules: GeneratedModules = { 'git-hook-assets': gitHooks, 'session-hook-assets': sessionHooks },
  loadModules?: ModuleLoader,
): Promise<InterpreterSourceFinding[]> {
  const assets = await interpreterSourceInventory(root);
  if (assets.length === 0) throw new Error('interpreter-source inventory is empty');
  const findings: InterpreterSourceFinding[] = [];
  for (const asset of assets) findings.push(...checkInterpreterSource(relative(root, join(root, asset)), await readFile(join(root, asset), 'utf8')));
  // Keep module acquisition explicit so a load failure cannot be mistaken for
  // an empty/safe generated-hook inventory.
  const loadedModules = loadModules ? await loadModules() : modules;
  for (const moduleName of expectedGeneratedModules) {
    if (!loadedModules[moduleName]) throw new Error(`${moduleName} generated-hook module is missing`);
  }
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
