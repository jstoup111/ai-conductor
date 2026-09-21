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

main() {
  parse_args "$@"
}

main "$@"
