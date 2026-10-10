// Covers: task:2
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ENGINE_ROOT = fileURLToPath(new URL('../../src/', import.meta.url));

const FLAT_REGION_ACCESSORS = new Set([
  'readAllVerdicts',
  'readVerdict',
  'writeVerdict',
  'readKickbackLedger',
  'updateKickbackLedger',
  'bumpKickbackGate',
]);
const CONDUCT_STATE_MUTATORS = new Set(['apply', 'applyBatch', 'applyCorrection', 'replace']);

type Classification = 'child-aware' | 'whole-feature-only' | 'pending-child-wiring';

interface AllowlistEntry {
  readonly site: string;
  readonly classification: Classification;
  readonly reason?: string;
}

/**
 * Every entry is a production call site.  The later cursor tasks move entries
 * from pending-child-wiring only after the call passes the active child.
 */
const PENDING_CHILD_WIRING = [
  'engine/build-review-cli.ts:324:readKickbackLedger',
  'engine/build-review-cli.ts:518:readKickbackLedger',
  'engine/conductor.ts:1009:updateKickbackLedger',
  'engine/conductor.ts:10343:readKickbackLedger',
  'engine/conductor.ts:10599:readKickbackLedger',
  'engine/conductor.ts:10768:readVerdict',
  'engine/conductor.ts:12074:readKickbackLedger',
  'engine/conductor.ts:12216:readKickbackLedger',
  'engine/conductor.ts:1340:readKickbackLedger',
  'engine/conductor.ts:13919:readVerdict',
  'engine/conductor.ts:13921:readAllVerdicts',
  'engine/conductor.ts:13937:updateKickbackLedger',
  'engine/conductor.ts:13984:writeVerdict',
  'engine/conductor.ts:14059:readAllVerdicts',
  'engine/conductor.ts:14072:readVerdict',
  'engine/conductor.ts:14134:readAllVerdicts',
  'engine/conductor.ts:1911:ConductStateStore.applyBatch',
  'engine/conductor.ts:1919:ConductStateStore.apply',
  'engine/conductor.ts:2054:ConductStateStore.applyBatch',
  'engine/conductor.ts:5858:readKickbackLedger',
  'engine/conductor.ts:5879:readAllVerdicts',
  'engine/conductor.ts:6102:readKickbackLedger',
  'engine/conductor.ts:6155:readKickbackLedger',
  'engine/conductor.ts:6222:readKickbackLedger',
  'engine/conductor.ts:6256:updateKickbackLedger',
  'engine/conductor.ts:6296:updateKickbackLedger',
  'engine/conductor.ts:7721:writeVerdict',
  'engine/conductor.ts:8906:readKickbackLedger',
  'engine/conductor.ts:990:readKickbackLedger',
  'engine/conductor.ts:999:updateKickbackLedger',
  'engine/coverage-binding-void.ts:64:readVerdict',
  'engine/coverage-binding-void.ts:71:ConductStateStore.apply',
  'engine/coverage-binding-void.ts:89:writeVerdict',
  'engine/daemon-observe-cli.ts:601:readKickbackLedger',
  'engine/daemon-rekick.ts:256:readKickbackLedger',
  'engine/finish-publication-production.ts:576:readAllVerdicts',
  'engine/finish-record-cli.ts:378:ConductStateStore.apply',
  'engine/gate-verdicts.ts:189:readVerdict',
  'engine/gate-verdicts.ts:202:writeVerdict',
  'engine/gate-verdicts.ts:219:readVerdict',
  'engine/gate-verdicts.ts:273:writeVerdict',
  'engine/gate-verdicts.ts:311:readVerdict',
  'engine/kickback-budget-cli.ts:138:readKickbackLedger',
  'engine/kickback-budget-cli.ts:179:readKickbackLedger',
  'engine/kickback-budget-cli.ts:223:readKickbackLedger',
  'engine/kickback-budget-cli.ts:240:readKickbackLedger',
  'engine/kickback-budget-cli.ts:89:readKickbackLedger',
  'engine/kickback-ledger.ts:1075:readKickbackLedger',
  'engine/kickback-ledger.ts:1092:readKickbackLedger',
  'engine/kickback-ledger.ts:1130:readKickbackLedger',
  'engine/kickback-ledger.ts:1206:readKickbackLedger',
  'engine/kickback-ledger.ts:1224:readKickbackLedger',
  'engine/kickback-ledger.ts:1235:readKickbackLedger',
  'engine/kickback-ledger.ts:1276:readKickbackLedger',
  'engine/kickback-ledger.ts:1295:readKickbackLedger',
  'engine/kickback-ledger.ts:1311:readKickbackLedger',
  'engine/kickback-ledger.ts:1330:readKickbackLedger',
  'engine/kickback-ledger.ts:1413:readKickbackLedger',
  'engine/kickback-ledger.ts:1431:readKickbackLedger',
  'engine/kickback-ledger.ts:1456:readKickbackLedger',
  'engine/kickback-ledger.ts:1475:readKickbackLedger',
  'engine/kickback-ledger.ts:1501:readKickbackLedger',
  'engine/kickback-ledger.ts:1520:readKickbackLedger',
  'engine/kickback-ledger.ts:547:readKickbackLedger',
  'engine/kickback-ledger.ts:797:readKickbackLedger',
  'engine/kickback-ledger.ts:929:readKickbackLedger',
  'engine/kickback-ledger.ts:989:readKickbackLedger',
  'engine/rebase-transition.ts:160:readVerdict',
  'engine/rebase-transition.ts:225:readVerdict',
  'engine/rebase-transition.ts:228:readVerdict',
  'engine/rebase-transition.ts:263:readVerdict',
  'engine/rebase-transition.ts:269:writeVerdict',
  'engine/rebase-transition.ts:287:ConductStateStore.applyBatch',
  'engine/rebase-transition.ts:302:readVerdict',
  'engine/rebase-transition.ts:315:readVerdict',
  'engine/rebase-transition.ts:320:writeVerdict',
  'engine/rebase-transition.ts:332:readVerdict',
  'engine/rebase-transition.ts:344:writeVerdict',
  'engine/rebase-transition.ts:369:readVerdict',
  'engine/rebase-transition.ts:370:readVerdict',
  'engine/rebase-transition.ts:53:updateKickbackLedger',
  'engine/rebase.ts:2332:readVerdict',
  'engine/rebase.ts:2373:writeVerdict',
  'engine/rebase.ts:2387:writeVerdict',
  'engine/rebase.ts:2425:writeVerdict',
  'engine/rebase.ts:2485:writeVerdict',
  'engine/rebase.ts:2561:readVerdict',
  'engine/rebase.ts:2672:readVerdict',
  'engine/rebase.ts:2683:readVerdict',
  'engine/remediation-caps.ts:47:readKickbackLedger',
  'engine/remediation-caps.ts:90:readKickbackLedger',
  'engine/rewind.ts:303:ConductStateStore.applyBatch',
  'engine/rewind.ts:311:ConductStateStore.applyCorrection',
  'engine/rewind.ts:534:ConductStateStore.applyBatch',
  'engine/rewind.ts:607:ConductStateStore.applyBatch',
  'engine/state.ts:107:ConductStateStore.replace',
  'engine/state.ts:140:ConductStateStore.applyBatch',
  'engine/state.ts:150:ConductStateStore.replace',
  'engine/state.ts:163:ConductStateStore.applyCorrection',
  'engine/state.ts:185:ConductStateStore.applyBatch',
  'engine/state.ts:238:ConductStateStore.apply',
  'engine/state.ts:257:ConductStateStore.apply',
  'engine/state.ts:292:ConductStateStore.apply',
] as const;

const ACCESS_ALLOWLIST: readonly AllowlistEntry[] = [
  ...PENDING_CHILD_WIRING.map((site) => ({ site, classification: 'pending-child-wiring' as const })),
  {
    site: 'engine/kickback-ledger.ts:1060:bumpKickbackGate',
    classification: 'whole-feature-only',
    reason: 'Pure in-memory ledger-entry update; its caller chooses the durable ledger path.',
  },
  {
    site: 'engine/kickback-ledger.ts:1077:bumpKickbackGate',
    classification: 'whole-feature-only',
    reason: 'Pure in-memory ledger-entry update; its caller chooses the durable ledger path.',
  },
];

const EXPECTED_PENDING_CHILD_WIRING: readonly string[] = PENDING_CHILD_WIRING;

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

function conductStateMutationName(expression: ts.Expression): string | undefined {
  if (!ts.isPropertyAccessExpression(expression) || !CONDUCT_STATE_MUTATORS.has(expression.name.text)) {
    return undefined;
  }
  const receiver = expression.expression.getText();
  if (
    expression.name.text === 'applyBatch'
    || /^(this\.stateStore|options\.stateStore|stateStore|store|resolved|resolveStateStore\(|createFilesystemConductStateStore\(|storeFor\()/.test(receiver)
  ) {
    return `ConductStateStore.${expression.name.text}`;
  }
  return undefined;
}

function callSiteName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression) && FLAT_REGION_ACCESSORS.has(expression.text)) return expression.text;
  return conductStateMutationName(expression);
}

function collectCallSites(files: ReadonlyMap<string, string>): string[] {
  const sites: string[] = [];
  for (const [path, contents] of files) {
    const source = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = callSiteName(node.expression);
        if (name) {
          const location = source.getLineAndCharacterOfPosition(node.expression.getStart(source));
          sites.push(`${path}:${location.line + 1}:${name}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sites.sort();
}

function audit(files: ReadonlyMap<string, string>, allowlist: readonly AllowlistEntry[]): string[] {
  const sites = collectCallSites(files);
  const allowed = allowlist.map(({ site }) => site).sort();
  const duplicateAllowlistEntries = allowed.filter((site, index) => site === allowed[index - 1]);
  const missing = sites.filter((site) => !allowed.includes(site));
  const stale = allowed.filter((site) => !sites.includes(site));
  const missingWholeFeatureReasons = allowlist
    .filter((entry) => entry.classification === 'whole-feature-only' && !entry.reason?.trim())
    .map((entry) => entry.site);

  if (missing.length > 0 || stale.length > 0 || duplicateAllowlistEntries.length > 0 || missingWholeFeatureReasons.length > 0) {
    throw new Error([
      `unallowlisted flat-region access sites: ${missing.join(', ') || 'none'}`,
      `stale flat-region access allowlist entries: ${stale.join(', ') || 'none'}`,
      `duplicate flat-region access allowlist entries: ${duplicateAllowlistEntries.join(', ') || 'none'}`,
      `whole-feature-only entries missing reasons: ${missingWholeFeatureReasons.join(', ') || 'none'}`,
    ].join('\n'));
  }
  return sites;
}

describe('child-region flat-access audit', () => {
  it('requires every current flat-region reader and writer to be classified', async () => {
    const sites = audit(await sourceFiles(ENGINE_ROOT), ACCESS_ALLOWLIST);
    expect(sites).toEqual(ACCESS_ALLOWLIST.map(({ site }) => site).sort());
  });

  it('rejects an unallowlisted reader in an in-memory production source fixture', () => {
    const fixture = new Map([['engine/future.ts', [
      "import { readVerdict } from './gate-verdicts.js';",
      '',
      "export async function future(root: string) { return readVerdict(root, 'build'); }",
    ].join('\n')]]);

    expect(() => audit(fixture, [])).toThrow('engine/future.ts:3:readVerdict');
  });

  it('pins the remaining sites that still need active-child wiring', () => {
    const pending = ACCESS_ALLOWLIST
      .filter((entry) => entry.classification === 'pending-child-wiring')
      .map((entry) => entry.site)
      .sort();

    expect(pending).toEqual(EXPECTED_PENDING_CHILD_WIRING);
  });
});
