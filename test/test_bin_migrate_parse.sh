#!/usr/bin/env bash
set -euo pipefail

# Parser-level contract for bin/migrate candidate ordering. This sources only
# the helper region; no installation, migration execution, or external service
# is involved.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MIGRATE_SRC="$REPO_ROOT/bin/migrate"

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

# Source the parser helpers without invoking the migration runner.
# shellcheck disable=SC1090
source <(sed '/# ─── Main/,$d' "$MIGRATE_SRC")

CHANGELOG="$TMP_ROOT/CHANGELOG.md"
cat > "$CHANGELOG" <<'EOF'
# Changelog

## [2.0.0]

## Migration

```bash migration
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
EXPECTED=$'---MIGRATION-BLOCK--- version=1.9.0\nprintf \'1.9-first\\n\'\n---MIGRATION-BLOCK--- version=1.9.0\nprintf \'shared\\n\'\n---MIGRATION-BLOCK--- version=1.10.0\nprintf \'shared\\n\'\n---MIGRATION-BLOCK--- version=1.10.0\nprintf \'1.10-second\\n\'\n---MIGRATION-BLOCK--- version=2.0.0\nprintf \'2.0-first\\n\'\n---MIGRATION-BLOCK--- version=2.0.0\nprintf \'2.0-second\\n\''
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
