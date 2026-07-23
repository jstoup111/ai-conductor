#!/usr/bin/env bash
# Link-integrity check: resolves every relative Markdown link and intra-repo
# anchor across README.md + docs/*.md and fails on any broken target.
#
# Usage:
#   test/docs-link-check.sh              # check the real repo docs
#   test/docs-link-check.sh <root-dir>   # check docs under an arbitrary root (for fixtures)
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT" || { echo "docs-link-check: cannot cd to root: $ROOT" >&2; exit 2; }

# Collect target files: README.md + docs/**/*.md
mapfile -t FILES < <(
  { [ -f README.md ] && echo "README.md"; find docs -type f -name '*.md' 2>/dev/null; } | sort -u
)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "docs-link-check: no markdown files found under $ROOT" >&2
  exit 2
fi

# Build a slug from a heading line's text (GitHub-flavored heading anchor rules).
slugify() {
  local text="$1"
  text="${text#"${text%%[![:space:]]*}"}"   # trim leading whitespace
  text="$(printf '%s' "$text" | tr '[:upper:]' '[:lower:]')"
  # strip markdown emphasis/backtick/link markers
  text="$(printf '%s' "$text" | sed -E 's/[`*_]//g')"
  # remove characters that aren't alnum, space, or hyphen
  text="$(printf '%s' "$text" | sed -E 's/[^a-z0-9 -]//g')"
  # replace each space with a hyphen (GitHub does not collapse runs of spaces,
  # so removed punctuation between words can yield double hyphens)
  text="$(printf '%s' "$text" | sed -E 's/ /-/g')"
  printf '%s' "$text"
}

# Extract all heading-derived slugs for a given file, one per line (dedup with -N suffix
# for repeats, matching GitHub's behavior).
anchors_for_file() {
  local file="$1"
  [ -f "$file" ] || return 0
  awk '/^#+[[:space:]]/{ sub(/^#+[[:space:]]*/, ""); print }' "$file" | while IFS= read -r heading; do
    printf '%s\n' "$(slugify "$heading")"
  done
}

FAIL=0
CHECKED=0

for file in "${FILES[@]}"; do
  [ -f "$file" ] || continue
  filedir="$(dirname "$file")"
  linenum=0
  while IFS= read -r line; do
    linenum=$((linenum + 1))
    # Extract all markdown links [text](target) on this line.
    while [[ "$line" =~ \[[^\]]*\]\(([^\)[:space:]]+)\) ]]; do
      target="${BASH_REMATCH[1]}"
      # consume up to and including this match to find subsequent links on same line
      line="${line#*"${BASH_REMATCH[0]}"}"

      # Skip external links and mailto/absolute URLs.
      case "$target" in
        http://*|https://*|mailto:*) continue ;;
      esac

      CHECKED=$((CHECKED + 1))

      # Split target into path part and anchor part.
      path_part="${target%%#*}"
      anchor_part=""
      if [[ "$target" == *"#"* ]]; then
        anchor_part="${target#*#}"
      fi

      if [ -z "$path_part" ]; then
        # Same-file anchor, e.g. "#some-heading"
        resolved="$file"
      else
        resolved="$filedir/$path_part"
        # Normalize path (resolve ../ etc.) if possible.
        if command -v realpath >/dev/null 2>&1; then
          norm="$(realpath -m --relative-to="$ROOT" "$resolved" 2>/dev/null)"
          [ -n "$norm" ] && resolved="$norm"
        fi
        if [ ! -f "$resolved" ]; then
          echo "BROKEN LINK: $file:$linenum -> $target (missing file: $resolved)"
          FAIL=1
          continue
        fi
      fi

      if [ -n "$anchor_part" ]; then
        found=0
        while IFS= read -r slug; do
          if [ "$slug" = "$anchor_part" ]; then
            found=1
            break
          fi
        done < <(anchors_for_file "$resolved")
        if [ "$found" -eq 0 ]; then
          echo "BROKEN ANCHOR: $file:$linenum -> $target (no heading '#$anchor_part' in $resolved)"
          FAIL=1
        fi
      fi
    done
  done < "$file"
done

echo "docs-link-check: checked $CHECKED link(s) across ${#FILES[@]} file(s)"

if [ "$FAIL" -ne 0 ]; then
  echo "docs-link-check: FAIL — broken links/anchors found above"
  exit 1
fi

echo "docs-link-check: PASS — no broken links or anchors"
exit 0
