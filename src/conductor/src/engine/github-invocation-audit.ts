/** Static AST audit for shipped GitHub and remote-Git invocation boundaries. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

/**
 * Non-operator executable surfaces retain only named site classifications.
 * Empty inventories are intentional: the file is still fully audited, so a
 * later direct invocation cannot inherit a whole-file exception.
 */
export const SHIPPED_GITHUB_INVOCATION_SITE_INVENTORY = {
  'scripts/intake-label-sync-apply.mts': [] as const,
} as const;

/**
 * Pre-boundary read sites are explicit, line-addressed compatibility entries.
 * They are not a file-level escape hatch: a new literal invocation, including
 * one in these files, has no entry and fails the audit. New code must use
 * `runTrackerRead` instead of extending this historical inventory.
 */
const APPROVED_DIRECT_GITHUB_READ_SITES = new Set([
  'engine/backlog-priority.ts:323', 'engine/blocker-resolver.ts:162',
  'engine/conductor.ts:5633', 'engine/conductor.ts:6558', 'engine/conductor.ts:6608',
  'engine/conductor.ts:6639', 'engine/conductor.ts:6742', 'engine/conductor.ts:6774', 'engine/conductor.ts:6830',
  'engine/documentation-delivery.ts:68', 'engine/engineer/intake/delivery-guard.ts:31',
  'engine/engineer/intake/delivery-guard.ts:79', 'engine/engineer/issue-dep-migration.ts:258',
  'engine/engineer/issue-dep-migration.ts:289', 'engine/engineer/issue-ref.ts:116',
  'engine/engineer/release-metadata-inject.ts:146', 'engine/finish-publication-production.ts:385',
  'engine/finish-publication-production.ts:416', 'engine/finish-publication-production.ts:455',
  'engine/finish-publication-production.ts:540', 'engine/halt-pr-rehabilitation.ts:153',
  'engine/halt-pr-rehabilitation.ts:206', 'engine/halt-pr-rehabilitation.ts:299',
  'engine/halt-pr-rehabilitation.ts:343', 'engine/halt-pr-rehabilitation.ts:441',
  'engine/halt-pr-rehabilitation.ts:570', 'engine/halt-pr-rehabilitation.ts:610',
  'engine/halt-pr-rehabilitation.ts:760', 'engine/halt-pr-rehabilitation.ts:868',
  'engine/halt-pr-rehabilitation.ts:939', 'engine/merged-pr-guard.ts:43',
  'engine/owner-gate/identity.ts:70', 'engine/park-reconciliation.ts:290',
  'engine/pr-criticality-labels.ts:84', 'engine/pr-labels.ts:527', 'engine/pr-labels.ts:633',
  'engine/pr-labels.ts:665', 'engine/pr-labels.ts:697', 'engine/pr-labels.ts:822',
  'engine/pr-labels.ts:907', 'engine/pr-labels.ts:1008', 'engine/ship-draft-pr.ts:298',
  'engine/shipment-audit.ts:744', 'engine/shipment-evidence.ts:92', 'engine/tracker-client.ts:797',
  'intake-backfill-cli.ts:40',
]);

const PROCESS_MODULE = /^(?:node:)?child_process$/;
const EXECA_MODULE = /^execa(?:\/|$)/;
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
  'intake.issue.comment.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.close': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.label.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.label.remove': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'intake.issue.dependency.add': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'issue.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'pull-request.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'commit.status.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'label-definition.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'label-definition.update': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
  'repository.create': { adapter: 'createGuardedGithubOperationRunner', owner: 'tracker-client.ts' },
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

function enclosingFunction(node: ts.Node): ts.FunctionDeclaration | undefined {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current)) return current;
  }
  return undefined;
}

function enclosingFunctionName(node: ts.Node): string | undefined { return enclosingFunction(node)?.name?.text; }

function isPropertyAccess(node: ts.Node | undefined, object: string, property: string): boolean {
  return !!node
    && ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === object
    && node.name.text === property;
}

function isCanonicalGuardedAdapterTransportCall(file: string, node: ts.CallExpression): boolean {
  const owner = enclosingFunction(node);
  if (normalizedFile(file) !== 'engine/tracker-client.ts'
    || owner?.name?.text !== 'createGuardedGithubOperationRunner'
    || owner.parameters.length !== 2) return false;
  const [transport, options] = owner.parameters;
  if (!ts.isIdentifier(transport.name) || transport.name.text !== 'transport'
    || typeReferenceName(transport.type) !== 'GhRunner'
    || !ts.isIdentifier(options.name) || options.name.text !== 'options'
    || !ts.isIdentifier(node.expression) || node.expression.text !== 'transport'
    || node.arguments.length !== 2) return false;
  const [command, executionOptions] = node.arguments;
  if (!ts.isCallExpression(command) || !ts.isIdentifier(command.expression)
    || command.expression.text !== 'ghArgsFor' || command.arguments.length !== 1
    || !ts.isIdentifier(command.arguments[0]) || command.arguments[0].text !== 'request'
    || !ts.isObjectLiteralExpression(executionOptions) || executionOptions.properties.length !== 1) return false;
  const cwd = executionOptions.properties[0];
  return ts.isPropertyAssignment(cwd)
    && cwd.name.getText() === 'cwd'
    && isPropertyAccess(cwd.initializer, 'options', 'cwd');
}

/**
 * Approved calls are structural, never file-wide.  Each accepted mutation is
 * the canonical guarded adapter. Literal mutations remain findings everywhere
 * else: a composition helper cannot confer write authority merely by naming
 * its callback after a registered operation.
 */
function guardedMutationRunnerCall(file: string, node: ts.CallExpression): boolean {
  return isCanonicalGuardedAdapterTransportCall(file, node);
}

function approvedDirectGithubReadCall(file: string, parsed: ts.SourceFile, node: ts.CallExpression): boolean {
  return APPROVED_DIRECT_GITHUB_READ_SITES.has(`${normalizedFile(file)}:${location(parsed, node).line}`);
}

/** Every dynamic GhRunner forwarding exemption is bound to its real owner. */
const GUARDED_DYNAMIC_RUNNER_FORWARDER_OWNERS: Readonly<Record<
  'runTrackerRead' | 'runTrackerIssueOperation' | 'graphqlPage' | 'guardedPrRunner',
  readonly string[]
>> = {
  runTrackerRead: ['engine/tracker-client.ts'],
  runTrackerIssueOperation: ['engine/tracker-client.ts'],
  graphqlPage: ['engine/shipment-audit.ts'],
  guardedPrRunner: ['engine/gate-writeback.ts', 'engine/pr-labels.ts'],
};

/** Dynamic runner forwarding is safe only inside an explicitly typed read or adapter seam. */
function guardedDynamicRunnerForwarding(file: string, node: ts.CallExpression): boolean {
  const owner = enclosingFunctionName(node);
  if (isCanonicalGuardedAdapterTransportCall(file, node)) return true;
  if (owner === 'runTrackerRead' || owner === 'graphqlPage' || owner === 'runTrackerIssueOperation') {
    return GUARDED_DYNAMIC_RUNNER_FORWARDER_OWNERS[owner].includes(normalizedFile(file));
  }
  if (owner !== 'guardedPrRunner') return false;
  if (!GUARDED_DYNAMIC_RUNNER_FORWARDER_OWNERS.guardedPrRunner.includes(normalizedFile(file))) return false;
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

function processFactoryReference(
  node: ts.Expression | undefined,
  aliases: ReadonlySet<string>,
  namespaces: ReadonlySet<string>,
): boolean {
  return !!node && (
    (ts.isIdentifier(node) && aliases.has(node.text))
    || (ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && namespaces.has(node.expression.text)
      && PROCESS_FACTORY_NAMES.has(node.name.text))
  );
}

function processFactoryCall(
  node: ts.CallExpression,
  aliases: ReadonlySet<string>,
  namespaces: ReadonlySet<string>,
): boolean { return processFactoryReference(node.expression, aliases, namespaces); }

function globalFetchCall(node: ts.CallExpression): boolean {
  if (ts.isIdentifier(node.expression)) return node.expression.text === 'fetch';
  return ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && (node.expression.expression.text === 'globalThis' || node.expression.expression.text === 'global')
    && node.expression.name.text === 'fetch';
}

function githubHttpUrl(node: ts.Expression | undefined): boolean {
  const url = text(node);
  return url !== undefined && /^https?:\/\/(?:[^/]*\.)?github\.com(?:[/:]|$)/i.test(url);
}

/** Scan one executable TypeScript source file, resolving child-process aliases. */
export function auditGithubInvocationSource(file: string, source: string): GithubInvocationAuditFinding[] {
  const parsed = sourceFile(file, source);
  const findings: GithubInvocationAuditFinding[] = [];
  const processAliases = new Set<string>();
  const processNamespaces = new Set<string>();
  const rawGithubImports = new Set<string>();
  const readOnlyFactories = new Set<string>();
  const injectedRunners = injectedGhRunnerNames(parsed);
  for (const statement of parsed.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (PROCESS_MODULE.test(statement.moduleSpecifier.text)) {
      if (statement.importClause?.name) processNamespaces.add(statement.importClause.name.text);
      if (bindings && ts.isNamespaceImport(bindings)) processNamespaces.add(bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if (PROCESS_FACTORY_NAMES.has(item.propertyName?.text ?? item.name.text)) processAliases.add(item.name.text);
      }
    }
    if (EXECA_MODULE.test(statement.moduleSpecifier.text)) {
      if (statement.importClause?.name) processAliases.add(statement.importClause.name.text);
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) {
        if ((item.propertyName?.text ?? item.name.text) === 'execa') processAliases.add(item.name.text);
      }
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
      if (processFactoryReference(first, processAliases, processNamespaces)
        || processFactoryReference(node.initializer, processAliases, processNamespaces)) processAliases.add(node.name.text);
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
        if (directHead && ghMutation(directHead) && !guardedMutationRunnerCall(file, node)) {
          findings.push(report(parsed, file, node, 'direct injected GitHub mutation outside guarded adapter'));
        } else if (directHead && !guardedMutationRunnerCall(file, node) && !approvedDirectGithubReadCall(file, parsed, node)) {
          findings.push(report(parsed, file, node, 'direct injected GitHub read outside guarded adapter'));
        } else if (!directArgs && !directHead
          && !readOnlyRunnerForwarding(node, readOnlyFactories)
          && !guardedDynamicRunnerForwarding(file, node)) {
          findings.push(report(parsed, file, node, 'unresolvable mutable GitHub command forwarding outside guarded adapter'));
        }
      }
      if (called && rawGithubImports.has(called)) findings.push(report(parsed, file, node, 'unapproved raw GitHub HTTP client invocation outside guarded adapter'));
      if (globalFetchCall(node) && githubHttpUrl(node.arguments[0])) {
        findings.push(report(parsed, file, node, 'unapproved raw GitHub HTTP client invocation outside guarded adapter'));
      }
      if (processFactoryCall(node, processAliases, processNamespaces)) {
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
      else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.mts')) && !entry.name.endsWith('.d.ts')) files.push(path);
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
    const source = readFileSync(file, 'utf8');
    // The production entry consumes the same site inventory exposed to tests.
    // CI workflow scripts are classified explicitly; every other executable
    // site is audited as an operator-harness invocation.
    const sites = findGithubInvocationSites(runtimeFile, source);
    findings.push(...auditGithubInvocationSource(runtimeFile, source));
    for (const site of sites) {
      if (site.classification === 'remote-write') {
        findings.push({ file: site.file, line: site.line, column: 1, message: 'unclassified executable GitHub invocation site' });
      }
    }
  }
  const repositoryRoots = [join(conductorRoot, '..', '..'), conductorRoot];
  const scanned = new Set<string>();
  for (const repositoryRoot of repositoryRoots) for (const directory of [join(repositoryRoot, 'skills'), join(repositoryRoot, 'bin')]) {
    if (!existsSync(directory)) continue;
    const stack = [directory];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const file = join(current, entry.name);
        if (entry.isDirectory()) { stack.push(file); continue; }
        if (!entry.isFile() || !(entry.name === 'SKILL.md' || !entry.name.includes('.'))) continue;
        if (scanned.has(file)) continue;
        scanned.add(file);
        const source = readFileSync(file, 'utf8');
        const relativeFile = relative(repositoryRoot, file).split(sep).join('/');
        const blocks = entry.name === 'SKILL.md'
          ? [...source.matchAll(/```bash\s*\n([\s\S]*?)```/g)].map((match) => ({ offset: match.index ?? 0, text: match[1] }))
          : [{ offset: 0, text: source }];
        for (const block of blocks) {
          const raw = /\bgh\s+(?:repo\s+create|pr\s+(?:create|edit|ready|comment|close|merge)|issue\s+(?:create|edit|close|comment)|api\b)|\bgit\s+push\b|\bgit\s+push\s+.*--delete\b/.exec(block.text);
          if (!raw) continue;
          const line = source.slice(0, block.offset + raw.index).split('\n').length;
          findings.push({
            file: relativeFile,
            line,
            column: 1,
            message: 'raw GitHub or remote-Git write in executable publication block; use ai-conductor github-operation',
          });
        }
      }
    }
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
