/** Static AST audit for shipped GitHub and remote-Git invocation boundaries. */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';
import { GITHUB_OPERATION_REGISTRY, type GithubOperationName } from './github-operations.js';

export interface GithubInvocationAuditFinding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export interface GithubInvocationAuditSite {
  readonly file: string;
  readonly line: number;
  readonly command: 'gh' | 'git';
  readonly classification: 'approved-adapter' | 'local-git' | 'remote-write';
}

/** Raw remote transports live only behind these guarded seams. */
const APPROVED_TRANSPORT_ADAPTERS = new Set(['engine/tracker-client.ts', 'engine/remote-git-operations.ts']);
/**
 * Runtime GhRunner boundaries already classified by their owning operation
 * composition.  This deliberately lists files, never globs: a new runner
 * invocation is an audit finding until its owner is added with a caller proof.
 * `tracker-client.ts` is the only raw feature-mutation transport; the remaining
 * entries are legacy registered-operation/read compositions retained while
 * their owning migrations route their requests through that transport.
 */
const APPROVED_INJECTED_GH_BOUNDARIES = new Set([
  'daemon-cli.ts',
  'engine/backlog-priority.ts',
  'engine/engineer/issue-dep-migration.ts',
  'engine/gate-writeback.ts',
  'engine/pr-labels.ts',
  'intake-file-cli.ts',
  'engine/tracker-client.ts',
]);
const PROCESS_MODULE = /^(?:node:)?child_process$/;
const GITHUB_HTTP_MODULE = /^(?:@octokit\/|octokit(?:$|\/)|github(?:$|\/)|node-fetch$|undici$)/;
const PROCESS_FACTORY_NAMES = new Set(['exec', 'execFile', 'spawn', 'execSync', 'execFileSync', 'spawnSync']);
const GITHUB_MUTATIONS = new Set(['create', 'edit', 'close', 'comment', 'ready', 'merge', 'reopen', 'delete', 'add', 'remove', 'set']);
const REMOTE_GIT_COMMANDS = new Set(['push', 'fetch', 'clone', 'ls-remote']);

type MutationOperation = Exclude<GithubOperationName, 'issue.read' | 'pull-request.read' | 'repository.read'>;
interface OperationCallerProof { readonly adapter: 'createGuardedGithubOperationRunner' | 'executeRemoteGit'; readonly owner: string; }

/**
 * Explicit (and exhaustively typed) inventory: a registry addition cannot pass
 * until its production caller is classified at the guarded adapter boundary.
 */
export const SHIPPED_MUTATION_OPERATION_CALLER_PROOFS = {
  'issue.comment.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.edit': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.close': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.label.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.label.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.dependency.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.dependency.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.comment.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.comment.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.edit': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.ready': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.draft': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.label.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.label.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.comment.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.close': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.label.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.label.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'label-definition.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'label-definition.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'remote-ref.push': { adapter: 'executeRemoteGit', owner: 'remote-git-operations.ts' },
  'remote-ref.delete': { adapter: 'executeRemoteGit', owner: 'remote-git-operations.ts' },
} as const satisfies Record<MutationOperation, OperationCallerProof>;

function normalizedFile(file: string): string { return file.split(sep).join('/').replace(/^.*?\/src\//, ''); }
function approved(file: string): boolean { return APPROVED_TRANSPORT_ADAPTERS.has(normalizedFile(file)); }
function approvedInjectedRunnerBoundary(file: string): boolean {
  return APPROVED_INJECTED_GH_BOUNDARIES.has(normalizedFile(file));
}
function location(sourceFile: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const value = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { line: value.line + 1, column: value.character + 1 };
}
function report(sourceFile: ts.SourceFile, file: string, node: ts.Node, message: string): GithubInvocationAuditFinding {
  return { file, ...location(sourceFile, node), message };
}
function text(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}
function argv(node: ts.Expression | undefined): readonly string[] | undefined {
  if (!node || !ts.isArrayLiteralExpression(node)) return undefined;
  const values: string[] = [];
  for (const value of node.elements) {
    if (ts.isSpreadElement(value)) return undefined;
    const item = text(value as ts.Expression);
    if (item === undefined) return undefined;
    values.push(item);
  }
  return values;
}
function argvHead(node: ts.Expression | undefined): readonly string[] | undefined {
  if (!node || !ts.isArrayLiteralExpression(node) || node.elements.length === 0) return undefined;
  const values: string[] = [];
  for (const value of node.elements) {
    if (ts.isSpreadElement(value)) return undefined;
    const item = text(value as ts.Expression);
    if (item === undefined) break;
    values.push(item);
  }
  return values.length > 0 ? values : undefined;
}
function ghMutation(args: readonly string[]): boolean {
  if (args[0] === 'api') return args.some((arg) => /^(?:--method=?)?(?:POST|PUT|PATCH|DELETE)$/i.test(arg));
  return (args[0] === 'issue' || args[0] === 'pr' || args[0] === 'label') && GITHUB_MUTATIONS.has(args[1] ?? '');
}
function sourceFile(file: string, source: string): ts.SourceFile { return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }

function typeReferenceName(node: ts.TypeNode | undefined): string | undefined {
  return node && ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) ? node.typeName.text : undefined;
}

/**
 * Find locally injected GhRunner values before inspecting their calls.  A
 * runner is a transport capability, not an authorization capability: allowing
 * a helper to invoke it with mutable argv would bypass the typed operation
 * boundary even though no child-process import appears in that helper.
 */
function injectedGhRunnerNames(parsed: ts.SourceFile): Set<string> {
  const runnerTypes = new Set(['GhRunner']);
  const runners = new Set<string>();
  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          if ((item.propertyName?.text ?? item.name.text) === 'GhRunner') runnerTypes.add(item.name.text);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(parsed);
  const mark = (name: ts.Node, type: ts.TypeNode | undefined): void => {
    if (ts.isIdentifier(name) && runnerTypes.has(typeReferenceName(type) ?? '')) runners.add(name.text);
  };
  const classify = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) mark(node.name, node.type);
    ts.forEachChild(node, classify);
  };
  classify(parsed);
  return runners;
}

function directGhInvocation(
  node: ts.CallExpression,
  runnerNames: ReadonlySet<string>,
): boolean {
  if (ts.isIdentifier(node.expression)) return runnerNames.has(node.expression.text);
  return ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword
    && runnerNames.has(node.expression.name.text);
}

/** Scan one executable TypeScript source file, resolving child-process aliases. */
export function auditGithubInvocationSource(file: string, source: string): GithubInvocationAuditFinding[] {
  const parsed = sourceFile(file, source);
  const findings: GithubInvocationAuditFinding[] = [];
  const processAliases = new Set<string>();
  const rawGithubImports = new Set<string>();
  const injectedRunners = injectedGhRunnerNames(parsed);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (PROCESS_MODULE.test(statement.moduleSpecifier.text) && bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
      if (PROCESS_FACTORY_NAMES.has(item.propertyName?.text ?? item.name.text)) processAliases.add(item.name.text);
    }
    if (GITHUB_HTTP_MODULE.test(statement.moduleSpecifier.text)) {
      if (bindings && ts.isNamespaceImport(bindings)) rawGithubImports.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) rawGithubImports.add(item.name.text);
      if (statement.importClause?.name) rawGithubImports.add(statement.importClause.name.text);
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const first = node.initializer.arguments[0];
      if (first && ts.isIdentifier(first) && processAliases.has(first.text)) processAliases.add(node.name.text);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && rawGithubImports.has(node.expression.text) && !approved(file)) {
      findings.push(report(parsed, file, node, 'unapproved raw GitHub HTTP client invocation outside guarded adapter'));
    }
    if (ts.isCallExpression(node)) {
      const called = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
      if (directGhInvocation(node, injectedRunners) && !approvedInjectedRunnerBoundary(file)) {
        const directArgs = argv(node.arguments[0]);
        const directHead = argvHead(node.arguments[0]);
        if (!directArgs && !directHead) {
          findings.push(report(parsed, file, node, 'unresolvable mutable GitHub command forwarding outside guarded adapter'));
        } else if (directHead && ghMutation(directHead)) {
          findings.push(report(parsed, file, node, 'direct injected GitHub mutation outside guarded adapter'));
        }
      }
      if (called && rawGithubImports.has(called) && !approved(file)) findings.push(report(parsed, file, node, 'unapproved raw GitHub HTTP client invocation outside guarded adapter'));
      if (called && processAliases.has(called)) {
        const executable = text(node.arguments[0]);
        const args = argv(node.arguments[1]);
        const command = argvHead(node.arguments[1]);
        if (executable === 'gh') {
          if (!args && !command && !approved(file)) findings.push(report(parsed, file, node, 'unresolvable executable command construction for gh'));
          else if (command && ghMutation(command) && !approved(file)) findings.push(report(parsed, file, node, 'direct GitHub mutation outside guarded adapter'));
        } else if (executable === 'git') {
          // A generic local-Git runner is not itself a remote invocation site.
          // Literal remote pushes are, and cannot be hidden behind that runner.
          if (command?.[0] === 'push' && !approved(file)) findings.push(report(parsed, file, node, 'direct remote Git mutation outside executeRemoteGit'));
        } else if (executable === 'sh' && args?.[0] === '-c') {
          const block = args[1] ?? '';
          if (/\bgh\s+(?:pr|issue|api|label)\s+(?:create|edit|close|comment|ready|merge|delete)/.test(block) || /\bgit\s+push\b/.test(block)) {
            findings.push(report(parsed, file, node, 'unapproved executable GitHub or remote-Git shell block'));
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return findings;
}

/** Enumerate runtime only: historical docs, examples, generated output, and tests never enter. */
export function shippedRuntimeTypescriptFiles(conductorRoot: string): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(path);
    }
  };
  walk(join(conductorRoot, 'src'));
  return files.sort();
}

/** Run the shipped-runtime audit and report paths relative to src/. */
export function auditShippedGithubInvocationBoundary(conductorRoot: string): GithubInvocationAuditFinding[] {
  const findings: GithubInvocationAuditFinding[] = [];
  for (const operation of Object.keys(GITHUB_OPERATION_REGISTRY) as GithubOperationName[]) {
    if (GITHUB_OPERATION_REGISTRY[operation].access !== 'read' && !(operation in SHIPPED_MUTATION_OPERATION_CALLER_PROOFS)) {
      findings.push({ file: 'engine/github-operations.ts', line: 1, column: 1, message: `unclassified registered mutation '${operation}'` });
    }
  }
  for (const file of shippedRuntimeTypescriptFiles(conductorRoot)) {
    const runtimeFile = relative(join(conductorRoot, 'src'), file).split(sep).join('/');
    findings.push(...auditGithubInvocationSource(runtimeFile, readFileSync(file, 'utf8')));
  }
  return findings;
}

/** Boundary-site inventory for diagnostics and fixture assertions. */
export function findGithubInvocationSites(file: string, source: string): GithubInvocationAuditSite[] {
  const parsed = sourceFile(file, source);
  const aliases = new Set<string>();
  const sites: GithubInvocationAuditSite[] = [];
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier) || !PROCESS_MODULE.test(statement.moduleSpecifier.text)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if (PROCESS_FACTORY_NAMES.has(item.propertyName?.text ?? item.name.text)) aliases.add(item.name.text);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const first = node.initializer.arguments[0];
      if (first && ts.isIdentifier(first) && aliases.has(first.text)) aliases.add(node.name.text);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && aliases.has(node.expression.text)) {
      const command = text(node.arguments[0]); const args = argv(node.arguments[1]);
      if (command === 'gh' || command === 'git') {
        const remote = command === 'gh' ? !!args && ghMutation(args) : !!args && REMOTE_GIT_COMMANDS.has(args[0] ?? '');
        sites.push({ file, line: location(parsed, node).line, command, classification: remote ? (approved(file) ? 'approved-adapter' : 'remote-write') : 'local-git' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return sites;
}
