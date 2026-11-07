import { parseAdrDecisions } from './artifacts.js';

export interface PlanReviewAdrScopeInput {
  readonly planText: string;
  readonly adrTexts: Readonly<Record<string, string>>;
  readonly changedPaths: readonly string[];
}

export interface PlanReviewAdrStemScopeInput {
  readonly planText: string;
  readonly changedPaths: readonly string[];
}

export interface PlanReviewAdrIndexEntry {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

export interface SplitPlanReviewAdrDecisionsInput extends PlanReviewAdrScopeInput {
  /**
   * Decision-bearing ADR contents at the merge base. An absent value means the
   * base could not be read, so review keeps every decision inline.
   */
  readonly baseAdrTexts?: Readonly<Record<string, string | null>>;
}

export interface SplitPlanReviewAdrDecisionsResult {
  readonly inline: Record<string, string>;
  readonly indexed: readonly PlanReviewAdrIndexEntry[];
}

function citedAdrStems(planText: string): Set<string> {
  return new Set([...planText.matchAll(/\b(adr-[a-z0-9][a-z0-9-]*)\b/gi)].map((match) => match[1]!));
}

function changedAdrStems(paths: readonly string[]): Set<string> {
  const stems = new Set<string>();
  for (const path of paths) {
    const match = /(?:^|\/)((?:adr-)[a-z0-9][a-z0-9-]*)\.md$/i.exec(path);
    if (match) stems.add(match[1]!);
  }
  return stems;
}

/** Selects exactly the ADR stems covered by a plan-review round. */
export function selectPlanReviewAdrStems(input: PlanReviewAdrStemScopeInput): readonly string[] {
  return [...new Set([...citedAdrStems(input.planText), ...changedAdrStems(input.changedPaths)])].sort();
}

/** Selects exactly the ADR decisions covered by a plan-review round. */
export function selectPlanReviewAdrDecisionSections(input: PlanReviewAdrScopeInput): Record<string, string> {
  const decisions: Record<string, string> = {};
  for (const stem of selectPlanReviewAdrStems(input)) {
    const text = input.adrTexts[stem];
    if (text === undefined) continue;
    const parsed = parseAdrDecisions(text);
    if (parsed.kind !== 'decisions') continue;
    for (const [id, passages] of parsed.passages) decisions[`${stem}#D${id}`] = passages.join('\n');
  }
  return decisions;
}

/** Narrows raw ADR texts to the same decision-bearing ADR scope. */
export function selectPlanReviewAdrTexts(input: PlanReviewAdrScopeInput): Record<string, string> {
  const selectedDecisions = selectPlanReviewAdrDecisionSections(input);
  const texts: Record<string, string> = {};
  for (const key of Object.keys(selectedDecisions)) {
    const stem = key.split('#')[0]!;
    const text = input.adrTexts[stem];
    if (text !== undefined) texts[stem] = text;
  }
  return texts;
}

/**
 * Separates changed ADR decisions from stable ones that a reviewer can open
 * from the worktree index. A missing merge-base read never weakens review: it
 * retains the existing all-inline behavior.
 */
export function splitPlanReviewAdrDecisions(input: SplitPlanReviewAdrDecisionsInput): SplitPlanReviewAdrDecisionsResult {
  const inline: Record<string, string> = {};
  const indexed: PlanReviewAdrIndexEntry[] = [];
  const changed = changedAdrStems(input.changedPaths);

  for (const stem of selectPlanReviewAdrStems(input)) {
    const text = input.adrTexts[stem];
    if (text === undefined) continue;
    const current = parseAdrDecisions(text);
    if (current.kind !== 'decisions') continue;
    const baseText = input.baseAdrTexts?.[stem];
    const base = typeof baseText === 'string' ? parseAdrDecisions(baseText) : undefined;

    for (const [decisionId, passages] of current.passages) {
      const id = `${stem}#D${decisionId}`;
      const passage = passages.join('\n');
      const basePassage = base?.kind === 'decisions' ? base.passages.get(decisionId)?.join('\n') : undefined;
      const isInline = input.baseAdrTexts === undefined ||
        changed.has(stem) && (baseText === null || baseText === undefined || basePassage !== passage);
      if (isInline) {
        inline[id] = passage;
        continue;
      }
      const title = passage.split('\n').find((line) => line.trim().length > 0)?.trim().slice(0, 160) ?? '';
      indexed.push({ id, title, path: `.docs/decisions/${stem}.md` });
    }
  }
  return { inline, indexed };
}
