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
