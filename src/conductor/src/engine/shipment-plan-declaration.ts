interface DeclarationSpan {
  stem: string;
  start: number;
  contentEnd: number;
  end: number;
}

/**
 * Extracts the exact stems from standalone, top-level plan declarations.
 * This deliberately recognizes a small line grammar rather than searching PR
 * prose for paths, so examples and quotations cannot bind shipment evidence.
 */
export function extractShipmentPlanDeclarations(body: string): string[] {
  return [...new Set(declarationSpans(body).map(({ stem }) => stem))];
}

/**
 * Replaces recognized declarations with one canonical declaration, or appends
 * one when the body has none. Content outside recognized declaration spans is
 * copied byte-for-byte.
 */
export function upsertShipmentPlanDeclaration(body: string, stem: string): string {
  const declarations = declarationSpans(body);
  const canonical = `Plan: .docs/plans/${stem}.md`;
  if (declarations.length === 0) return appendDeclaration(body, canonical);

  const [first, ...rest] = declarations;
  if (rest.length === 0 && body.slice(first.start, first.contentEnd) === canonical) return body;

  let result = body.slice(0, first.start) + canonical + body.slice(first.contentEnd, first.end);
  let cursor = first.end;
  for (const declaration of rest) {
    result += body.slice(cursor, declaration.start);
    cursor = declaration.end;
  }
  return result + body.slice(cursor);
}

function declarationSpans(body: string): DeclarationSpan[] {
  const declarations: DeclarationSpan[] = [];
  let inComment = false;
  let fence: { character: '`' | '~'; length: number } | undefined;
  for (const line of lines(body)) {
    if (inComment) {
      if (line.text.includes('-->')) inComment = false;
      continue;
    }
    if (fence) {
      if (isFenceClose(line.text, fence)) fence = undefined;
      continue;
    }
    if (line.text.includes('<!--')) {
      if (!line.text.slice(line.text.indexOf('<!--') + '<!--'.length).includes('-->')) inComment = true;
      continue;
    }
    const openedFence = openingFence(line.text);
    if (openedFence) {
      fence = openedFence;
      continue;
    }
    if (isIgnoredIndentedOrQuotedLine(line.text)) continue;
    const match = line.text.match(/^Plan: (`?)\.docs\/plans\/([^/\\\s`]+)\.md\1[ \t]*$/);
    if (!match || match[2] === '.' || match[2] === '..') continue;
    declarations.push({ stem: match[2], start: line.start, contentEnd: line.contentEnd, end: line.end });
  }
  return declarations;
}

function lines(body: string): Array<{ text: string; start: number; contentEnd: number; end: number }> {
  const result: Array<{ text: string; start: number; contentEnd: number; end: number }> = [];
  let start = 0;
  while (start < body.length) {
    const newline = body.indexOf('\n', start);
    const end = newline === -1 ? body.length : newline + 1;
    const contentEnd = newline === -1 ? end : (newline > start && body[newline - 1] === '\r' ? newline - 1 : newline);
    result.push({ text: body.slice(start, contentEnd), start, contentEnd, end });
    start = end;
  }
  return result;
}

function isIgnoredIndentedOrQuotedLine(line: string): boolean {
  return /^(?:[ \t]{1,}|>)/.test(line);
}

function openingFence(line: string): { character: '`' | '~'; length: number } | undefined {
  const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
  if (!match) return undefined;
  return { character: match[1][0] as '`' | '~', length: match[1].length };
}

function isFenceClose(line: string, fence: { character: '`' | '~'; length: number }): boolean {
  const match = line.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/);
  return Boolean(match && match[1][0] === fence.character && match[1].length >= fence.length);
}

function appendDeclaration(body: string, declaration: string): string {
  if (!body) return `${declaration}\n`;
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  return body.endsWith('\n') || body.endsWith('\r')
    ? `${body}${declaration}${newline}`
    : `${body}${newline}${declaration}${newline}`;
}
