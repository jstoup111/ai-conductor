// Covers: task:2, task:10.3, task:rem-prd-audit-11-r2
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));
const FLAT_REGION_ACCESSORS = new Set([
  'readAllVerdicts', 'readVerdict', 'writeVerdict', 'readKickbackLedger', 'updateKickbackLedger', 'bumpKickbackGate',
]);
const CONDUCT_STATE_MUTATORS = new Set(['apply', 'applyBatch', 'applyCorrection', 'replace']);

type Classification = 'child-aware' | 'whole-feature-only';
type AllowlistEntry = { readonly site: string; readonly classification: Classification; readonly reason?: string };
type CallSite = { readonly site: string; readonly arguments: readonly string[]; readonly source: string };

/** A source-level manifest: a new reader/writer changes this count and must be reviewed. */
const EXPECTED_ACCESS_COUNTS: Readonly<Record<string, number>> = {
  'engine/build-review-cli.ts:readKickbackLedger': 2,
  'engine/conduct-state-store.ts:ConductStateStore.apply': 1,
  'engine/conduct-state-store.ts:ConductStateStore.applyBatch': 2,
  'engine/conductor.ts:ConductStateStore.apply': 1,
  'engine/conductor.ts:ConductStateStore.applyBatch': 2,
  'engine/conductor.ts:readAllVerdicts': 3,
  'engine/conductor.ts:readKickbackLedger': 11,
  'engine/conductor.ts:readVerdict': 4,
  'engine/conductor.ts:updateKickbackLedger': 5,
  'engine/conductor.ts:writeVerdict': 2,
  'engine/coverage-binding-void.ts:ConductStateStore.apply': 1,
  'engine/coverage-binding-void.ts:readVerdict': 1,
  'engine/coverage-binding-void.ts:writeVerdict': 1,
  'engine/daemon-observe-cli.ts:readKickbackLedger': 2,
  'engine/daemon-rekick.ts:readKickbackLedger': 1,
  'engine/finish-publication-production.ts:readAllVerdicts': 1,
  'engine/finish-publication-production.ts:readVerdict': 2,
  'engine/finish-record-cli.ts:ConductStateStore.apply': 1,
  'engine/gate-verdicts.ts:readVerdict': 3,
  'engine/gate-verdicts.ts:writeVerdict': 2,
  'engine/kickback-budget-cli.ts:readKickbackLedger': 5,
  'engine/kickback-ledger.ts:bumpKickbackGate': 2,
  'engine/kickback-ledger.ts:readKickbackLedger': 20,
  'engine/rebase-transition.ts:ConductStateStore.applyBatch': 1,
  'engine/rebase-transition.ts:readVerdict': 9,
  'engine/rebase-transition.ts:updateKickbackLedger': 1,
  'engine/rebase-transition.ts:writeVerdict': 3,
  'engine/rebase.ts:readVerdict': 4,
  'engine/rebase.ts:writeVerdict': 4,
  'engine/remediation-caps.ts:readKickbackLedger': 2,
  'engine/rewind.ts:ConductStateStore.applyBatch': 3,
  'engine/rewind.ts:ConductStateStore.applyCorrection': 1,
  'engine/state.ts:ConductStateStore.apply': 3,
  'engine/state.ts:ConductStateStore.applyBatch': 2,
  'engine/state.ts:ConductStateStore.applyCorrection': 1,
  'engine/state.ts:ConductStateStore.replace': 2,
};

/** Feature-wide rebase records and pure in-memory ledger updates have no child path. */
const WHOLE_FEATURE_ONLY_SITES = new Set([
  'engine/rebase-transition.ts:244:readVerdict',
  'engine/rebase-transition.ts:288:writeVerdict',
  'engine/rebase-transition.ts:363:writeVerdict',
  'engine/rebase-transition.ts:388:readVerdict',
  'engine/rebase-transition.ts:389:readVerdict',
  'engine/rebase.ts:2430:writeVerdict',
  'engine/rebase.ts:2490:writeVerdict',
  'engine/kickback-ledger.ts:1068:bumpKickbackGate',
  'engine/kickback-ledger.ts:1086:bumpKickbackGate',
]);

/**
 * `conductor.ts` owns both a whole-feature `prd_audit` reconciliation write
 * and a region-sensitive completion write.  Keep their classifications at
 * call-site granularity: adding a second write must be an explicit decision,
 * and the region-sensitive one must carry the cursor-selected child.
 */
const CONDUCTOR_WRITE_VERDICT_CLASSIFICATIONS: Readonly<Record<string, Classification>> = {
  prd_audit: 'whole-feature-only',
  'current-step': 'child-aware',
};

const PENDING_CHILD_WIRING: readonly string[] = [];

async function sourceFiles(root: string, relative = ''): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const nextRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [nestedPath, source] of await sourceFiles(path, nextRelative)) files.set(nestedPath, source);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.set(nextRelative, await readFile(path, 'utf8'));
    }
  }
  return files;
}

function callSiteName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression) && FLAT_REGION_ACCESSORS.has(expression.text)) return expression.text;
  if (!ts.isPropertyAccessExpression(expression) || !CONDUCT_STATE_MUTATORS.has(expression.name.text)) return undefined;
  const receiver = expression.expression.getText();
  if (expression.name.text === 'applyBatch' || /^(this\.stateStore|options\.stateStore|stateStore|store|resolved|resolveStateStore\(|createFilesystemConductStateStore\(|storeFor\()/.test(receiver)) {
    return `ConductStateStore.${expression.name.text}`;
  }
  return undefined;
}

function collectCallSites(files: ReadonlyMap<string, string>): CallSite[] {
  const sites: CallSite[] = [];
  for (const [path, contents] of files) {
    const source = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = callSiteName(node.expression);
        if (name) {
          const location = source.getLineAndCharacterOfPosition(node.expression.getStart(source));
          sites.push({
            site: `${path}:${location.line + 1}:${name}`,
            arguments: node.arguments.map((argument) => argument.getText(source)),
            source: contents,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites.sort(({ site: left }, { site: right }) => left.localeCompare(right));
}

function accessKey(site: string): string {
  const [path, _line, accessor] = site.split(':');
  return `${path}:${accessor}`;
}

function conductorWriteVerdictIdentity(args: readonly string[]): string | undefined {
  const step = args[1]?.replace(/\s+/g, '');
  if (step === "'prd_audit'" || step === '"prd_audit"') return 'prd_audit';
  if (step === 'step.name') return 'current-step';
  return undefined;
}

function childArgumentCarriesActiveRegionChild({ arguments: args, source }: CallSite): boolean {
  const childArgument = args[3];
  if (childArgument === undefined) return false;
  if (childArgument.includes('this.activeRegionChild')) return true;
  if (!/^[A-Za-z_$][\w$]*$/.test(childArgument)) return false;
  const binding = new RegExp(`\\b(?:const|let)\\s+${childArgument}\\s*=\\s*([\\s\\S]*?);`).exec(source);
  return binding?.[1]?.includes('this.activeRegionChild') === true;
}

function audit(files: ReadonlyMap<string, string>): readonly AllowlistEntry[] {
  const calls = collectCallSites(files);
  const sites = calls.map(({ site }) => site);
  const counts = Object.fromEntries(Object.entries(EXPECTED_ACCESS_COUNTS).map(([key]) => [key, 0])) as Record<string, number>;
  const unexpected: string[] = [];
  for (const site of sites) {
    const key = accessKey(site);
    if (counts[key] === undefined) unexpected.push(site);
    else counts[key]++;
  }
  const drift = Object.entries(EXPECTED_ACCESS_COUNTS)
    .filter(([key, expected]) => counts[key] !== expected)
    .map(([key, expected]) => `${key} expected ${expected}, got ${counts[key] ?? 0}`);
  if (unexpected.length > 0 || drift.length > 0) {
    throw new Error(`unallowlisted flat-region access sites: ${unexpected.join(', ') || 'none'}\naccess manifest drift: ${drift.join(', ') || 'none'}`);
  }
  const conductorWriteVerdicts = calls
    .filter(({ site }) => site.startsWith('engine/conductor.ts:') && site.endsWith(':writeVerdict'))
    .map((call) => ({ ...call, identity: conductorWriteVerdictIdentity(call.arguments) }));
  const unclassifiedConductorWrites = conductorWriteVerdicts
    .filter(({ identity }) => identity === undefined || CONDUCTOR_WRITE_VERDICT_CLASSIFICATIONS[identity] === undefined)
    .map(({ site }) => site);
  const conductorWriteClassificationCountDrift = Object.keys(CONDUCTOR_WRITE_VERDICT_CLASSIFICATIONS)
    .map((identity) => ({ identity, count: conductorWriteVerdicts.filter((call) => call.identity === identity).length }))
    .filter(({ count }) => count !== 1)
    .map(({ identity, count }) => `${identity} expected 1, got ${count}`);
  const activeRegionWritesMissingChild = conductorWriteVerdicts
    .filter(({ identity, ...call }) =>
      CONDUCTOR_WRITE_VERDICT_CLASSIFICATIONS[identity ?? ''] === 'child-aware' &&
      !childArgumentCarriesActiveRegionChild(call),
    )
    .map(({ site }) => site);
  if (
    unclassifiedConductorWrites.length > 0 ||
    conductorWriteClassificationCountDrift.length > 0 ||
    activeRegionWritesMissingChild.length > 0
  ) {
    throw new Error([
      `unclassified conductor writeVerdict sites: ${unclassifiedConductorWrites.join(', ') || 'none'}`,
      `conductor writeVerdict classification count drift: ${conductorWriteClassificationCountDrift.join(', ') || 'none'}`,
      `active-region conductor writeVerdict sites missing child: ${activeRegionWritesMissingChild.join(', ') || 'none'}`,
    ].join('\n'));
  }
  return sites.map((site) => WHOLE_FEATURE_ONLY_SITES.has(site)
    ? { site, classification: 'whole-feature-only' as const, reason: 'The rebase and coverage-binding gates remain feature-wide.' }
    : { site, classification: 'child-aware' as const });
}

describe('child-region flat-access audit', () => {
  it('requires every current flat-region reader and writer to be classified', async () => {
    const entries = audit(await sourceFiles(ENGINE_ROOT));
    expect(entries).toHaveLength(Object.values(EXPECTED_ACCESS_COUNTS).reduce((total, count) => total + count, 0));
    expect(entries.filter((entry) => entry.classification === 'whole-feature-only' && !entry.reason?.trim())).toEqual([]);
  });

  it('rejects an unallowlisted reader in an in-memory production source fixture', () => {
    const fixture = new Map([['engine/future.ts', "import { readVerdict } from './gate-verdicts.js';\nexport async function future(root: string) { return readVerdict(root, 'build'); }"]]);
    expect(() => audit(fixture)).toThrow('engine/future.ts:2:readVerdict');
  });

  it('has no pending child wiring', () => {
    expect(PENDING_CHILD_WIRING).toEqual([]);
  });
});
