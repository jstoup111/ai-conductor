export type FinalAssistantMessageExtractor = (lines: readonly string[]) => string | undefined;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textFrom(
  content: unknown,
  itemType: string,
): string | undefined {
  if (!Array.isArray(content)) return undefined;

  return content.reduce<string>((text, item) => {
    if (!isRecord(item) || item.type !== itemType || typeof item.text !== 'string') return text;
    return text + item.text;
  }, '');
}

function extractLast(
  lines: readonly string[],
  extract: (record: JsonRecord) => string | undefined,
): string | undefined {
  let result: string | undefined;

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isRecord(parsed)) continue;
      const message = extract(parsed);
      if (message !== undefined) result = message;
    } catch {
      // Transcript captures can end mid-write; use the last complete record.
    }
  }

  return result;
}

export const extractClaudeFinalAssistantMessage: FinalAssistantMessageExtractor = (lines) =>
  extractLast(lines, (record) => {
    if (record.type !== 'assistant' || !isRecord(record.message)) return undefined;
    return textFrom(record.message.content, 'text');
  });

export const extractCodexFinalAssistantMessage: FinalAssistantMessageExtractor = (lines) =>
  extractLast(lines, (record) => {
    if (record.type !== 'response_item' || !isRecord(record.payload)) return undefined;
    if (record.payload.type !== 'message' || record.payload.role !== 'assistant') return undefined;
    return textFrom(record.payload.content, 'output_text');
  });

export const extractPiFinalAssistantMessage: FinalAssistantMessageExtractor = (lines) =>
  extractLast(lines, (record) => {
    if (record.type !== 'message' || !isRecord(record.message)) return undefined;
    if (record.message.role !== 'assistant') return undefined;
    return textFrom(record.message.content, 'text');
  });
