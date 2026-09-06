import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { checkInterpreterSource } from './interpreter-source-check.js';
import * as gitHooks from '../src/engine/git-hook-assets.js';
import * as sessionHooks from '../src/engine/session-hook-assets.js';

async function shellFiles(root: string, directory: string): Promise<string[]> {
  const absolute = join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await shellFiles(root, path));
    else if (entry.isFile() && (entry.name.endsWith('.sh') || directory === 'bin')) paths.push(path);
  }
  return paths;
}

const root = process.argv[2] ?? process.cwd();
const assets = [...await shellFiles(root, 'bin'), ...await shellFiles(root, 'hooks')].sort();
if (assets.length === 0) throw new Error('interpreter-source inventory is empty');
const findings = [];
for (const asset of assets) {
  const absolute = join(root, asset);
  findings.push(...checkInterpreterSource(relative(root, absolute), await readFile(absolute, 'utf8')));
}
for (const [moduleName, module] of [['git-hook-assets', gitHooks], ['session-hook-assets', sessionHooks]] as const) {
  const scripts = Object.entries(module).filter(([, value]) => typeof value === 'string');
  if (scripts.length === 0) throw new Error(`${moduleName} generated-hook inventory is empty`);
  for (const [exportName, script] of scripts) {
    findings.push(...checkInterpreterSource(`${moduleName}#${exportName}`, script));
  }
}
if (findings.length > 0) {
  for (const finding of findings) console.error(`${finding.sourceName}:${finding.line}: ${finding.message}`);
  process.exitCode = 1;
}
