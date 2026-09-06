#!/usr/bin/env bash
set -euo pipefail

# Covers: task:1
# Parser-level contract for bin/migrate candidate ordering. This sources only
# the helper region; no installation, migration execution, or external service
# is involved.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATE_SRC="$REPO_ROOT/bin/migrate"
MIGRATION_FENCES_SRC="$REPO_ROOT/bin/lib/migration_fences.py"

PASS=0
FAIL=0

assert() {
  local description=$1 result=$2
  if [ "$result" -eq 0 ]; then
    printf 'PASS %s\n' "$description"
    PASS=$((PASS + 1))
  else
    printf 'FAIL %s\n' "$description"
    FAIL=$((FAIL + 1))
  fi
}

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

FENCE_FIXTURE="$TMP_ROOT/fences.md"
cat > "$FENCE_FIXTURE" <<'EOF'
```bash migration
outside-section
```

## Migration

```bash migration<TRAILING>
canonical
```

```bash migration<CRLF>
crlf
```

```bash migration
wider-opener
`````

````markdown
## Migration

```bash migration
inside-backticks
```
````

~~~~text
## Migration

```bash migration
inside-tildes
```
~~~~

## Migration

```bash migration
second-section
```

```bash migration
unterminated
EOF

python3 - "$FENCE_FIXTURE" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.write_bytes(
    path.read_bytes()
    .replace(b"bash migration<TRAILING>\n", b"bash migration   \n")
    .replace(b"bash migration<CRLF>\n", b"bash migration\r\n")
)
PY

FENCE_REPORT=$(python3 - "$MIGRATION_FENCES_SRC" "$FENCE_FIXTURE" <<'PY'
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(sys.argv[1]).parent))
import migration_fences
text = Path(sys.argv[2]).read_text()
print(json.dumps([
    {
        "script": candidate.script,
        "in_migration_section": candidate.in_migration_section,
        "closed": candidate.closed,
        "span": (candidate.source_start, candidate.source_end),
    }
    for candidate in migration_fences.scan_migration_fences(text)
]))
PY
)
assert 'scanner preserves canonical, trailing-whitespace, and CRLF-info-string runnable candidates' \
  "$(python3 - "$FENCE_REPORT" <<'PY'
import json
import sys

candidates = json.loads(sys.argv[1])
scripts = [candidate["script"] for candidate in candidates]
print(0 if scripts[:4] == ["outside-section\n", "canonical\n", "crlf\n", "wider-opener\n"] else 1)
PY
)"
assert 'scanner ignores Migration-looking fences enclosed by wider backtick and tilde fences' \
  "$(python3 - "$FENCE_REPORT" <<'PY'
import json
import sys

candidates = json.loads(sys.argv[1])
scripts = "".join(candidate["script"] for candidate in candidates)
print(0 if "inside-backticks" not in scripts and "inside-tildes" not in scripts else 1)
PY
)"
assert 'scanner reports source spans, Migration membership, and an unterminated candidate without treating it as runnable' \
  "$(python3 - "$FENCE_REPORT" <<'PY'
import json
import sys

candidates = json.loads(sys.argv[1])
last = candidates[-1]
print(0 if not candidates[0]["in_migration_section"]
      and all(candidate["in_migration_section"] for candidate in candidates[1:])
      and all(candidate["span"][0] < candidate["span"][1] for candidate in candidates)
      and last["script"] == "unterminated\n" and not last["closed"] else 1)
PY
)"

# Source the parser helpers without invoking the migration runner.
# shellcheck disable=SC1090
source <(sed '/# ─── Main/,$d' "$MIGRATE_SRC")

CHANGELOG="$TMP_ROOT/CHANGELOG.md"
cat > "$CHANGELOG" <<'EOF'
# Changelog

## [2.0.0]

## Migration

```bash migration
# Preserve this shell comment while parsing the fence.
printf '2.0-first\n'
```

### Migration

```bash migration
printf '2.0-second\n'
```

## [1.10.0]

## Migration

```bash migration
printf 'shared\n'
```

```bash migration
printf '1.10-second\n'
```

## [1.9.0]

### Migration

```bash migration
printf '1.9-first\n'
```

## Migration

```bash migration
printf 'shared\n'
```
EOF

BLOCKS=$(extract_migration_blocks '1.0.0' '2.0.0')
EXPECTED=$'---MIGRATION-BLOCK--- version=1.9.0\nprintf \'1.9-first\\n\'\n---MIGRATION-BLOCK--- version=1.9.0\nprintf \'shared\\n\'\n---MIGRATION-BLOCK--- version=1.10.0\nprintf \'shared\\n\'\n---MIGRATION-BLOCK--- version=1.10.0\nprintf \'1.10-second\\n\'\n---MIGRATION-BLOCK--- version=2.0.0\n# Preserve this shell comment while parsing the fence.\nprintf \'2.0-first\\n\'\n---MIGRATION-BLOCK--- version=2.0.0\nprintf \'2.0-second\\n\''
assert 'three releases are emitted in ascending semantic order and preserve every within-release fence position' \
  "$([ "$BLOCKS" = "$EXPECTED" ] && echo 0 || echo 1)"

SHARED_BODY=$'printf \'shared\\n\'\n'
SHARED_19_IDENTITY=$(block_identity '1.9.0' "$SHARED_BODY")
SHARED_110_IDENTITY=$(block_identity '1.10.0' "$SHARED_BODY")
assert 'identical bodies from different releases retain distinct release-labelled identities' \
  "$([ "$SHARED_19_IDENTITY" != "$SHARED_110_IDENTITY" ] \
    && [[ "$BLOCKS" == *'version=1.9.0'* ]] \
    && [[ "$BLOCKS" == *'version=1.10.0'* ]] && echo 0 || echo 1)"

printf 'Summary: %s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
