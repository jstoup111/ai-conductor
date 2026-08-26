#!/usr/bin/env bash
set -uo pipefail

# Offline contract checker for the documentation site's navigation source.
# Each invocation validates the tree rooted at its sole argument, so fixture
# tests never need the repository checkout or any network access.

if [ "$#" -ne 1 ]; then
  printf 'usage: %s <repository-root>\n' "${0##*/}" >&2
  exit 2
fi

ROOT=$1
CONFIG_PATH="$ROOT/docs/_config.yml"
CONFIG_DISPLAY_PATH='docs/_config.yml'
EXPECTED_REMOTE_THEME='just-the-docs/just-the-docs@v0.12.0'
LANDING_PATH="$ROOT/docs/index.md"
LANDING_DISPLAY_PATH='docs/index.md'

if [ ! -f "$CONFIG_PATH" ]; then
  printf '%s: remote_theme requires site configuration\n' "$CONFIG_DISPLAY_PATH" >&2
  exit 1
fi

if ! grep -Fxq "remote_theme: $EXPECTED_REMOTE_THEME" "$CONFIG_PATH"; then
  printf '%s: remote_theme must equal %s\n' "$CONFIG_DISPLAY_PATH" "$EXPECTED_REMOTE_THEME" >&2
  exit 1
fi

if [ ! -f "$LANDING_PATH" ]; then
  printf '%s: required landing page is missing\n' "$LANDING_DISPLAY_PATH" >&2
  exit 1
fi

require_landing_destination() {
  local label=$1
  local target=$2
  local destination=$3
  local destination_path="$ROOT/docs/$destination"

  if ! grep -Fxq -- "- [$label]($target)" "$LANDING_PATH"; then
    printf '%s: %s must link to %s\n' \
      "$LANDING_DISPLAY_PATH" "$label" "docs/$destination" >&2
    return 1
  fi

  if [ ! -f "$destination_path" ]; then
    printf '%s: required landing destination is missing\n' "docs/$destination" >&2
    return 1
  fi
}

require_landing_destination 'Quickstart' 'quickstart.md' 'quickstart.md' || exit 1
require_landing_destination 'Guides' 'guides/' 'guides/index.md' || exit 1
require_landing_destination 'Reference' 'reference/' 'reference/index.md' || exit 1
require_landing_destination 'Explanation' 'explanation/' 'explanation/index.md' || exit 1
require_landing_destination 'Runbooks' 'runbooks/' 'runbooks/index.md' || exit 1
require_landing_destination 'Contributing' 'contributing/' 'contributing/index.md' || exit 1

navigation_records=$(mktemp "${TMPDIR:-/tmp}/docs-navigation.XXXXXX")
trap 'rm -f "$navigation_records"' EXIT

fail_navigation() {
  local relative_path=$1
  local message=$2

  printf '%s: %s\n' "$relative_path" "$message" >&2
  exit 1
}

trim_yaml_value() {
  local value=$1

  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

while IFS= read -r -d '' markdown_path; do
  relative_path=${markdown_path#"$ROOT/"}
  first_line=''
  title=''
  parent=''
  nav_order=''
  front_matter_closed=0

  IFS= read -r first_line < "$markdown_path" || true
  if [ "$first_line" != '---' ]; then
    fail_navigation "$relative_path" 'published Markdown requires leading YAML front matter'
  fi

  while IFS= read -r front_matter_line || [ -n "$front_matter_line" ]; do
    if [ "$front_matter_line" = '---' ]; then
      front_matter_closed=1
      break
    fi

    case "$front_matter_line" in
      title:*) title="$(trim_yaml_value "${front_matter_line#title:}")" ;;
      parent:*) parent="$(trim_yaml_value "${front_matter_line#parent:}")" ;;
      nav_order:*) nav_order="$(trim_yaml_value "${front_matter_line#nav_order:}")" ;;
    esac
  done < <(tail -n +2 "$markdown_path")

  if [ "$front_matter_closed" -ne 1 ]; then
    fail_navigation "$relative_path" 'published Markdown has unclosed YAML front matter'
  fi

  if [ -z "$title" ]; then
    fail_navigation "$relative_path" 'published Markdown requires a non-empty title'
  fi

  if [ -z "$nav_order" ]; then
    fail_navigation "$relative_path" 'published Markdown requires a non-empty nav_order'
  fi

  topic_path=${relative_path#docs/}
  if [[ "$topic_path" == */* && ! "$topic_path" =~ ^[^/]+/index\.md$ && -z "$parent" ]]; then
    fail_navigation "$relative_path" 'nested topic requires a parent'
  fi
  if [ -z "$parent" ] && [[ "$topic_path" != 'index.md' && "$topic_path" != 'quickstart.md' && ! "$topic_path" =~ ^[^/]+/index\.md$ ]]; then
    fail_navigation "$relative_path" 'topic has no navigation membership'
  fi

  printf '%s\t%s\t%s\n' "$relative_path" "$title" "$parent" \
    >> "$navigation_records"
done < <(find "$ROOT/docs" -type f -name '*.md' -print0 | sort -z)

awk -F '\t' '
  function fail_navigation(path, message) {
    printf "%s: %s\n", path, message > "/dev/stderr"
    exit 1
  }

  BEGIN {
    landing_roots["docs/index.md"] = 1
    landing_roots["docs/quickstart.md"] = 1
    landing_roots["docs/guides/index.md"] = 1
    landing_roots["docs/reference/index.md"] = 1
    landing_roots["docs/explanation/index.md"] = 1
    landing_roots["docs/runbooks/index.md"] = 1
    landing_roots["docs/contributing/index.md"] = 1
  }

  {
    path = $1
    title = $2
    parent = $3
    title_by_path[path] = title
    parent_by_path[path] = parent
    title_count[title]++
    title_path[title] = path
    sibling_key = parent SUBSEP title
    sibling_count[sibling_key]++
    sibling_paths[sibling_key] = sibling_paths[sibling_key] path "\n"
  }

  END {
    for (sibling_key in sibling_count) {
      if (sibling_count[sibling_key] != 1) {
        paths = sibling_paths[sibling_key]
        sub(/\n$/, "", paths)
        fail_navigation(paths, "duplicate title under one parent")
      }
    }

    for (path in title_by_path) {
      parent = parent_by_path[path]
      if (parent == "") continue
      if (title_count[parent] == 0) {
        fail_navigation(path, "parent \047" parent "\047 does not name a published topic")
      }
      if (title_count[parent] != 1) {
        fail_navigation(path, "parent \047" parent "\047 is ambiguous")
      }
    }

    for (path in title_by_path) {
      for (visited_path in visited) delete visited[visited_path]
      current_path = path

      while (1) {
        if (current_path in visited) {
          fail_navigation(current_path, "navigation parent graph contains a cycle")
        }
        visited[current_path] = 1

        parent = parent_by_path[current_path]
        if (parent == "") {
          if (!(current_path in landing_roots)) {
            fail_navigation(current_path, "top-level topic is not a landing navigation destination")
          }
          break
        }

        current_path = title_path[parent]
      }
    }
  }
' "$navigation_records" || exit 1
