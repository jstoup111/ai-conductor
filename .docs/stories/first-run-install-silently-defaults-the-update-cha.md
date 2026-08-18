# Explicit update-channel selection on a first-run install

Status: Accepted

## Context

`bin/install`'s `configure_conductor` picks the harness update channel exactly once, on a first run
(when `~/.ai-conductor/config.yml` does not exist). That first-run arm seeds `channel="stable"` and
only offers a prompt when `[ "$UPDATE_MODE" != true ] && [ -t 0 ]` (`bin/install:934-948`). With no
controlling terminal — piped stdin, CI, a future `curl | sh` installer — the prompt can never fire
and `stable` is written with no way for the caller to say otherwise. There is no flag and no
environment variable that supplies the choice, so an unattended install has no mechanism to express
an intent at all; recovering later means `bin/update --set-channel` plus re-detection.

The originating issue (jstoup111/ai-conductor#1711) proposed failing closed when no channel is
supplied. **The operator explicitly overrode that during `/explore`:** `stable` remains the
fallback and the installer never fails on a missing channel. What this work delivers is the
additive half — an explicit way to supply the channel on every path, a defined precedence between
the sources, and output that names both the channel and where it came from. The interactive prompt
keeps its current shape, bare Enter included.

Resolution order for a first-run install is **`--channel` > `AI_CONDUCTOR_CHANNEL` > interactive
prompt > `stable`**. `bin/install` already carries this exact pattern for `--providers`: stripped
from `"$@"` in the pre-dispatch option loop, validated against a closed set *before* any global
installation begins, and failed with a named error on an unsupported value (`bin/install:1483-1529`).
The valid channels are `stable`, `tagged`, and `main`, matching `bin/update --set-channel`.

Writes stay on the schema-owned accessors (`conductor_cfg_set updateChannel`) — `bin/lib/harness-common.sh`
is the sole owner of that surface and `test/check_update_flow_config_ownership.sh` fails the build
if any `bin/` script reaches around it.

## Story 1 — `--channel` supplies the update channel on any first-run install

As someone installing the harness unattended, when I pass `--channel <value>` to `bin/install`, the
first-run install must record exactly that channel without prompting, so an install with no
controlling terminal is not forced onto a channel it never chose.

### Happy Path

- **Given** no `~/.ai-conductor/config.yml` exists (a genuine first run), and stdin is not a TTY,
- **When** `bin/install --channel main` runs,
- **Then** the install completes and `~/.ai-conductor/config.yml` records `updateChannel` as `main`,
- **And** no channel prompt is emitted (there was nothing to ask),
- **And** the same result holds for `--channel=main`, for `stable`, and for `tagged`.

### Negative Paths

- **Given** a first run **with** a controlling terminal,
- **When** `bin/install --channel tagged` runs,
- **Then** the interactive channel prompt MUST NOT be shown — an explicitly supplied choice
  suppresses the prompt rather than asking the operator to confirm it again,
- **And** the recorded `updateChannel` is `tagged`.

- **Given** a first run where both `--channel stable` is passed and `AI_CONDUCTOR_CHANNEL=main` is set
  in the environment,
- **When** `bin/install --channel stable` runs,
- **Then** the recorded `updateChannel` is `stable` — the flag outranks the environment variable.

## Story 2 — `AI_CONDUCTOR_CHANNEL` supplies the channel when no flag is passed

As an operator scripting an install where passing a flag is awkward (a piped installer, a container
image build), when I export `AI_CONDUCTOR_CHANNEL`, the first-run install must honor it, so the
environment is a usable second channel-supply mechanism.

### Happy Path

- **Given** no `~/.ai-conductor/config.yml` exists, stdin is not a TTY, and `AI_CONDUCTOR_CHANNEL=tagged`
  is exported,
- **When** `bin/install` runs with no `--channel` flag,
- **Then** the recorded `updateChannel` is `tagged`.

### Negative Paths

- **Given** a first run with a controlling terminal and `AI_CONDUCTOR_CHANNEL=main` exported,
- **When** `bin/install` runs with no `--channel` flag,
- **Then** the interactive prompt MUST NOT be shown and the recorded `updateChannel` is `main` —
  the environment variable suppresses the prompt exactly as the flag does.

- **Given** a first run with `AI_CONDUCTOR_CHANNEL` set to the empty string,
- **When** `bin/install` runs with no `--channel` flag and no TTY,
- **Then** the empty value is treated as "not supplied" rather than as an invalid channel — the
  install completes and records the `stable` fallback.

## Story 3 — An unsupported channel value is rejected before anything is installed

As an operator who fat-fingered the channel, when I supply a value that is not a real channel, the
installer must refuse by name before it changes any global state, so I get a correctable error
instead of a half-configured machine.

### Happy Path

- **Given** any invocation of `bin/install --channel bogus`,
- **When** the installer parses its options,
- **Then** it exits non-zero with a message naming the rejected value and listing the supported
  channels (`stable`, `tagged`, `main`),
- **And** it does so **before** any symlink, config file, or dependency bootstrap is written —
  a pre-existing `~/.ai-conductor/config.yml` is byte-for-byte unchanged and a machine with none
  still has none.

### Negative Paths

- **Given** `bin/install --channel` with no value following it, or `--channel=` with an empty value,
- **When** the installer parses its options,
- **Then** it exits non-zero naming the missing argument — it MUST NOT silently fall through to the
  environment variable, the prompt, or the `stable` fallback.

- **Given** `AI_CONDUCTOR_CHANNEL=bogus` exported and no `--channel` flag,
- **When** `bin/install` runs,
- **Then** it exits non-zero naming the rejected value and its source, and installs nothing — an
  invalid channel is rejected identically whichever source supplied it.

## Story 4 — An already-configured channel is never re-prompted or overwritten

As an operator re-running the installer on a configured machine, when a channel is already recorded,
the installer must leave it alone, so a re-install or an update never silently moves me off the
channel I chose.

### Happy Path

- **Given** `~/.ai-conductor/config.yml` already exists recording `updateChannel: main`,
- **When** `bin/install` runs again with a controlling terminal and no `--channel` flag,
- **Then** no channel prompt is shown, `updateChannel` is still `main`, and only `currentVersion`
  and `lastCheckedAt` are refreshed.

### Negative Paths

- **Given** the same already-configured machine recording `updateChannel: main`,
- **When** `bin/install --channel stable` runs,
- **Then** the recorded `updateChannel` MUST remain `main` — the flag supplies a *first-run* choice
  and never rewrites an existing one; changing a configured channel stays `bin/update --set-channel`'s
  job,
- **And** the output states that the supplied channel was ignored because one is already configured,
  so the caller is not left believing the flag took effect.

- **Given** `bin/install --update` on an already-configured machine,
- **When** the update-mode path runs,
- **Then** no channel prompt is shown and `updateChannel` is unchanged, exactly as today.

## Story 5 — The resolved channel and its source are confirmed in the install output

As an operator reading install output, when the install finishes, it must tell me which channel was
recorded and which source decided it, so an unattended install is auditable from its log alone.

### Happy Path

- **Given** any first-run install that records a channel,
- **When** the install completes,
- **Then** the output confirms both the recorded channel and the source that supplied it —
  distinguishing the `--channel` flag, the `AI_CONDUCTOR_CHANNEL` environment variable, the interactive
  prompt, and the `stable` fallback,
- **And** for the fallback case the message also names how to choose explicitly next time
  (the `--channel` flag, the environment variable, or `bin/update --set-channel`).

### Negative Paths

- **Given** a first-run install that falls back to `stable` because nothing supplied a choice and
  there was no TTY,
- **When** the install completes,
- **Then** the output MUST NOT present `stable` as if it were a chosen value — it is reported as a
  fallback, and the install still exits zero (per the operator's scope decision, this path does not
  fail).

- **Given** an install where writing the conductor configuration fails,
- **When** the failure is reported,
- **Then** no confirmation line claims a channel was recorded — the existing warning path is
  preserved and no false success is printed.

## Out of scope

- Failing the install when no channel is supplied (the issue's original ask; explicitly overridden
  by the operator — see `.docs/track/first-run-install-silently-defaults-the-update-cha.md`).
- The markdown-viewer, mermaid-renderer, and provider first-run prompts, which skip under the same
  non-TTY condition and are left untouched.
- Any `curl | sh` installer work.
- `bin/update --set-channel`, the update-mode refresh path, and every existing reader of
  `updateChannel` (`bin/update:322`, `bin/conduct:319`).
