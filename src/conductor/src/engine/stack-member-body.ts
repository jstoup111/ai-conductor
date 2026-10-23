import { parsePrTemplateRegions } from './pr-body-regions.js';

/** The plan-path grammar consumed by shipment reconciliation. */
export const CHILD_BODY_PLAN_PATH_RE = /\.docs\/plans\/([^/\s`]+)\.md(?![A-Za-z0-9_.-])/g;

export interface ChildBodySlice {
  readonly position: number;
  readonly name: string;
  readonly taskIds: readonly string[];
  readonly storyIds: readonly string[];
}

export interface ChildBodyStory {
  readonly id: string;
  readonly title: string;
}

/** A member label is supplied by the caller because it is a PR concern, not a slice concern. */
export interface ChildBodyMember {
  readonly position: number;
  readonly name: string;
  readonly reference: string;
}

export interface RenderChildBodyInput {
  readonly slice: ChildBodySlice;
  readonly stories: readonly ChildBodyStory[];
  readonly branch: string;
  readonly base: string;
  readonly diffstat: string;
  readonly members: readonly ChildBodyMember[];
  /** The repository PR template, if one exists. Its prose is intentionally not copied. */
  readonly template?: string;
}

export type ChildBodyPostcondition =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

function withoutPlanPaths(value: string): string {
  return value.replace(CHILD_BODY_PLAN_PATH_RE, (_, stem: string) => stem);
}

function invalidTemplate(context: string): never {
  throw new Error(`stack member body: ${context} has invalid project-owned regions`);
}

function templateRegions(template: string | undefined, context: string) {
  if (template === undefined) return [];
  const parsed = parsePrTemplateRegions(template);
  if (!parsed.ok) invalidTemplate(context);
  return parsed.regions;
}

/** Renders the engine-owned navigation section shared by stack members. */
export function renderStackNavigation(
  members: readonly ChildBodyMember[],
  current: number,
): string {
  return [
    '## Stack',
    '',
    ...members.map((member) => `- ${member.reference}${member.position === current ? ' (current)' : ''}`),
  ].join('\n');
}

/**
 * Render a child body from sealed inputs only. In particular, a template supplies
 * project-owned default regions, not any author prose or leaf-only metadata.
 */
export function renderChildBody(input: RenderChildBodyInput): string {
  const storiesById = new Map(input.stories.map((story) => [story.id, story]));
  const summary = [
    '## Summary',
    '',
    ...input.slice.storyIds.map((id) => {
      const story = storiesById.get(id);
      return `- Story ${id}: ${withoutPlanPaths(story?.title ?? id)}`;
    }),
    ...input.slice.taskIds.map((id) => `- Task ${withoutPlanPaths(id)}`),
  ].join('\n');
  const diffstat = [
    '## Diffstat',
    '',
    `${input.branch} against ${input.base}`,
    '',
    '```text',
    input.diffstat,
    '```',
  ].join('\n');
  const defaults = templateRegions(input.template, 'render').map((region) =>
    `<!-- ai-conductor:step ${region.key} -->${region.bytes}<!-- /ai-conductor:step -->`);

  return [
    `# ${withoutPlanPaths(input.slice.name)}`,
    summary,
    diffstat,
    renderStackNavigation(input.members, input.slice.position),
    ...defaults,
  ].join('\n\n');
}

function memberName(member: ChildBodyMember | string): string {
  return typeof member === 'string' ? member : member.name;
}

/**
 * Reject leaf-only metadata and project-owned changes before a child write or
 * ready flip. The result deliberately carries the member name for halt routing.
 */
export function checkChildBodyPostconditions(
  body: string,
  template: string | undefined,
  member: ChildBodyMember | string,
): ChildBodyPostcondition {
  const name = memberName(member);
  if (CHILD_BODY_PLAN_PATH_RE.test(body)) {
    CHILD_BODY_PLAN_PATH_RE.lastIndex = 0;
    return { ok: false, reason: `${name}: body contains a plan path` };
  }
  CHILD_BODY_PLAN_PATH_RE.lastIndex = 0;

  if (/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:https?:\/\/[^\s#]+\/)?(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#\d+\b/i.test(body)) {
    return { ok: false, reason: `${name}: body contains an issue-closing reference` };
  }

  const parsed = parsePrTemplateRegions(body);
  if (!parsed.ok) return { ok: false, reason: `${name}: body has invalid project-owned regions` };
  let expected;
  try {
    expected = templateRegions(template, 'postcondition');
  } catch {
    return { ok: false, reason: `${name}: template has invalid project-owned regions` };
  }
  if (parsed.regions.length !== expected.length) {
    return { ok: false, reason: `${name}: project-owned regions differ from their template defaults` };
  }
  for (const [index, region] of expected.entries()) {
    const actual = parsed.regions[index];
    if (actual?.key !== region.key || actual.bytes !== region.bytes) {
      return {
        ok: false,
        reason: `${name}: project-owned region "${actual?.key ?? region.key}" differs from its template default`,
      };
    }
  }
  return { ok: true };
}
