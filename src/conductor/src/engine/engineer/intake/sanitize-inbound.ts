// Deterministic trust-boundary preparation for tracker-sourced intake text.
//
// This module deliberately starts with segmentation. Later sanitization rules
// operate only on prose, leaving evidence-shaped code, quotes, and indented
// material byte-for-byte intact.

import { createHash } from 'node:crypto';
import { formatWorkRef, type WorkRef } from '../source-ref.js';

/** Stable categories reported when inbound prose is neutralized. */
export type InboundCategory =
  | 'agent-directive'
  | 'role-tag'
  | 'system-prompt'
  | 'tool-call'
  | 'armor-lookalike';

export interface InboundNeutralization {
  category: InboundCategory;
  count: number;
}

export interface InboundSanitizeResult {
  text: string;
  neutralizations: InboundNeutralization[];
  digest: string;
}

export interface InboundTextSegment {
  kind: 'code' | 'prose';
  lines: string[];
}

interface Rule {
  category: Exclude<InboundCategory, 'armor-lookalike'>;
  matches(line: string): boolean;
}

const MARKER = (category: InboundCategory): string => `[neutralized:${category}]`;
const ARMOR_CLOSE = '<<< END INBOUND >>>';

const RULES: Rule[] = [
  {
    category: 'agent-directive',
    matches: (line) =>
      /^(?:ignore|disregard|forget|override)\b.*\b(?:above|previous|prior)\b.*\b(?:run|execute|follow|do)\b/i.test(line),
  },
  { category: 'role-tag', matches: (line) => /^(?:system|assistant|developer|user)\s*:/i.test(line) },
  { category: 'system-prompt', matches: (line) => /^<\/?system\b[^>]*>/i.test(line) },
  {
    category: 'tool-call',
    matches: (line) => /^(?:<\/?tool_call\b[^>]*>|(?:function|tool)_call\s*[:(])/i.test(line),
  },
];

function isFence(line: string): '`' | '~' | undefined {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return undefined;
  return match[1][0] as '`' | '~';
}

function isIndentedOrQuoted(line: string): boolean {
  return /^(?: {4}|\t|>)/.test(line);
}

/**
 * Split inbound Markdown into contiguous code and prose regions without
 * changing line content. The small exported seam keeps the code-exemption
 * contract independently testable; callers will remain within this module.
 */
export function segmentInboundText(input: string): InboundTextSegment[] {
  const segments: InboundTextSegment[] = [];
  let openFence: '`' | '~' | undefined;

  const append = (kind: InboundTextSegment['kind'], line: string): void => {
    const previous = segments.at(-1);
    if (previous?.kind === kind) {
      previous.lines.push(line);
    } else {
      segments.push({ kind, lines: [line] });
    }
  };

  for (const line of input.split('\n')) {
    if (openFence) {
      append('code', line);
      const fence = isFence(line);
      if (fence === openFence) openFence = undefined;
      continue;
    }

    const fence = isFence(line);
    if (fence) {
      append('code', line);
      openFence = fence;
      continue;
    }

    append(isIndentedOrQuoted(line) ? 'code' : 'prose', line);
  }

  return segments;
}

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function splitMarkdownPrefix(line: string): { prefix: string; content: string } {
  const match = line.match(/^(\s*(?:(?:[-+*]|\d+[.)])\s+|#{1,6}\s+)?)(.*)$/);
  return { prefix: match?.[1] ?? '', content: match?.[2] ?? line };
}

function isArmorLookalike(line: string): boolean {
  return /<<<\s*(?:END\s+)?INBOUND\b/i.test(line);
}

/**
 * Neutralize directive-shaped tracker prose and delimit it with source-bound
 * armor. Each tracker field is segmented independently before joining.
 */
export function sanitizeInboundText(input: readonly string[], workRef: WorkRef): InboundSanitizeResult {
  const counts = new Map<InboundCategory, number>();
  // Markdown state belongs to each tracker field, never to the joined envelope.
  const body = input.map((field) => segmentInboundText(field)
    .map((segment) => {
      if (segment.kind === 'code') return segment.lines.join('\n');
      return segment.lines
        .map((line) => {
          const { prefix, content } = splitMarkdownPrefix(line);
          const category = isArmorLookalike(content)
            ? 'armor-lookalike'
            : RULES.find((rule) => rule.matches(content))?.category;
          if (!category) return line;
          counts.set(category, (counts.get(category) ?? 0) + 1);
          return `${prefix}${MARKER(category)}`;
        })
        .join('\n');
    })
    .join('\n')).join('\n\n');
  const bodyDigest = digest(body);
  const text = [`<<< INBOUND sourceRef=${formatWorkRef(workRef)} digest=${bodyDigest} >>>`, body, ARMOR_CLOSE].join('\n');
  const neutralizations = [...counts].map(([category, count]) => ({ category, count }));
  return { text, neutralizations, digest: bodyDigest };
}
