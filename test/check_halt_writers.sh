#!/usr/bin/env bash
set -euo pipefail

# Reject production TypeScript that writes the canonical .pipeline/HALT marker
# without going through engine/halt-marker.ts. The scan is deliberately lexical:
# it follows local variable aliases and balanced write-call arguments without
# requiring installed npm dependencies.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_ROOT="${1:-${HARNESS_DIR}/src/conductor/src}"

scan_sources() {
  local source_root=$1

  node - "$source_root" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(process.argv[2]);
const writerNames = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync']);
const allowedSuffix = path.join('engine', 'halt-marker.ts');
let violations = 0;

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(target);
  }
  return found;
}

function firstArgument(source, openParen) {
  let quote = null;
  let escaped = false;
  let depth = 0;
  for (let index = openParen + 1; index < source.length; index += 1) {
    const char = source[index];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) return source.slice(openParen + 1, index);
      depth -= 1;
    } else if (char === ',' && depth === 0) {
      return source.slice(openParen + 1, index);
    }
  }
  return '';
}

function stringValues(expression) {
  const values = [];
  const pattern = /(['"])(.*?)\1/gs;
  for (const match of expression.matchAll(pattern)) values.push(match[2]);
  return values;
}

function targetsCanonicalHalt(expression, aliases) {
  if (/\bHALT_MARKER\b/.test(expression)) return true;
  if (stringValues(expression).includes('.pipeline/HALT')) return true;

  const values = stringValues(expression);
  if (values.includes('.pipeline') && values.includes('HALT')) return true;

  for (const alias of aliases) {
    if (new RegExp(`\\b${alias}\\b`).test(expression)) return true;
  }
  return false;
}

for (const file of sourceFiles(sourceRoot)) {
  if (file.endsWith(allowedSuffix)) continue;
  const source = fs.readFileSync(file, 'utf8');
  const aliases = new Set();
  const assignments = [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/gs)];

  let changed = true;
  while (changed) {
    changed = false;
    for (const assignment of assignments) {
      if (!aliases.has(assignment[1]) && targetsCanonicalHalt(assignment[2], aliases)) {
        aliases.add(assignment[1]);
        changed = true;
      }
    }
  }

  const calls = /\b(?:[A-Za-z_$][\w$]*\.)?([A-Za-z_$][\w$]*)\s*\(/g;
  for (const call of source.matchAll(calls)) {
    if (!writerNames.has(call[1])) continue;
    const openParen = call.index + call[0].lastIndexOf('(');
    if (!targetsCanonicalHalt(firstArgument(source, openParen), aliases)) continue;
    const line = source.slice(0, call.index).split('\n').length;
    console.error(`${path.relative(sourceRoot, file)}:${line}: direct canonical HALT write`);
    violations += 1;
  }
}

process.exitCode = violations === 0 ? 0 : 1;
NODE
}

run_fixture_check() {
  local fixture_dir fixture_output fixture_exit
  fixture_dir="$(mktemp -d)"
  trap 'rm -rf "$fixture_dir"' RETURN
  mkdir -p "${fixture_dir}/engine"

  cat > "${fixture_dir}/constant.ts" <<'EOF'
const marker = HALT_MARKER;
await writeFile(marker, 'reason');
EOF
  cat > "${fixture_dir}/multiline.ts" <<'EOF'
await writeFile(
  join(root, '.pipeline', 'HALT'),
  'reason',
);
EOF
  cat > "${fixture_dir}/alias-variable.ts" <<'EOF'
const marker = '.pipeline/HALT';
const target = join(root, marker);
await fs.writeFile(target, 'reason');
EOF
  cat > "${fixture_dir}/literal-path.ts" <<'EOF'
writeFileSync(join(root, '.pipeline/HALT'), 'reason');
EOF
  cat > "${fixture_dir}/read-only.ts" <<'EOF'
const target = join(root, '.pipeline/HALT');
await readFile(target, 'utf8');
EOF
  cat > "${fixture_dir}/engine/halt-marker.ts" <<'EOF'
await writeFile(join(root, HALT_MARKER), body);
EOF

  set +e
  fixture_output="$(scan_sources "$fixture_dir" 2>&1)"
  fixture_exit=$?
  set -e

  if [ "$fixture_exit" -eq 0 ]; then
    echo "check_halt_writers: violating fixture unexpectedly passed" >&2
    return 1
  fi
  for expected in constant.ts multiline.ts alias-variable.ts literal-path.ts; do
    if ! grep -q "^${expected}:" <<< "$fixture_output"; then
      echo "check_halt_writers: fixture did not report ${expected}" >&2
      echo "$fixture_output" >&2
      return 1
    fi
  done
  if grep -qE '^(read-only.ts|engine/halt-marker.ts):' <<< "$fixture_output"; then
    echo "check_halt_writers: fixture rejected an allowed read or canonical writer" >&2
    echo "$fixture_output" >&2
    return 1
  fi
}

run_fixture_check
scan_sources "$SOURCE_ROOT"
echo "check_halt_writers: controlled fixtures and production sources pass"
