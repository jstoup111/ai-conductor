import {
  parsePlanTaskBlocks,
  type ParsedPlanTaskBlock,
} from '../plan-task-parse.js';

export type UnionRemBlocksResult =
  | { readonly kind: 'merged'; readonly text: string }
  | { readonly kind: 'body-mismatch'; readonly remId: string }
  | { readonly kind: 'declined' };

interface ParsedRemPlan {
  readonly authored: string;
  readonly remBlocks: ReadonlyMap<string, ParsedPlanTaskBlock>;
  readonly hasAppendedRemBlocks: boolean;
}

function isRemBlock(id: string): boolean {
  return id.startsWith('rem-');
}

function renderBlock(block: ParsedPlanTaskBlock): string {
  return `${block.heading}\n${block.body}`;
}

function headingStart(text: string, heading: string): number | undefined {
  if (text.startsWith(heading)) return 0;
  const precedingNewline = text.indexOf(`\n${heading}`);
  return precedingNewline === -1 ? undefined : precedingNewline + 1;
}

/**
 * Separates a plan's authored portion from a canonical trailing sequence of
 * rem blocks. A rem block in the middle of a plan is not an append-only plan.
 */
function parseRemPlan(text: string): ParsedRemPlan | undefined {
  const entries = [...parsePlanTaskBlocks(text)];
  const firstRemIndex = entries.findIndex(([id]) => isRemBlock(id));
  if (firstRemIndex === -1) {
    return { authored: text, remBlocks: new Map(), hasAppendedRemBlocks: false };
  }

  const remEntries = entries.slice(firstRemIndex);
  if (remEntries.some(([id]) => !isRemBlock(id))) return undefined;

  const firstBlock = remEntries[0]![1];
  const firstBlockStart = headingStart(text, firstBlock.heading);
  if (firstBlockStart === undefined) return undefined;
  if (text.slice(firstBlockStart) !== remEntries.map(([, block]) => renderBlock(block)).join('')) {
    return undefined;
  }

  return {
    authored: text.slice(0, firstBlockStart),
    remBlocks: new Map(remEntries),
    hasAppendedRemBlocks: true,
  };
}

/** Returns only the canonical whole rem blocks appended to an unchanged base. */
function appendedRemBlocks(base: string, side: string): ReadonlyMap<string, ParsedPlanTaskBlock> | undefined {
  if (!side.startsWith(base)) return undefined;

  const suffix = side.slice(base.length);
  if (suffix === '') return new Map();

  const entries = [...parsePlanTaskBlocks(suffix)];
  if (entries.length === 0 || entries.some(([id]) => !isRemBlock(id))) return undefined;

  const firstBlock = entries[0]![1];
  const firstBlockStart = headingStart(suffix, firstBlock.heading);
  if (firstBlockStart === undefined) return undefined;
  const separator = suffix.slice(0, firstBlockStart);
  if (separator !== '\n' && separator !== '\n\n') return undefined;
  if (suffix.slice(firstBlockStart) !== entries.map(([, block]) => renderBlock(block)).join('')) {
    return undefined;
  }

  return new Map(entries);
}

function sameBlock(left: ParsedPlanTaskBlock, right: ParsedPlanTaskBlock): boolean {
  return left.heading === right.heading && left.body === right.body;
}

function addBlocks(
  target: Map<string, ParsedPlanTaskBlock>,
  additions: ReadonlyMap<string, ParsedPlanTaskBlock>,
): string | undefined {
  for (const [id, block] of additions) {
    const existing = target.get(id);
    if (existing !== undefined && !sameBlock(existing, block)) return id;
    target.set(id, block);
  }
  return undefined;
}

function mergedPlanText(base: ParsedRemPlan, remBlocks: ReadonlyMap<string, ParsedPlanTaskBlock>): string {
  const blocks = [...remBlocks.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, block]) => renderBlock(block))
    .join('');
  if (blocks === '') return base.authored;
  if (base.hasAppendedRemBlocks) return `${base.authored}${blocks}`;
  return `${base.authored}${base.authored.endsWith('\n') ? '\n' : '\n\n'}${blocks}`;
}

/**
 * Deterministically resolves a plan conflict when both sides only append
 * complete remediation blocks to the same plan body.
 */
export function unionRemBlocks(base: string, ours: string, theirs: string): UnionRemBlocksResult {
  const parsedBase = parseRemPlan(base);
  const oursAppended = appendedRemBlocks(base, ours);
  const theirsAppended = appendedRemBlocks(base, theirs);
  if (parsedBase === undefined || oursAppended === undefined || theirsAppended === undefined) {
    return { kind: 'declined' };
  }

  const mergedBlocks = new Map(parsedBase.remBlocks);
  const oursMismatch = addBlocks(mergedBlocks, oursAppended);
  if (oursMismatch !== undefined) return { kind: 'body-mismatch', remId: oursMismatch };
  const theirsMismatch = addBlocks(mergedBlocks, theirsAppended);
  if (theirsMismatch !== undefined) return { kind: 'body-mismatch', remId: theirsMismatch };

  return { kind: 'merged', text: mergedPlanText(parsedBase, mergedBlocks) };
}
