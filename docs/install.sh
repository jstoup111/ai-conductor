#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: install.sh [--channel stable|tagged|main] [--providers claude,codex]

Options:
  --channel VALUE       Install from stable, tagged, or main.
  --providers VALUE     Configure claude, codex, or both comma-separated.
  -h, --help            Show this help.
EOF
}

fail() {
  printf '%s\n' "error: $*" >&2
  exit 1
}

validate_channel() {
  case "$1" in
    stable|tagged|main) ;;
    *) fail "unsupported channel '$1'; expected stable, tagged, main" ;;
  esac
}

validate_providers() {
  providers=$1
  case "$providers" in
    ''|,*|*,) fail "unsupported provider '$providers'; expected claude, codex" ;;
  esac
  while [ -n "$providers" ]; do
    case "$providers" in
      *,*) provider=${providers%%,*}; providers=${providers#*,} ;;
      *) provider=$providers; providers='' ;;
    esac
    case "$provider" in
      claude|codex) ;;
      *) fail "unsupported provider '$provider'; expected claude, codex" ;;
    esac
  done
}

parse_args() {
  CHANNEL_OPTION=''
  PROVIDERS_OPTION=''
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -h|--help)
        usage
        exit 0
        ;;
      --channel)
        [ "$#" -ge 2 ] || fail 'missing value for --channel'
        CHANNEL_OPTION=$2
        validate_channel "$CHANNEL_OPTION"
        shift 2
        ;;
      --channel=*)
        CHANNEL_OPTION=${1#--channel=}
        validate_channel "$CHANNEL_OPTION"
        shift
        ;;
      --providers)
        [ "$#" -ge 2 ] || fail 'missing value for --providers'
        PROVIDERS_OPTION=$2
        validate_providers "$PROVIDERS_OPTION"
        shift 2
        ;;
      --providers=*)
        PROVIDERS_OPTION=${1#--providers=}
        validate_providers "$PROVIDERS_OPTION"
        shift
        ;;
      *) fail "unknown option '$1'" ;;
    esac
  done
}

check_prerequisites() {
  missing=''
  for tool in git gh node npm tmux python3; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      missing="${missing}${missing:+ }${tool}"
    fi
  done
  if command -v python3 >/dev/null 2>&1 && ! python3 -c 'import yaml' >/dev/null 2>&1; then
    missing="${missing}${missing:+ }PyYAML"
  fi
  [ -z "$missing" ] || fail "missing prerequisites: $missing"
}

resolve_ref() {
  if [ -n "$CHANNEL_OPTION" ]; then
    CHANNEL=$CHANNEL_OPTION
  elif [ -n "${AI_CONDUCTOR_CHANNEL+x}" ]; then
    CHANNEL=$AI_CONDUCTOR_CHANNEL
  else
    CHANNEL=stable
  fi

  case "$CHANNEL" in
    stable|main)
      REF=$CHANNEL
      ;;
    tagged)
      tags=$(git ls-remote --tags --refs "$REPO_URL") || fail "could not list release tags at $REPO_URL"
      REF=''
      latest_major=0
      latest_minor=0
      latest_patch=0
      while IFS='	' read -r _ tag_ref; do
        tag=${tag_ref#refs/tags/}
        case "$tag" in v*.*.*) ;; *) continue ;; esac
        old_ifs=$IFS
        IFS=.
        set -- ${tag#v}
        IFS=$old_ifs
        [ "$#" -eq 3 ] || continue
        case "$1:$2:$3" in *[!0-9:]*|'') continue ;; esac
        if [ -z "$REF" ] \
          || [ "$1" -gt "$latest_major" ] \
          || { [ "$1" -eq "$latest_major" ] && [ "$2" -gt "$latest_minor" ]; } \
          || { [ "$1" -eq "$latest_major" ] && [ "$2" -eq "$latest_minor" ] && [ "$3" -gt "$latest_patch" ]; }; then
          REF=$tag
          latest_major=$1
          latest_minor=$2
          latest_patch=$3
        fi
      done <<EOF
$tags
EOF
      [ -n "$REF" ] || fail "no vX.Y.Z release tag found at $REPO_URL"
      ;;
  esac
}

announce() {
  printf '%s\n' "Installing ai-conductor in $TARGET (channel $REF) from $REPO_URL"
}

acquire() {
  mkdir -p "${TARGET%/harness}"
  git clone --branch "$REF" "$REPO_URL" "$TARGET"
}

run_installer() {
  set --
  if [ -n "$CHANNEL_OPTION" ]; then
    set -- "$@" --channel "$CHANNEL_OPTION"
  fi
  if [ -n "$PROVIDERS_OPTION" ]; then
    set -- "$@" --providers "$PROVIDERS_OPTION"
  fi
  if (: </dev/tty) 2>/dev/null; then
    (cd "$TARGET" && ./bin/install "$@" </dev/tty)
  else
    (cd "$TARGET" && ./bin/install "$@")
  fi
}

main() {
  REPO_URL=${AI_CONDUCTOR_REPO_URL:-https://github.com/jstoup111/ai-conductor.git}
  TARGET="$HOME/.ai-conductor/harness"
  parse_args "$@"
  if [ -n "${AI_CONDUCTOR_CHANNEL+x}" ]; then
    validate_channel "$AI_CONDUCTOR_CHANNEL"
  fi
  check_prerequisites
  resolve_ref
  announce
  acquire
  run_installer
}

main "$@"
