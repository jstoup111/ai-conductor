import { HALT_RECORD_DIR } from '../halt-record.js';

/** Resolve the repository-relative halt-record path for one feature. */
export function haltRecordPathFor(slug: string): string {
  return `${HALT_RECORD_DIR}/${slug}.md`;
}

/** Read the record's resolution time, or its halt time when it remains unresolved. */
export function haltRecordTime(text: string | undefined): Date | undefined {
  if (text === undefined) return undefined;

  const resolved = text.match(/^Resolved at: (.+)$/m)?.[1];
  const halted = text.match(/^Halted at: (.+)$/m)?.[1];
  const value = resolved ?? halted;
  if (value === undefined) return undefined;

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth[month - 1]) return undefined;

  const time = new Date(value);
  return Number.isNaN(time.valueOf()) ? undefined : time;
}

/** Choose the newer halt record, retaining the parent record for ties or uncertainty. */
export function chooseHaltRecord(parentText: string | undefined, rangeText: string | undefined): 'parent' | 'range' {
  if (rangeText === undefined) return 'parent';
  if (parentText === undefined) return 'range';

  const parentTime = haltRecordTime(parentText);
  const rangeTime = haltRecordTime(rangeText);
  if (rangeTime === undefined) return 'parent';
  if (parentTime === undefined) return 'range';
  return rangeTime > parentTime ? 'range' : 'parent';
}
