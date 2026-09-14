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
  'issue.comment.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
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
  'intake.issue.dependency.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'commit.status.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'label-definition.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'label-definition.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'remote-ref.push': { adapter: 'executeRemoteGit', owner: 'remote-git-operations.ts' },
  'remote-ref.delete': { adapter: 'executeRemoteGit', owner: 'remote-git-operations.ts' },
} as const satisfies Record<MutationOperation, OperationCallerProof>;

function normalizedFile(file: string): string { return file.split(sep).join('/').replace(/^.*?\/src\//, ''); }
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
interface InjectedGhRunners {
  readonly names: ReadonlySet<string>;
  readonly properties: ReadonlyMap<string, ReadonlySet<string>>;
}

function injectedGhRunnerNames(parsed: ts.SourceFile): InjectedGhRunners {
  const runnerTypes = new Set(['GhRunner']);
  const runners = new Set<string>();
  const runnerProperties = new Map<string, Set<string>>();
  const typeAliases = new Map<string, ts.TypeNode>();
  const interfaces = new Map<string, ts.InterfaceDeclaration>();
  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          if ((item.propertyName?.text ?? item.name.text) === 'GhRunner') runnerTypes.add(item.name.text);
        }
      }
    }
    if (ts.isTypeAliasDeclaration(node)) typeAliases.set(node.name.text, node.type);
    if (ts.isInterfaceDeclaration(node)) interfaces.set(node.name.text, node);
    ts.forEachChild(node, collect);
  };
  collect(parsed);

  const isRunnerType = (type: ts.TypeNode | undefined, seen = new Set<string>()): boolean => {
    if (!type) return false;
    if (ts.isParenthesizedTypeNode(type)) return isRunnerType(type.type, seen);
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) return type.types.some((part) => isRunnerType(part, seen));
    const name = typeReferenceName(type);
    if (!name) return false;
    if (runnerTypes.has(name)) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return isRunnerType(typeAliases.get(name), seen);
  };
  const propertyName = (name: ts.PropertyName): string | undefined => ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;
  const propertiesWithRunner = (type: ts.TypeNode | undefined, seen = new Set<string>()): Set<string> => {
    const properties = new Set<string>();
    if (!type) return properties;
    if (ts.isParenthesizedTypeNode(type)) return propertiesWithRunner(type.type, seen);
    const addProperties = (members: ts.NodeArray<ts.TypeElement | ts.ClassElement>): void => {
      for (const member of members) {
        if ((ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) && isRunnerType(member.type)) {
          const name = propertyName(member.name);
          if (name) properties.add(name);
        }
      }
    };
    if (ts.isTypeLiteralNode(type)) addProperties(type.members);
    const name = typeReferenceName(type);
    if (name && !seen.has(name)) {
      seen.add(name);
      const alias = typeAliases.get(name);
      const declaration = interfaces.get(name);
      if (alias) for (const property of propertiesWithRunner(alias, seen)) properties.add(property);
      if (declaration) addProperties(declaration.members);
    }
    return properties;
  };
  const mark = (name: ts.BindingName, type: ts.TypeNode | undefined): void => {
    if (ts.isIdentifier(name)) {
      if (isRunnerType(type)) runners.add(name.text);
      const properties = propertiesWithRunner(type);
      if (properties.size > 0) runnerProperties.set(name.text, properties);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) continue;
      const sourceName = element.propertyName && ts.isIdentifier(element.propertyName)
        ? element.propertyName.text
        : element.name.text;
      if (propertiesWithRunner(type).has(sourceName)) runners.add(element.name.text);
    }
  };
  const propertyAlias = (initializer: ts.Expression | undefined): boolean =>
    !!initializer
    && ts.isPropertyAccessExpression(initializer)
    && ts.isIdentifier(initializer.expression)
    && runnerProperties.get(initializer.expression.text)?.has(initializer.name.text) === true;
  const destructuredAlias = (initializer: ts.Expression | undefined, property: string): boolean =>
    !!initializer && ts.isIdentifier(initializer) && runnerProperties.get(initializer.text)?.has(property) === true;
  const classify = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) {
      if (ts.isIdentifier(node.name) || ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
        mark(node.name, node.type);
      }
      if (ts.isVariableDeclaration(node)) {
        if (ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(node.initializer) && runners.has(node.initializer.text)) {
          runners.add(node.name.text);
        }
        if (ts.isIdentifier(node.name) && propertyAlias(node.initializer)) runners.add(node.name.text);
        if (ts.isObjectBindingPattern(node.name)) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const sourceName = element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : element.name.text;
            if (destructuredAlias(node.initializer, sourceName)) runners.add(element.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, classify);
  };
  classify(parsed);
  return { names: runners, properties: runnerProperties };
}

function directGhInvocation(
  node: ts.CallExpression,
  runners: InjectedGhRunners,
): boolean {
  if (ts.isIdentifier(node.expression)) return runners.names.has(node.expression.text);
  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  if (node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) return runners.names.has(node.expression.name.text);
  return ts.isIdentifier(node.expression.expression)
    && runners.properties.get(node.expression.expression.text)?.has(node.expression.name.text) === true;
}

function enclosingFunctionName(node: ts.Node): string | undefined {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
  }
  return undefined;
}

/**
 * Approved calls are structural, never file-wide.  Each accepted mutation is
 * the canonical guarded adapter. Literal mutations remain findings everywhere
 * else: a composition helper cannot confer write authority merely by naming
 * its callback after a registered operation.
 */
function guardedMutationRunnerCall(node: ts.CallExpression): boolean {
  return enclosingFunctionName(node) === 'createGuardedGithubOperationRunner';
}

/** Dynamic runner forwarding is safe only inside an explicitly typed read or adapter seam. */
function guardedDynamicRunnerForwarding(node: ts.CallExpression): boolean {
  const owner = enclosingFunctionName(node);
  if (owner === 'createGuardedGithubOperationRunner') return true;
  if (owner === 'runTrackerRead' || owner === 'graphqlPage' || owner === 'runTrackerIssueOperation') return true;
  if (owner !== 'guardedPrRunner') return false;
  const declaration = node.parent.parent;
  return ts.isVariableDeclaration(declaration)
    && ts.isIdentifier(declaration.name)
    && declaration.name.text === 'read'
    && declaration.type !== undefined;
}

/**
 * The production `gh` transport may forward its caller-provided argv only from
 * its one real shell boundary.  This deliberately does not exempt the file:
 * a second literal `gh` write in tracker-client.ts remains a finding.
 */
function productionGhTransportCall(file: string, node: ts.CallExpression): boolean {
  return normalizedFile(file) === 'engine/tracker-client.ts'
    && enclosingFunctionName(node) === 'makeProductionGh'
    && text(node.arguments[0]) === 'gh'
    && ts.isIdentifier(node.arguments[1])
    && node.arguments[1].text === 'args';
}

function remoteGitRunnerInvocation(node: ts.CallExpression): boolean {
  return ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'runRemoteGit';
}

/** The remote adapter's transport call must forward precisely its guarded argv. */
function guardedRemoteGitRunnerCall(file: string, node: ts.CallExpression): boolean {
  const args = node.arguments[0];
  return normalizedFile(file) === 'engine/remote-git-operations.ts'
    && enclosingFunctionName(node) === 'executeRemoteGit'
    && remoteGitRunnerInvocation(node)
    && ts.isArrayLiteralExpression(args)
    && args.elements.length === 1
    && ts.isSpreadElement(args.elements[0])
    && ts.isIdentifier(args.elements[0].expression)
    && args.elements[0].expression.text === 'args';
}

/**
 * `createBlockerResolver` is an import-bound read composition: its `run`
 * callback queries GitHub's dependency graph and does not own a mutation.
 * Preserve this narrowly proven dynamic argv path without exempting arbitrary
 * aliases or callbacks that could forward a write.
 */
function readOnlyRunnerForwarding(node: ts.CallExpression, readOnlyFactories: ReadonlySet<string>): boolean {
  const callback = node.parent;
  if (!ts.isArrowFunction(callback) || callback.body !== node) return false;
  const property = callback.parent;
  if (!ts.isPropertyAssignment(property) || property.name.getText() !== 'run') return false;
  const options = property.parent;
  if (!ts.isObjectLiteralExpression(options)) return false;
  const factory = options.parent;
  return ts.isCallExpression(factory) && ts.isIdentifier(factory.expression) && readOnlyFactories.has(factory.expression.text);
}

/** Scan one executable TypeScript source file, resolving child-process aliases. */
export function auditGithubInvocationSource(file: string, source: string): GithubInvocationAuditFinding[] {
  const parsed = sourceFile(file, source);
  const findings: GithubInvocationAuditFinding[] = [];
  const processAliases = new Set<string>();
  const rawGithubImports = new Set<string>();
  const readOnlyFactories = new Set<string>();
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
    if (statement.moduleSpecifier.text.endsWith('/blocker-resolver.js') && bindings && ts.isNamedImports(bindings)) {
      for (const item of bindings.elements) {
        if ((item.propertyName?.text ?? item.name.text) === 'createBlockerResolver') readOnlyFactories.add(item.name.text);
      }
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const first = node.initializer.arguments[0];
      if (first && ts.isIdentifier(first) && processAliases.has(first.text)) processAliases.add(node.name.text);
    }
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && rawGithubImports.has(node.expression.text)) {
      findings.push(report(parsed, file, node, 'unapproved raw GitHub HTTP client invocation outside guarded adapter'));
    }
    if (ts.isCallExpression(node)) {
      const called = ts.isIdentifier(node.expression) ? node.expression.text : undefined;
      if (remoteGitRunnerInvocation(node)) {
        const remoteArgs = argv(node.arguments[0]);
        const remoteHead = argvHead(node.arguments[0]);
        if (remoteHead?.[0] === 'push' && !guardedRemoteGitRunnerCall(file, node)) {
          findings.push(report(parsed, file, node, 'direct remote Git mutation outside executeRemoteGit'));
        } else if (!remoteArgs && !remoteHead && !guardedRemoteGitRunnerCall(file, node)) {
          findings.push(report(parsed, file, node, 'unresolvable mutable remote Git command forwarding outside executeRemoteGit'));
        }
      }
      if (directGhInvocation(node, injectedRunners)) {
        const directArgs = argv(node.arguments[0]);
        const directHead = argvHead(node.arguments[0]);
        if (directHead && ghMutation(directHead) && !guardedMutationRunnerCall(node)) {
          findings.push(report(parsed, file, node, 'direct injected GitHub mutation outside guarded adapter'));
        } else if (!directArgs && !directHead
          && !readOnlyRunnerForwarding(node, readOnlyFactories)
          && !guardedDynamicRunnerForwarding(node)) {
          findings.push(report(parsed, file, node, 'unresolvable mutable GitHub command forwarding outside guarded adapter'));
        }
      }
      if (called && rawGithubImports.has(called)) findings.push(report(parsed, file, node, 'unapproved raw GitHub HTTP client invocation outside guarded adapter'));
      if (called && processAliases.has(called)) {
        const executable = text(node.arguments[0]);
        const args = argv(node.arguments[1]);
        const command = argvHead(node.arguments[1]);
        if (executable === 'gh') {
          if (!args && !command && !productionGhTransportCall(file, node)) findings.push(report(parsed, file, node, 'unresolvable executable command construction for gh'));
          else if (command && ghMutation(command) && !productionGhTransportCall(file, node)) findings.push(report(parsed, file, node, 'direct GitHub mutation outside guarded adapter'));
        } else if (executable === 'git') {
          // A generic local-Git runner is not itself a remote invocation site.
          // Literal remote pushes are, and cannot be hidden behind that runner.
          if (command?.[0] === 'push') findings.push(report(parsed, file, node, 'direct remote Git mutation outside executeRemoteGit'));
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
        sites.push({ file, line: location(parsed, node).line, command, classification: remote && productionGhTransportCall(file, node) ? 'approved-adapter' : remote ? 'remote-write' : 'local-git' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return sites;
}
