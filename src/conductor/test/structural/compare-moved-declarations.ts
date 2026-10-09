import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import ts from 'typescript';

interface ConductorInventory {
  moduleLevelAtBase: string[];
}

const CONDUCTOR_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ENGINE_ROOT = join(CONDUCTOR_ROOT, 'src/engine');
const BASE = process.env.BASE;

if (BASE === undefined || BASE === '') throw new Error('BASE must name the comparison commit');

const inventory = JSON.parse(
  await readFile(new URL('./conductor-exports.json', import.meta.url), 'utf8'),
) as ConductorInventory;

function declarationName(statement: ts.Statement): string | undefined {
  if (
    ts.isFunctionDeclaration(statement)
    || ts.isClassDeclaration(statement)
    || ts.isInterfaceDeclaration(statement)
    || ts.isTypeAliasDeclaration(statement)
    || ts.isEnumDeclaration(statement)
  ) return statement.name?.text;
  if (ts.isVariableStatement(statement) && statement.declarationList.declarations.length === 1) {
    const declaration = statement.declarationList.declarations[0];
    return ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
  }
  return undefined;
}

function declarations(source: string, fileName: string): Map<string, string> {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return new Map(sourceFile.statements.flatMap((statement) => {
    const name = declarationName(statement);
    return name === undefined ? [] : [[name, statement.getText(sourceFile)] as const];
  }));
}

async function modules(directory = ENGINE_ROOT): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return modules(path);
    return entry.isFile() && entry.name.endsWith('.ts') && entry.name !== 'conductor.ts' ? [path] : [];
  }));
  return nested.flat();
}

function stripLeadingExport(text: string): string {
  return text.replace(/^export /, '');
}

function normalizeRenamedDeclaration(text: string): string {
  return text.replaceAll('appendConductorRemediationTasks', 'appendRemediationTasks');
}

const { stdout: baseSource } = await execa(
  'git',
  ['show', `${BASE}:src/conductor/src/engine/conductor.ts`],
  { cwd: CONDUCTOR_ROOT },
);
const destinationModules = await modules();
const destinationDeclarations = await Promise.all(destinationModules.map(async (path) =>
  declarations(await readFile(path, 'utf8'), path),
));
const baseDeclarations = declarations(baseSource, 'conductor.ts');

for (const name of inventory.moduleLevelAtBase) {
  const destinationName = name === 'appendRemediationTasks' ? 'appendConductorRemediationTasks' : name;
  const base = baseDeclarations.get(name);
  const destinations = destinationDeclarations.flatMap((declarations) => {
    const text = declarations.get(destinationName);
    return text === undefined ? [] : [text];
  });
  const identical = base !== undefined
    && destinations.length === 1
    && stripLeadingExport(base) === normalizeRenamedDeclaration(stripLeadingExport(destinations[0]));
  console.log(`${name}: ${identical ? 'identical' : 'DIFFERENT'}`);
}
