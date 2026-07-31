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

declare -A TITLE_BY_PATH
declare -A PARENT_BY_PATH
declare -A TITLE_PATHS
declare -A SIBLING_PATHS
declare -A LANDING_ROOT_PATHS=(
  ['docs/index.md']=1
  ['docs/quickstart.md']=1
  ['docs/guides/index.md']=1
  ['docs/reference/index.md']=1
  ['docs/explanation/index.md']=1
  ['docs/runbooks/index.md']=1
  ['docs/contributing/index.md']=1
)

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

  sibling_key="$parent|$title"
  TITLE_BY_PATH["$relative_path"]=$title
  PARENT_BY_PATH["$relative_path"]=$parent
  SIBLING_PATHS["$sibling_key"]+="$relative_path"$'\n'
  TITLE_PATHS["$title"]+="$relative_path"$'\n'
done < <(find "$ROOT/docs" -type f -name '*.md' -print0 | sort -z)

for sibling_key in "${!SIBLING_PATHS[@]}"; do
  sibling_paths=${SIBLING_PATHS["$sibling_key"]}
  sibling_count=$(printf '%s' "$sibling_paths" | sed '/^$/d' | wc -l | tr -d '[:space:]')

  if [ "$sibling_count" -ne 1 ]; then
    fail_navigation "${sibling_paths%$'\n'}" 'duplicate title under one parent'
  fi
done

for relative_path in "${!TITLE_BY_PATH[@]}"; do
  parent=${PARENT_BY_PATH["$relative_path"]}
  [ -n "$parent" ] || continue

  parent_paths=${TITLE_PATHS["$parent"]-}
  parent_count=$(printf '%s' "$parent_paths" | sed '/^$/d' | wc -l | tr -d '[:space:]')

  if [ "$parent_count" -eq 0 ]; then
    fail_navigation "$relative_path" "parent '$parent' does not name a published topic"
  fi

  if [ "$parent_count" -ne 1 ]; then
    fail_navigation "$relative_path" "parent '$parent' is ambiguous"
  fi
done

for relative_path in "${!TITLE_BY_PATH[@]}"; do
  current_path=$relative_path
  declare -A visited_paths=()

  while :; do
    if [ -n "${visited_paths[$current_path]+set}" ]; then
      fail_navigation "$current_path" 'navigation parent graph contains a cycle'
    fi
    visited_paths["$current_path"]=1

    parent=${PARENT_BY_PATH["$current_path"]}
    if [ -z "$parent" ]; then
      if [ -z "${LANDING_ROOT_PATHS[$current_path]+set}" ]; then
        fail_navigation "$current_path" 'top-level topic is not a landing navigation destination'
      fi
      break
    fi

    current_path="$(printf '%s' "${TITLE_PATHS[$parent]}" | sed '/^$/d')"
  done
done
