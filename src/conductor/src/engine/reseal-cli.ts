export interface ResealDispatch {
  kind: 'reseal';
  slug: string;
  paths: string[];
  reason: string;
  clearHalt: boolean;
}

export function detectResealCommand(argv: string[]): ResealDispatch | null {
  if (argv[2] !== 'reseal') return null;

  let slug: string | undefined;
  let reason: string | undefined;
  const paths: string[] = [];
  let clearHalt = false;

  for (let index = 3; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--clear-halt') {
      if (clearHalt) return null;
      clearHalt = true;
      continue;
    }

    if (flag !== '--slug' && flag !== '--path' && flag !== '--reason') return null;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return null;
    index += 1;

    if (flag === '--slug') {
      if (slug !== undefined) return null;
      slug = value;
    } else if (flag === '--reason') {
      if (reason !== undefined) return null;
      reason = value;
    } else {
      paths.push(value);
    }
  }

  if (!slug || !reason || !reason.trim() || paths.length === 0) return null;
  if (slug.includes('/') || slug.includes('\\') || slug === '.' || slug === '..') return null;

  return { kind: 'reseal', slug, paths, reason, clearHalt };
}
