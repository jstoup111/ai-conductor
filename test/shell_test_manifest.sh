#!/usr/bin/env bash
# Shared parser and invocation predicate for test/shell_tests.manifest.

shell_test_manifest_entries() {
  local manifest=$1
  local line name class reason parent

  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue

    name=''
    class=''
    reason=''
    read -r name class reason <<< "$line"
    parent=''
    if [[ "$class" == invoked-by:* ]]; then
      parent=${class#invoked-by:}
    fi
    printf '%s\t%s\t%s\t%s\n' "$name" "$class" "$parent" "$reason"
  done < "$manifest"
}

shell_test_parent_invokes_child() {
  local parent=$1
  local child=$2

  awk -v child="$child" '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (line ~ /^#/) next

      offset = 1
      while ((position = index(substr(line, offset), child)) != 0) {
        position += offset - 1
        before = position == 1 ? "" : substr(line, position - 1, 1)
        after = substr(line, position + length(child), 1)
        if (before !~ /[A-Za-z0-9_.-]/ && after !~ /[A-Za-z0-9_.-]/) {
          matched = 1
          exit
        }
        offset = position + length(child)
      }
    }
    END { exit matched ? 0 : 1 }
  ' "$parent"
}
