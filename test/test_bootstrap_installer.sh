#!/usr/bin/env bash
set -euo pipefail

# Covers: task:1, task:2, task:3, task:4, task:5, task:6, task:7, task:8, task:9, task:10, task:11
# Exercises the public bootstrap entry point with only a local stand-in source.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HARNESS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALL_SCRIPT="$HARNESS_DIR/docs/install.sh"

TMP_ROOT=$(mktemp -d)
trap 'rm -rf "$TMP_ROOT"' EXIT

SOURCE_REPO="$TMP_ROOT/source"
RECORD="$TMP_ROOT/installer-record"
git init -q "$SOURCE_REPO"
git -C "$SOURCE_REPO" config user.email test@example.invalid
git -C "$SOURCE_REPO" config user.name test
mkdir -p "$SOURCE_REPO/bin"
cat > "$SOURCE_REPO/bin/install" <<'EOF'
#!/bin/sh
printf '%s|%s|%s|%s\n' "$PWD" "$0" "$*" "${AI_CONDUCTOR_CHANNEL-}" >> "$INSTALLER_RECORD"
exit "${INSTALLER_EXIT_CODE:-0}"
EOF
cat > "$SOURCE_REPO/bin/update" <<'EOF'
#!/bin/sh
printf '%s\n' "$PWD|$*|${AI_CONDUCTOR_CHANNEL-}" >> "${UPDATE_RECORD:-$INSTALLER_RECORD}"
printf '%s\n' 'installation is current'
[ -z "${UPDATE_MARKER-}" ] || : > "$UPDATE_MARKER"
if [ "${UPDATE_EXIT_CODE:-0}" -ne 0 ]; then
  printf '%s\n' "updater failed with ${UPDATE_EXIT_CODE}" >&2
fi
if [ -n "${UPDATE_STATE_RECORD-}" ]; then
  printf '%s\n%s\n' "$(git rev-parse HEAD)" "$(git status --porcelain)" > "$UPDATE_STATE_RECORD"
fi
exit "${UPDATE_EXIT_CODE:-0}"
EOF
chmod +x "$SOURCE_REPO/bin/install" "$SOURCE_REPO/bin/update"
git -C "$SOURCE_REPO" add bin
git -C "$SOURCE_REPO" commit -qm fixture
git -C "$SOURCE_REPO" branch -M stable
STABLE_HEAD=$(git -C "$SOURCE_REPO" rev-parse stable)
MAIN_HEAD=$(git -C "$SOURCE_REPO" commit-tree "$STABLE_HEAD^{tree}" -p "$STABLE_HEAD" -m main)
git -C "$SOURCE_REPO" update-ref refs/heads/main "$MAIN_HEAD"
git -C "$SOURCE_REPO" tag v0.1.0 "$STABLE_HEAD"
git -C "$SOURCE_REPO" tag v0.2.0 "$MAIN_HEAD"
git -C "$SOURCE_REPO" tag nightly "$MAIN_HEAD"

NO_SEMVER_REPO="$TMP_ROOT/no-semver-source"
git init -q "$NO_SEMVER_REPO"
git -C "$NO_SEMVER_REPO" config user.email test@example.invalid
git -C "$NO_SEMVER_REPO" config user.name test
printf 'nightly fixture\n' > "$NO_SEMVER_REPO/README"
git -C "$NO_SEMVER_REPO" add README
git -C "$NO_SEMVER_REPO" commit -qm nightly
git -C "$NO_SEMVER_REPO" tag nightly

PREREQUISITE_PATH="$TMP_ROOT/prerequisites"
mkdir -p "$PREREQUISITE_PATH"
cat > "$PREREQUISITE_PATH/present" <<'EOF'
#!/bin/sh
exit 0
EOF
cat > "$PREREQUISITE_PATH/python3" <<'EOF'
#!/bin/sh
if [ "${1-}" = '-c' ] && [ "${2-}" = 'import yaml' ]; then
  exit 0
fi
exit 1
EOF
chmod +x "$PREREQUISITE_PATH/present" "$PREREQUISITE_PATH/python3"
for tool in git gh node npm tmux; do
  ln -s present "$PREREQUISITE_PATH/$tool"
done

FRESH_INSTALL_PATH="$TMP_ROOT/prerequisites-fresh-install"
mkdir -p "$FRESH_INSTALL_PATH"
# The git stand-in snapshots the case's stdout the moment `git clone` starts so a
# case can prove what was announced before acquisition began (no timestamps).
cat > "$FRESH_INSTALL_PATH/git" <<EOF
#!/bin/sh
if [ -n "\${GIT_SUBCOMMAND_RECORD-}" ]; then
  printf '%s\n' "\$1" >> "\$GIT_SUBCOMMAND_RECORD"
fi
if [ "\$1" = clone ] && [ -n "\${CLONE_START_STDOUT-}" ]; then
  /bin/cat "\$CASE_STDOUT_PATH" > "\$CLONE_START_STDOUT"
fi
exec '$(command -v git)' "\$@"
EOF
chmod +x "$FRESH_INSTALL_PATH/git"
for tool in mkdir mv rm rmdir; do
  ln -s "$(command -v "$tool")" "$FRESH_INSTALL_PATH/$tool"
done
for tool in gh node npm tmux; do
  ln -s "$PREREQUISITE_PATH/present" "$FRESH_INSTALL_PATH/$tool"
done
ln -s "$PREREQUISITE_PATH/python3" "$FRESH_INSTALL_PATH/python3"

LOST_RACE_PATH="$TMP_ROOT/prerequisites-lost-race"
mkdir -p "$LOST_RACE_PATH"
cat > "$LOST_RACE_PATH/mkdir" <<'EOF'
#!/bin/sh
if [ "$1" = "${LOST_RACE_LOCK-}" ]; then
  : > "$LOST_RACE_READY"
  while [ -e "$LOST_RACE_LOCK" ]; do
    /bin/sleep 0.01
  done
fi
exec "$REAL_MKDIR" "$@"
EOF
chmod +x "$LOST_RACE_PATH/mkdir"
for tool in git mv rm rmdir; do
  ln -s "$(command -v "$tool")" "$LOST_RACE_PATH/$tool"
done
for tool in gh node npm tmux; do
  ln -s "$PREREQUISITE_PATH/present" "$LOST_RACE_PATH/$tool"
done
ln -s "$PREREQUISITE_PATH/python3" "$LOST_RACE_PATH/python3"

INTERRUPTED_CLONE_PATH="$TMP_ROOT/prerequisites-interrupted-clone"
mkdir -p "$INTERRUPTED_CLONE_PATH"
cat > "$INTERRUPTED_CLONE_PATH/git" <<'EOF'
#!/bin/sh
if [ "$1" = clone ]; then
  for target; do :; done
  /bin/mkdir -p "$target"
  printf '%s\n' interrupted > "$target/interrupted"
  printf '%s\n' "interrupted clone from $AI_CONDUCTOR_REPO_URL" >&2
  exit 1
fi
exec "$REAL_GIT" "$@"
EOF
chmod +x "$INTERRUPTED_CLONE_PATH/git"
for tool in mkdir mv rm rmdir; do
  ln -s "$(command -v "$tool")" "$INTERRUPTED_CLONE_PATH/$tool"
done
for tool in gh node npm tmux; do
  ln -s "$PREREQUISITE_PATH/present" "$INTERRUPTED_CLONE_PATH/$tool"
done
ln -s "$PREREQUISITE_PATH/python3" "$INTERRUPTED_CLONE_PATH/python3"

MISSING_TOOLS_PATH="$TMP_ROOT/prerequisites-missing-tools"
mkdir -p "$MISSING_TOOLS_PATH"
for tool in git node npm; do
  ln -s "$PREREQUISITE_PATH/present" "$MISSING_TOOLS_PATH/$tool"
done
ln -s "$PREREQUISITE_PATH/python3" "$MISSING_TOOLS_PATH/python3"

PYTHON_FAILURE_PATH="$TMP_ROOT/prerequisites-no-yaml"
mkdir -p "$PYTHON_FAILURE_PATH"
for tool in git gh node npm tmux; do
  ln -s "$PREREQUISITE_PATH/present" "$PYTHON_FAILURE_PATH/$tool"
done
cat > "$PYTHON_FAILURE_PATH/python3" <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x "$PYTHON_FAILURE_PATH/python3"

failures=''

run_case() {
  local name=$1
  shift
  local case_home=${CASE_HOME_OVERRIDE:-"$TMP_ROOT/home-$name"}
  local case_stdout="$TMP_ROOT/$name.stdout"
  local case_stderr="$TMP_ROOT/$name.stderr"
  local clone_start_stdout="$TMP_ROOT/$name.clone-start-stdout"
  mkdir -p "$case_home"
  : > "$RECORD"
  rm -f "$clone_start_stdout"

  set +e
  local channel_env=()
  if [ "${CASE_CHANNEL_SET-}" = true ]; then
    channel_env=("AI_CONDUCTOR_CHANNEL=$CASE_CHANNEL")
  fi
  env -u SSH_AUTH_SOCK -u SSH_ASKPASS -u GIT_ASKPASS -u GIT_CREDENTIAL_HELPER -u AI_CONDUCTOR_CHANNEL \
    "${channel_env[@]}" HOME="$case_home" PATH="${CASE_PATH-$PATH}" REAL_GIT="$(command -v git)" AI_CONDUCTOR_REPO_URL="${CASE_REPO_URL-$SOURCE_REPO}" INSTALLER_RECORD="$RECORD" INSTALLER_EXIT_CODE="${INSTALLER_EXIT_CODE-0}" CASE_STDOUT_PATH="$case_stdout" CLONE_START_STDOUT="$clone_start_stdout" /bin/sh -s -- "$@" < "$INSTALL_SCRIPT" > "$case_stdout" 2> "$case_stderr"
  CASE_STATUS=$?
  set -e
  CASE_STDOUT=$(< "$case_stdout")
  CASE_STDERR=$(< "$case_stderr")
  CASE_OUTPUT="$CASE_STDOUT$CASE_STDERR"
  CASE_HOME=$case_home
  # Stdout as it stood when the first `git clone` began (fresh-install PATH only).
  CASE_CLONE_START_STDOUT=''
  [ ! -e "$clone_start_stdout" ] || CASE_CLONE_START_STDOUT=$(< "$clone_start_stdout")
}

assert_untouched() {
  local name=$1
  if [ -e "$CASE_HOME/.ai-conductor/harness" ] || [ -s "$RECORD" ]; then
    failures+="$name touched the target or reached the stand-in installer\n"
  fi
}

assert_acquisition_clean() {
  local name=$1
  local parent="$CASE_HOME/.ai-conductor"
  if [ -e "$parent/harness" ] \
    || { [ -d "$parent" ] && find "$parent" -maxdepth 1 -name 'harness.partial.*' -print -quit | grep -q .; } \
    || [ -s "$RECORD" ]; then
    failures+="$name left an installation or partial acquisition behind\\n"
  fi
}

run_truncated_case() {
  local name=$1
  local byte_count=$2
  local case_home="$TMP_ROOT/home-truncated-$name"
  local case_stdout="$TMP_ROOT/truncated-$name.stdout"
  local case_stderr="$TMP_ROOT/truncated-$name.stderr"
  mkdir -p "$case_home"
  : > "$RECORD"

  set +e
  head -c "$byte_count" "$INSTALL_SCRIPT" | env -u SSH_AUTH_SOCK -u SSH_ASKPASS -u GIT_ASKPASS -u GIT_CREDENTIAL_HELPER \
    HOME="$case_home" PATH="$FRESH_INSTALL_PATH" AI_CONDUCTOR_REPO_URL="$SOURCE_REPO" INSTALLER_RECORD="$RECORD" /bin/sh -s \
    > "$case_stdout" 2> "$case_stderr"
  CASE_STATUS=$?
  set -e
  CASE_HOME=$case_home
}

script_length=$(wc -c < "$INSTALL_SCRIPT" | tr -d ' ')
for truncation in \
  "quarter:$((script_length / 4))" \
  "half:$((script_length / 2))" \
  "three-quarters:$((script_length * 3 / 4))" \
  "two-bytes-short:$((script_length - 2))"; do
  truncation_name=${truncation%%:*}
  truncation_bytes=${truncation#*:}
  run_truncated_case "$truncation_name" "$truncation_bytes"
  if [ ! -e "$CASE_HOME/.ai-conductor/harness" ] && [ ! -s "$RECORD" ]; then
    echo "PASS truncated $truncation_name bootstrap does not acquire or install"
  else
    failures+="truncated $truncation_name bootstrap touched the target or reached the stand-in installer\\n"
  fi
done

run_case help --help
if [ "$CASE_STATUS" -eq 0 ] \
  && grep -Fq -- '--channel' <<< "$CASE_OUTPUT" \
  && grep -Fq -- '--providers' <<< "$CASE_OUTPUT"; then
  echo 'PASS help prints bootstrap options without acquiring'
else
  failures+="help did not exit 0 with both option names: $CASE_OUTPUT\n"
fi
assert_untouched help

run_case short-help -h
if [ "$CASE_STATUS" -eq 0 ] && grep -Fq -- '--channel' <<< "$CASE_OUTPUT"; then
  echo 'PASS short help prints usage without acquiring'
else
  failures+="short help did not exit 0 with usage: $CASE_OUTPUT\n"
fi
assert_untouched short-help

CASE_PATH="$FRESH_INSTALL_PATH" run_case accepted-equals --channel=stable --providers=claude,codex
if [ "$CASE_STATUS" -eq 0 ] && [ -d "$CASE_HOME/.ai-conductor/harness/.git" ]; then
  echo 'PASS equals-form options accept supported values and continue to acquisition'
else
  failures+="supported equals-form options were rejected: $CASE_OUTPUT\n"
fi

run_case unknown --not-an-option
if [ "$CASE_STATUS" -ne 0 ] && grep -Fq -- '--not-an-option' <<< "$CASE_OUTPUT"; then
  echo 'PASS unknown option is rejected before acquiring'
else
  failures+="unknown option was not rejected by name: $CASE_OUTPUT\n"
fi
assert_untouched unknown

run_case invalid-channel --channel beta
if [ "$CASE_STATUS" -ne 0 ] \
  && grep -Fq 'beta' <<< "$CASE_OUTPUT" \
  && grep -Fq 'stable, tagged, main' <<< "$CASE_OUTPUT"; then
  echo 'PASS invalid channel is rejected before acquiring'
else
  failures+="invalid channel was not rejected with accepted values: $CASE_OUTPUT\n"
fi
assert_untouched invalid-channel

run_case invalid-providers --providers gemini
if [ "$CASE_STATUS" -ne 0 ] \
  && grep -Fq 'gemini' <<< "$CASE_OUTPUT" \
  && grep -Fq 'claude, codex' <<< "$CASE_OUTPUT"; then
  echo 'PASS invalid provider is rejected before acquiring'
else
  failures+="invalid provider was not rejected with accepted values: $CASE_OUTPUT\n"
fi
assert_untouched invalid-providers

CASE_PATH="$PREREQUISITE_PATH" run_case prerequisites-present
if [ "$CASE_STATUS" -ne 0 ] && ! grep -Fq 'missing prerequisites' <<< "$CASE_OUTPUT"; then
  echo 'PASS present prerequisites pass before the fake git hand-off failure'
else
  failures+="present prerequisites did not continue past the prerequisite check: $CASE_OUTPUT\\n"
fi

CASE_PATH="$MISSING_TOOLS_PATH" run_case missing-tools
if [ "$CASE_STATUS" -ne 0 ] \
  && [ "$(grep -c '^error:' <<< "$CASE_STDERR" || true)" -eq 1 ] \
  && grep -Eq '^error:.*tmux.*gh|^error:.*gh.*tmux' <<< "$CASE_STDERR"; then
  echo 'PASS all missing prerequisites are named in one message'
else
  failures+="missing tools were not named in one error message: $CASE_STDERR\\n"
fi
assert_untouched missing-tools

CASE_PATH="$PYTHON_FAILURE_PATH" run_case missing-pyyaml
if [ "$CASE_STATUS" -ne 0 ] && grep -Fq 'PyYAML' <<< "$CASE_OUTPUT"; then
  echo 'PASS missing PyYAML is reported'
else
  failures+="missing PyYAML was not reported: $CASE_OUTPUT\\n"
fi
assert_untouched missing-pyyaml

MISSING_SOURCE="$TMP_ROOT/missing-source"
CASE_REPO_URL="$MISSING_SOURCE" CASE_PATH="$FRESH_INSTALL_PATH" run_case missing-source
if [ "$CASE_STATUS" -ne 0 ] \
  && grep -Fqx "error: could not acquire ai-conductor from $MISSING_SOURCE" <<< "$CASE_STDERR"; then
  echo 'PASS unreachable source fails by name'
else
  failures+="unreachable source did not fail naming its URL: $CASE_OUTPUT\\n"
fi
assert_acquisition_clean missing-source

CASE_PATH="$INTERRUPTED_CLONE_PATH" run_case interrupted-clone
if [ "$CASE_STATUS" -ne 0 ] \
  && grep -Fqx "error: could not acquire ai-conductor from $SOURCE_REPO" <<< "$CASE_STDERR"; then
  echo 'PASS interrupted clone exits non-zero naming its URL'
else
  failures+="interrupted clone did not fail naming its URL: $CASE_OUTPUT\\n"
fi
assert_acquisition_clean interrupted-clone

FAILED_HOME=$CASE_HOME
CASE_HOME_OVERRIDE="$FAILED_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case retry-after-acquisition-failure
if [ "$CASE_STATUS" -eq 0 ] && [ -d "$FAILED_HOME/.ai-conductor/harness/.git" ]; then
  echo 'PASS retry after acquisition failure installs afresh'
else
  failures+="retry after acquisition failure did not install cleanly: $CASE_OUTPUT\\n"
fi

CASE_PATH="$FRESH_INSTALL_PATH" run_case fresh-install
FRESH_TARGET="$CASE_HOME/.ai-conductor/harness"
if [ "$CASE_STATUS" -eq 0 ] \
  && [ -d "$FRESH_TARGET/.git" ] \
  && grep -Fq "Installing ai-conductor in $FRESH_TARGET" <<< "$CASE_CLONE_START_STDOUT" \
  && grep -Fq 'channel stable' <<< "$CASE_CLONE_START_STDOUT" \
  && [ "$(head -n 1 <<< "$CASE_STDOUT")" = "$(head -n 1 <<< "$CASE_CLONE_START_STDOUT")" ] \
  && grep -Fq "$FRESH_TARGET|./bin/install||" "$RECORD"; then
  echo 'PASS fresh bootstrap announces before the first clone and runs the installer from the harness'
else
  failures+="fresh install did not announce before cloning and hand off: $CASE_OUTPUT\\nstdout at clone start: $CASE_CLONE_START_STDOUT\\nrecord: $(< "$RECORD")\\n"
fi

INSTALLER_EXIT_CODE=23 CASE_PATH="$FRESH_INSTALL_PATH" run_case installer-status
if [ "$CASE_STATUS" -eq 23 ] && [ -d "$CASE_HOME/.ai-conductor/harness/.git" ]; then
  echo 'PASS bootstrap mirrors the installer exit status'
else
  failures+="installer status was not mirrored: exit $CASE_STATUS; $CASE_OUTPUT\\n"
fi

CASE_PATH="$FRESH_INSTALL_PATH" run_case default-channel
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(git -C "$CASE_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$STABLE_HEAD" ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install||" ]; then
  echo 'PASS default channel acquires stable without forwarding a channel'
else
  failures+="default channel did not acquire stable without a channel argument: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

CASE_PATH="$FRESH_INSTALL_PATH" run_case option-stable --channel stable
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(git -C "$CASE_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$STABLE_HEAD" ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install|--channel stable|" ]; then
  echo 'PASS stable option selects stable and reaches the installer'
else
  failures+="stable option did not select stable: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

CASE_CHANNEL_SET=true CASE_CHANNEL=stable CASE_PATH="$FRESH_INSTALL_PATH" run_case environment-stable
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(git -C "$CASE_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$STABLE_HEAD" ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install||stable" ]; then
  echo 'PASS stable environment selects stable and reaches the installer'
else
  failures+="stable environment did not select stable: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

CASE_PATH="$FRESH_INSTALL_PATH" run_case option-main --channel main
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(git -C "$CASE_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$MAIN_HEAD" ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install|--channel main|" ]; then
  echo 'PASS main option selects main and reaches the installer'
else
  failures+="main option did not select main: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

CASE_CHANNEL_SET=true CASE_CHANNEL=main CASE_PATH="$FRESH_INSTALL_PATH" run_case environment-main
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(git -C "$CASE_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$MAIN_HEAD" ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install||main" ]; then
  echo 'PASS main environment selects main and reaches the installer'
else
  failures+="main environment did not select main: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

CASE_PATH="$FRESH_INSTALL_PATH" run_case option-tagged --channel tagged
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(git -C "$CASE_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$MAIN_HEAD" ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install|--channel tagged|" ]; then
  echo 'PASS tagged option selects the latest release tag and reaches the installer'
else
  failures+="tagged option did not select the latest release tag: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

CASE_CHANNEL_SET=true CASE_CHANNEL=tagged CASE_PATH="$FRESH_INSTALL_PATH" run_case environment-tagged
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(git -C "$CASE_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$MAIN_HEAD" ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install||tagged" ]; then
  echo 'PASS tagged environment selects the latest release tag and reaches the installer'
else
  failures+="tagged environment did not select the latest release tag: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

CASE_REPO_URL="$NO_SEMVER_REPO" CASE_PATH="$FRESH_INSTALL_PATH" run_case tagged-without-semver --channel tagged
if [ "$CASE_STATUS" -ne 0 ] \
  && grep -Fqx "error: no vX.Y.Z release tag found at $NO_SEMVER_REPO" <<< "$CASE_STDERR"; then
  echo 'PASS tagged channel without a semver release tag refuses before acquisition'
else
  failures+="tagged channel without a semver release tag did not fail cleanly: $CASE_OUTPUT\\n"
fi
assert_untouched tagged-without-semver

CASE_CHANNEL_SET=true CASE_CHANNEL=main CASE_PATH="$FRESH_INSTALL_PATH" run_case option-precedence --channel stable
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(git -C "$CASE_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$STABLE_HEAD" ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install|--channel stable|main" ]; then
  echo 'PASS channel option overrides the environment channel'
else
  failures+="channel option did not override the environment: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

CASE_PATH="$FRESH_INSTALL_PATH" run_case providers-forwarded --providers claude,codex
if [ "$CASE_STATUS" -eq 0 ] \
  && [ "$(< "$RECORD")" = "$CASE_HOME/.ai-conductor/harness|./bin/install|--providers claude,codex|" ]; then
  echo 'PASS providers option reaches the installer verbatim'
else
  failures+="providers option did not reach the installer verbatim: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\n"
fi

BOOTSTRAP_HOME="$TMP_ROOT/home-bootstrap-parity"
MANUAL_HOME="$TMP_ROOT/home-manual-parity"
BOOTSTRAP_RECORD="$TMP_ROOT/bootstrap-parity-record"
MANUAL_RECORD="$TMP_ROOT/manual-parity-record"
mkdir -p "$BOOTSTRAP_HOME" "$MANUAL_HOME"
: > "$BOOTSTRAP_RECORD"
: > "$MANUAL_RECORD"
set +e
env -u SSH_AUTH_SOCK -u SSH_ASKPASS -u GIT_ASKPASS -u GIT_CREDENTIAL_HELPER \
  HOME="$BOOTSTRAP_HOME" PATH="$FRESH_INSTALL_PATH" AI_CONDUCTOR_REPO_URL="$SOURCE_REPO" INSTALLER_RECORD="$BOOTSTRAP_RECORD" \
  /bin/sh -s -- < "$INSTALL_SCRIPT" > "$TMP_ROOT/bootstrap-parity.stdout" 2> "$TMP_ROOT/bootstrap-parity.stderr"
BOOTSTRAP_STATUS=$?
env -u SSH_AUTH_SOCK -u SSH_ASKPASS -u GIT_ASKPASS -u GIT_CREDENTIAL_HELPER \
  HOME="$MANUAL_HOME" PATH="$FRESH_INSTALL_PATH" INSTALLER_RECORD="$MANUAL_RECORD" \
  git clone --branch stable "$SOURCE_REPO" "$MANUAL_HOME/.ai-conductor/harness" > "$TMP_ROOT/manual-parity.stdout" 2> "$TMP_ROOT/manual-parity.stderr"
MANUAL_CLONE_STATUS=$?
if [ "$MANUAL_CLONE_STATUS" -eq 0 ]; then
  (
    cd "$MANUAL_HOME/.ai-conductor/harness"
    INSTALLER_RECORD="$MANUAL_RECORD" ./bin/install
  )
  MANUAL_INSTALL_STATUS=$?
else
  MANUAL_INSTALL_STATUS=1
fi
set -e
BOOTSTRAP_TARGET="$BOOTSTRAP_HOME/.ai-conductor/harness"
MANUAL_TARGET="$MANUAL_HOME/.ai-conductor/harness"
bootstrap_record=$(sed "s|$BOOTSTRAP_HOME|HOME|g" "$BOOTSTRAP_RECORD")
manual_record=$(sed "s|$MANUAL_HOME|HOME|g" "$MANUAL_RECORD")
if [ "$BOOTSTRAP_STATUS" -eq 0 ] && [ "$MANUAL_CLONE_STATUS" -eq 0 ] && [ "$MANUAL_INSTALL_STATUS" -eq 0 ] \
  && [ "$bootstrap_record" = "$manual_record" ] \
  && [ "$(git -C "$BOOTSTRAP_TARGET" rev-parse HEAD)" = "$(git -C "$MANUAL_TARGET" rev-parse HEAD)" ] \
  && [ "$(git -C "$BOOTSTRAP_TARGET" branch --show-current)" = "$(git -C "$MANUAL_TARGET" branch --show-current)" ] \
  && [ "$(git -C "$BOOTSTRAP_TARGET" status --porcelain)" = "$(git -C "$MANUAL_TARGET" status --porcelain)" ]; then
  echo 'PASS fresh bootstrap state matches a manual stable clone and install'
else
  failures+="manual parity differed between bootstrap and manual install\\n"
fi

# Existing targets are classified before an acquisition can write anything.
CONFIG_HOME="$TMP_ROOT/home-existing-config"
CONFIG_FILE="$CONFIG_HOME/.ai-conductor/config.yml"
mkdir -p "${CONFIG_FILE%/*}"
printf 'preserve: true\n' > "$CONFIG_FILE"
config_before=$(cksum "$CONFIG_FILE")
CASE_HOME_OVERRIDE="$CONFIG_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case existing-config
if [ "$CASE_STATUS" -eq 0 ] && [ "$(cksum "$CONFIG_FILE")" = "$config_before" ]; then
  echo 'PASS existing ai-conductor configuration is preserved during fresh install'
else
  failures+="existing configuration was changed: $CASE_OUTPUT\\n"
fi

PLAIN_HOME="$TMP_ROOT/home-plain-target"
PLAIN_TARGET="$PLAIN_HOME/.ai-conductor/harness"
mkdir -p "$PLAIN_TARGET"
printf 'keep one\n' > "$PLAIN_TARGET/one"
printf 'keep two\n' > "$PLAIN_TARGET/two"
plain_before=$(find "$PLAIN_TARGET" -type f -exec cksum {} + | sort)
CASE_HOME_OVERRIDE="$PLAIN_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case plain-target
if [ "$CASE_STATUS" -ne 0 ] && grep -Fqx "error: refusing to replace existing directory $PLAIN_TARGET" <<< "$CASE_STDERR" \
  && [ "$(find "$PLAIN_TARGET" -type f -exec cksum {} + | sort)" = "$plain_before" ]; then
  echo 'PASS plain target directory is refused untouched'
else
  failures+="plain target was not refused untouched: $CASE_OUTPUT\\n"
fi

FOREIGN_HOME="$TMP_ROOT/home-foreign-target"
FOREIGN_TARGET="$FOREIGN_HOME/.ai-conductor/harness"
mkdir -p "${FOREIGN_TARGET%/*}"
git clone -q "$SOURCE_REPO" "$FOREIGN_TARGET"
git -C "$FOREIGN_TARGET" remote set-url origin https://example.invalid/not-ai-conductor.git
foreign_head=$(git -C "$FOREIGN_TARGET" rev-parse HEAD)
foreign_before=$(find "$FOREIGN_TARGET" -type f -exec cksum {} + | sort)
CASE_HOME_OVERRIDE="$FOREIGN_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case foreign-target
if [ "$CASE_STATUS" -ne 0 ] && grep -Fqx "error: refusing to use $FOREIGN_TARGET with unexpected origin https://example.invalid/not-ai-conductor.git" <<< "$CASE_STDERR" \
  && [ "$(git -C "$FOREIGN_TARGET" rev-parse HEAD)" = "$foreign_head" ] \
  && [ "$(find "$FOREIGN_TARGET" -type f -exec cksum {} + | sort)" = "$foreign_before" ]; then
  echo 'PASS foreign checkout is refused untouched'
else
  failures+="foreign checkout was not refused untouched: $CASE_OUTPUT\\n"
fi

RERUN_HOME="$TMP_ROOT/home-rerun"
CASE_HOME_OVERRIDE="$RERUN_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case rerun-first
rerun_head=$(git -C "$RERUN_HOME/.ai-conductor/harness" rev-parse HEAD)
: > "$RECORD"
RERUN_GIT_RECORD="$TMP_ROOT/rerun-git-subcommands"
: > "$RERUN_GIT_RECORD"
GIT_SUBCOMMAND_RECORD="$RERUN_GIT_RECORD" CASE_HOME_OVERRIDE="$RERUN_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case rerun-second
if [ "$CASE_STATUS" -eq 0 ] && grep -Fq 'installation is current' <<< "$CASE_STDOUT" \
  && [ "$(< "$RECORD")" = "$RERUN_HOME/.ai-conductor/harness||" ] \
  && ! grep -Fxq clone "$RERUN_GIT_RECORD" \
  && [ "$(git -C "$RERUN_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$rerun_head" ]; then
  echo 'PASS second run delegates to the current checkout updater'
else
  failures+="second run did not delegate to updater: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\ngit subcommands: $(< "$RERUN_GIT_RECORD")\\n"
fi

printf 'advanced stable channel\n' > "$SOURCE_REPO/ADVANCED"
git -C "$SOURCE_REPO" add ADVANCED
git -C "$SOURCE_REPO" commit -qm 'advance stable fixture'
advanced_stable_head=$(git -C "$SOURCE_REPO" rev-parse stable)
: > "$RECORD"
BEHIND_GIT_RECORD="$TMP_ROOT/behind-git-subcommands"
: > "$BEHIND_GIT_RECORD"
GIT_SUBCOMMAND_RECORD="$BEHIND_GIT_RECORD" CASE_HOME_OVERRIDE="$RERUN_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case behind-stable
if [ "$CASE_STATUS" -eq 0 ] && grep -Fq 'installation is current' <<< "$CASE_STDOUT" \
  && [ "$advanced_stable_head" != "$rerun_head" ] \
  && [ "$(< "$RECORD")" = "$RERUN_HOME/.ai-conductor/harness||" ] \
  && ! grep -Fxq clone "$BEHIND_GIT_RECORD" \
  && [ "$(git -C "$RERUN_HOME/.ai-conductor/harness" rev-parse HEAD)" = "$rerun_head" ]; then
  echo 'PASS behind stable checkout delegates to updater without acquisition'
else
  failures+="behind stable checkout did not delegate to updater without acquisition: $CASE_OUTPUT\\nrecord: $(< "$RECORD")\\ngit subcommands: $(< "$BEHIND_GIT_RECORD")\\n"
fi

UPDATE_FAIL_HOME="$TMP_ROOT/home-updater-failure"
git clone -q "$SOURCE_REPO" "$UPDATE_FAIL_HOME/.ai-conductor/harness"
UPDATE_MARKER="$TMP_ROOT/updater-marker"
UPDATE_STATE_RECORD="$TMP_ROOT/updater-state"
update_before_head=$(git -C "$UPDATE_FAIL_HOME/.ai-conductor/harness" rev-parse HEAD)
update_before_status=$(git -C "$UPDATE_FAIL_HOME/.ai-conductor/harness" status --porcelain)
set +e
env HOME="$UPDATE_FAIL_HOME" PATH="$FRESH_INSTALL_PATH" AI_CONDUCTOR_REPO_URL="$SOURCE_REPO" INSTALLER_RECORD="$RECORD" UPDATE_EXIT_CODE=7 UPDATE_MARKER="$UPDATE_MARKER" UPDATE_STATE_RECORD="$UPDATE_STATE_RECORD" /bin/sh -s -- < "$INSTALL_SCRIPT" > "$TMP_ROOT/updater-failure.stdout" 2> "$TMP_ROOT/updater-failure.stderr"
update_failure_status=$?
set -e
update_after_head=$(git -C "$UPDATE_FAIL_HOME/.ai-conductor/harness" rev-parse HEAD)
update_after_status=$(git -C "$UPDATE_FAIL_HOME/.ai-conductor/harness" status --porcelain)
update_recorded_head=$(sed -n '1p' "$UPDATE_STATE_RECORD")
update_recorded_status=$(sed -n '2p' "$UPDATE_STATE_RECORD")
if [ "$update_failure_status" -eq 7 ] && [ -f "$UPDATE_MARKER" ] && grep -Fq 'updater failed with 7' "$TMP_ROOT/updater-failure.stderr" \
  && [ "$update_before_head" = "$update_after_head" ] && [ "$update_before_status" = "$update_after_status" ] \
  && [ "$update_recorded_head" = "$update_after_head" ] && [ "$update_recorded_status" = "$update_after_status" ]; then
  echo 'PASS updater failure and its state are propagated unchanged'
else
  failures+="updater failure was not propagated unchanged: recorded HEAD $update_recorded_head, post-run HEAD $update_after_head; recorded status $update_recorded_status, post-run status $update_after_status\\n"
fi

LOCK_HOME="$TMP_ROOT/home-held-lock"
mkdir -p "$LOCK_HOME/.ai-conductor/harness.lock"
CASE_HOME_OVERRIDE="$LOCK_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case held-lock
if [ "$CASE_STATUS" -ne 0 ] && grep -Fqx "error: another install is in progress at $LOCK_HOME/.ai-conductor/harness.lock" <<< "$CASE_STDERR" \
  && [ -d "$LOCK_HOME/.ai-conductor/harness.lock" ] && [ ! -e "$LOCK_HOME/.ai-conductor/harness" ]; then
  echo 'PASS a foreign acquisition lock is never removed'
else
  failures+="held acquisition lock was not respected: $CASE_OUTPUT\\n"
fi

CONCURRENT_HOME="$TMP_ROOT/home-concurrent"
CONCURRENT_INSTALLER_RECORD="$TMP_ROOT/concurrent-installer-record"
CONCURRENT_UPDATE_RECORD="$TMP_ROOT/concurrent-updater-record"
CONCURRENT_PATH="$TMP_ROOT/prerequisites-concurrent"
CONCURRENT_CLONE_READY="$TMP_ROOT/concurrent-clone-ready"
CONCURRENT_CLONE_RELEASE="$TMP_ROOT/concurrent-clone-release"
CONCURRENT_LOCK="$CONCURRENT_HOME/.ai-conductor/harness.lock"
CONCURRENT_LOCK_ATTEMPTS="$TMP_ROOT/concurrent-lock-attempts"
mkdir -p "$CONCURRENT_HOME"
mkdir -p "$CONCURRENT_PATH"
cat > "$CONCURRENT_PATH/git" <<'EOF'
#!/bin/sh
if [ "$1" = clone ]; then
  : > "$CONCURRENT_CLONE_READY"
  while [ ! -e "$CONCURRENT_CLONE_RELEASE" ]; do
    /bin/sleep 0.01
  done
fi
exec "$REAL_GIT" "$@"
EOF
chmod +x "$CONCURRENT_PATH/git"
cat > "$CONCURRENT_PATH/mkdir" <<'EOF'
#!/bin/sh
if [ "$1" = "$CONCURRENT_LOCK" ]; then
  printf '%s\n' "$1" >> "$CONCURRENT_LOCK_ATTEMPTS"
fi
exec "$REAL_MKDIR" "$@"
EOF
chmod +x "$CONCURRENT_PATH/mkdir"
for tool in mv rm rmdir; do
  ln -s "$(command -v "$tool")" "$CONCURRENT_PATH/$tool"
done
for tool in gh node npm tmux; do
  ln -s "$PREREQUISITE_PATH/present" "$CONCURRENT_PATH/$tool"
done
ln -s "$PREREQUISITE_PATH/python3" "$CONCURRENT_PATH/python3"
: > "$CONCURRENT_INSTALLER_RECORD"
: > "$CONCURRENT_UPDATE_RECORD"
: > "$CONCURRENT_LOCK_ATTEMPTS"
set +e
env HOME="$CONCURRENT_HOME" PATH="$CONCURRENT_PATH" REAL_GIT="$(command -v git)" REAL_MKDIR="$(command -v mkdir)" CONCURRENT_LOCK="$CONCURRENT_LOCK" CONCURRENT_LOCK_ATTEMPTS="$CONCURRENT_LOCK_ATTEMPTS" CONCURRENT_CLONE_READY="$CONCURRENT_CLONE_READY" CONCURRENT_CLONE_RELEASE="$CONCURRENT_CLONE_RELEASE" AI_CONDUCTOR_REPO_URL="$SOURCE_REPO" INSTALLER_RECORD="$CONCURRENT_INSTALLER_RECORD" UPDATE_RECORD="$CONCURRENT_UPDATE_RECORD" /bin/sh -s -- < "$INSTALL_SCRIPT" > "$TMP_ROOT/concurrent-one.stdout" 2> "$TMP_ROOT/concurrent-one.stderr" & concurrent_one=$!
for _ in $(seq 1 100); do
  [ -e "$CONCURRENT_CLONE_READY" ] && break
  /bin/sleep 0.01
done
if [ -e "$CONCURRENT_CLONE_READY" ]; then
  env HOME="$CONCURRENT_HOME" PATH="$CONCURRENT_PATH" REAL_GIT="$(command -v git)" REAL_MKDIR="$(command -v mkdir)" CONCURRENT_LOCK="$CONCURRENT_LOCK" CONCURRENT_LOCK_ATTEMPTS="$CONCURRENT_LOCK_ATTEMPTS" CONCURRENT_CLONE_READY="$CONCURRENT_CLONE_READY" CONCURRENT_CLONE_RELEASE="$CONCURRENT_CLONE_RELEASE" AI_CONDUCTOR_REPO_URL="$SOURCE_REPO" INSTALLER_RECORD="$CONCURRENT_INSTALLER_RECORD" UPDATE_RECORD="$CONCURRENT_UPDATE_RECORD" /bin/sh -s -- < "$INSTALL_SCRIPT" > "$TMP_ROOT/concurrent-two.stdout" 2> "$TMP_ROOT/concurrent-two.stderr" & concurrent_two=$!
  for _ in $(seq 1 100); do
    [ "$(wc -l < "$CONCURRENT_LOCK_ATTEMPTS")" -ge 2 ] && break
    /bin/sleep 0.01
  done
  : > "$CONCURRENT_CLONE_RELEASE"
else
  concurrent_two=''
fi
wait "$concurrent_one"; concurrent_one_status=$?
if [ -n "$concurrent_two" ]; then
  wait "$concurrent_two"; concurrent_two_status=$?
else
  concurrent_two_status=1
fi
set -e
concurrent_successes=0
[ "$concurrent_one_status" -ne 0 ] || concurrent_successes=$((concurrent_successes + 1))
[ "$concurrent_two_status" -ne 0 ] || concurrent_successes=$((concurrent_successes + 1))
concurrent_expected_updates=$((concurrent_successes - 1))
if [ -d "$CONCURRENT_HOME/.ai-conductor/harness/.git" ] \
  && git -C "$CONCURRENT_HOME/.ai-conductor/harness" fsck --no-dangling >/dev/null \
  && [ ! -e "$CONCURRENT_HOME/.ai-conductor/harness.lock" ] \
  && ! find "$CONCURRENT_HOME/.ai-conductor" -maxdepth 1 -name 'harness.partial.*' -print -quit | grep -q . \
  && ! find "$CONCURRENT_HOME/.ai-conductor/harness" -type d -name 'harness.partial.*' -print -quit | grep -q . \
  && [ "$(wc -l < "$CONCURRENT_INSTALLER_RECORD")" -eq 1 ] \
  && [ "$(wc -l < "$CONCURRENT_UPDATE_RECORD")" -eq "$concurrent_expected_updates" ] \
  && { [ "$concurrent_one_status" -eq 0 ] || [ "$concurrent_two_status" -eq 0 ]; }; then
  echo 'PASS simultaneous first runs leave one healthy checkout'
else
  failures+="simultaneous first runs did not leave one healthy checkout (installers: $(wc -l < "$CONCURRENT_INSTALLER_RECORD"), updaters: $(wc -l < "$CONCURRENT_UPDATE_RECORD"), successful runs: $concurrent_successes)\\n"
fi

LOST_RACE_HOME="$TMP_ROOT/home-lost-race"
LOST_RACE_TARGET="$LOST_RACE_HOME/.ai-conductor/harness"
LOST_RACE_LOCK="$LOST_RACE_HOME/.ai-conductor/harness.lock"
LOST_RACE_READY="$TMP_ROOT/lost-race-ready"
LOST_RACE_INSTALLER_RECORD="$TMP_ROOT/lost-race-installer-record"
LOST_RACE_UPDATE_RECORD="$TMP_ROOT/lost-race-updater-record"
mkdir -p "${LOST_RACE_LOCK%/*}" "$LOST_RACE_LOCK"
: > "$LOST_RACE_INSTALLER_RECORD"
: > "$LOST_RACE_UPDATE_RECORD"
env HOME="$LOST_RACE_HOME" PATH="$LOST_RACE_PATH" REAL_MKDIR="$(command -v mkdir)" LOST_RACE_LOCK="$LOST_RACE_LOCK" LOST_RACE_READY="$LOST_RACE_READY" AI_CONDUCTOR_REPO_URL="$SOURCE_REPO" INSTALLER_RECORD="$LOST_RACE_INSTALLER_RECORD" UPDATE_RECORD="$LOST_RACE_UPDATE_RECORD" /bin/sh -s -- < "$INSTALL_SCRIPT" > "$TMP_ROOT/lost-race.stdout" 2> "$TMP_ROOT/lost-race.stderr" & lost_race_pid=$!
for _ in $(seq 1 100); do
  [ -e "$LOST_RACE_READY" ] && break
  /bin/sleep 0.01
done
if [ -e "$LOST_RACE_READY" ]; then
  git clone -q "$SOURCE_REPO" "$LOST_RACE_TARGET"
  rmdir "$LOST_RACE_LOCK"
  set +e
  wait "$lost_race_pid"; lost_race_status=$?
  set -e
  if [ "$lost_race_status" -eq 0 ] \
    && [ "$(wc -l < "$LOST_RACE_INSTALLER_RECORD")" -eq 0 ] \
    && [ "$(wc -l < "$LOST_RACE_UPDATE_RECORD")" -eq 1 ] \
    && grep -Fqx "$LOST_RACE_TARGET||" "$LOST_RACE_UPDATE_RECORD"; then
    echo 'PASS a delayed first run hands off to updater after the lock race'
  else
    failures+="lost-race run did not hand off to updater: $(< "$TMP_ROOT/lost-race.stderr")\\n"
  fi
else
  kill "$lost_race_pid" 2>/dev/null || true
  wait "$lost_race_pid" 2>/dev/null || true
  failures+='lost-race run did not reach the acquisition lock\n'
fi

HAND_HOME="$TMP_ROOT/home-hand-fetched"
HAND_CHECKOUT="$HAND_HOME/code/ai-conductor"
mkdir -p "${HAND_CHECKOUT%/*}"
git clone -q "$SOURCE_REPO" "$HAND_CHECKOUT"
hand_head=$(git -C "$HAND_CHECKOUT" rev-parse HEAD)
hand_status=$(git -C "$HAND_CHECKOUT" status --porcelain)
hand_files=$(find "$HAND_CHECKOUT" -type f -not -path '*/.git/*' -exec cksum {} + | sort)
CASE_HOME_OVERRIDE="$HAND_HOME" CASE_PATH="$FRESH_INSTALL_PATH" run_case hand-fetched
if [ "$CASE_STATUS" -eq 0 ] && [ -d "$HAND_HOME/.ai-conductor/harness/.git" ] \
  && [ "$(git -C "$HAND_CHECKOUT" rev-parse HEAD)" = "$hand_head" ] \
  && [ "$(git -C "$HAND_CHECKOUT" status --porcelain)" = "$hand_status" ] \
  && [ "$(find "$HAND_CHECKOUT" -type f -not -path '*/.git/*' -exec cksum {} + | sort)" = "$hand_files" ]; then
  echo 'PASS hand-fetched checkout remains untouched'
else
  failures+="hand-fetched checkout was changed: $CASE_OUTPUT\\n"
fi

if [ -z "$failures" ]; then
  echo 'PASS bootstrap option parsing and prerequisites are covered'
  exit 0
fi

printf 'FAIL bootstrap option parsing and prerequisites are covered\n%b' "$failures"
exit 1
