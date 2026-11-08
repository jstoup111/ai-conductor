import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

import * as prettier from 'prettier';
import * as prettierPluginSh from 'prettier-plugin-sh';

const arguments_ = process.argv.slice(2);
const write = arguments_.includes('--write');
const check = arguments_.includes('--check');
const all = arguments_.includes('--all');
const baseArgument = arguments_.indexOf('--base');
const base = baseArgument === -1 ? 'origin/main' : arguments_[baseArgument + 1];

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function lines(value) {
  return value === '' ? [] : value.split('\n').filter(Boolean);
}

function parserFor(root, path) {
  if ((path.startsWith('src/conductor/') || path.startsWith('plugins/')) && /\.(?:ts|mts)$/.test(path)) return 'typescript';
  if (path.endsWith('.sh')) return 'sh';
  if (!path.includes('.') || path.lastIndexOf('/') > path.lastIndexOf('.')) {
    const firstLine = readFileSync(resolve(root, path), 'utf8').split(/\r?\n/, 1)[0];
    if (/^#!.*\b(?:ba)?sh\b/.test(firstLine)) return 'sh';
  }
  return undefined;
}

function resolveBase(root, reference) {
  try {
    return git(root, ['merge-base', reference, 'HEAD']);
  } catch {
    console.error(`format: cannot resolve base reference "${reference}"`);
    process.exit(1);
  }
}

async function candidates(root) {
  if (all) return lines(git(root, ['ls-files']));

  const mergeBase = resolveBase(root, base);
  return [...new Set([
    ...lines(git(root, ['diff', '--name-only', '--diff-filter=ACMR', mergeBase])),
    ...lines(git(root, ['ls-files', '--others', '--exclude-standard'])),
  ])];
}

async function main() {
  if (write === check || (baseArgument !== -1 && !base)) {
    console.error('format: specify exactly one of --check or --write');
    process.exitCode = 1;
    return;
  }

  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const ignorePath = resolve(root, '.prettierignore');
  const config = resolve(root, '.prettierrc.json');
  let failed = false;

  for (const path of (await candidates(root)).sort()) {
    const parser = parserFor(root, path);
    if (!parser || (await prettier.getFileInfo(resolve(root, path), { ignorePath })).ignored) continue;

    const file = resolve(root, path);
    const source = readFileSync(file, 'utf8');
    try {
      const options = {
        ...(await prettier.resolveConfig(file, { config })),
        parser,
        plugins: [prettierPluginSh],
      };
      if (check) {
        if (!(await prettier.check(source, options))) {
          console.log(`not canonical: ${relative(root, file)}`);
          failed = true;
        }
      } else {
        const formatted = await prettier.format(source, options);
        if (formatted !== source) writeFileSync(file, formatted);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n', 1)[0] : String(error);
      console.log(`syntax error: ${relative(root, file)}: ${message}`);
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
}

await main();
