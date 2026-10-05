import { PROTECTED_ARTIFACT_DIRECTORIES } from './protected-artifact-seal.js';
import { resolveCanonicalLauncher, shellQuote } from './canonical-launcher.js';
import { GIT_OPTION_SPEC } from './git-option-spec.js';

const globalOptionCase = GIT_OPTION_SPEC.global.flatMap((option) => {
  const spellings = [
    option.name === undefined ? undefined : `--${option.name}`,
    option.short === undefined ? undefined : `-${option.short}`,
  ].filter((spelling): spelling is string => spelling !== undefined);
  const consume = option.arity === 'required' ? '((i+=2))' : '((i++))';
  return [
    `    ${spellings.join('|')}) ${consume}; continue ;;`,
    ...(option.name === undefined || !option.acceptsEquals
      ? []
      : [`    --${option.name}=*) ((i++)); continue ;;`]),
  ];
}).join('\n');

const guardedOptionMetadataCase = (kind: 'name' | 'short') => Object.entries(GIT_OPTION_SPEC.subcommands).flatMap(([command, options]) => options
  .filter((option) => option[kind] !== undefined)
  .map((option) => {
    const key = option[kind]!;
    const canonical = option.name ?? key;
    return `    ${command}:${key}) printf '%s' '${canonical}|${option.arity}|${option.negatable}|${option.expandsTo?.join(',') ?? ''}' ;;`;
  })).join('\n');

const guardedOptionNamesCase = Object.entries(GIT_OPTION_SPEC.subcommands).map(([command, options]) => {
  const names = options.flatMap((option) => option.name === undefined ? [] : [option.name]);
  return `    ${command}) printf '%s\\n' ${names.map((name) => `'${name}'`).join(' ')} ;;`;
}).join('\n');

// These fragments are deliberately assembled from the data-only option spec at
// module load.  The resulting guard is static shell source, not an interpreter
// template populated from runtime argv.
const guardedOptionNormalizer = `
option_metadata() {
  case "$1:$2" in
${guardedOptionMetadataCase('name')}
  esac
}

short_option_metadata() {
  case "$1:$2" in
${guardedOptionMetadataCase('short')}
  esac
}

option_names() {
  case "$1" in
${guardedOptionNamesCase}
  esac
}

resolve_long_option() {
  local command="$1" token="$2" candidate metadata match='' match_negated=false matches=0 negatable
  metadata="$(option_metadata "$command" "$token")"
  if [[ -n "$metadata" ]]; then printf '%s|false' "$metadata"; return; fi
  while IFS= read -r candidate; do
    metadata="$(option_metadata "$command" "$candidate")"
    if [[ "$candidate" == "$token"* ]]; then
      match="$metadata"; match_negated=false; ((matches+=1))
    fi
    IFS='|' read -r _ _ negatable _ <<< "$metadata"
    if [[ "$negatable" == true && "no-$candidate" == "$token"* ]]; then
      match="$metadata"; match_negated=true; ((matches+=1))
    fi
  done < <(option_names "$command")
  [[ $matches -eq 1 ]] && printf '%s|%s' "$match" "$match_negated"
}

canon=()
operands=()
options_ended=false
pathspec_separator=false
normalization_error=''
add_metadata() {
  local metadata="$1" negated="$2" canonical arity negatable expands
  IFS='|' read -r canonical arity negatable expands <<< "$metadata"
  if [[ "$negated" == true ]]; then
    [[ "$negatable" == true ]] || return
    canon+=("no-$canonical")
  elif [[ -n "$expands" ]]; then
    IFS=',' read -r -a expanded <<< "$expands"
    canon+=("\${expanded[@]}")
  else
    canon+=("$canonical")
  fi
}

normalize_options() {
  local command="$1" start="$2" token base value metadata resolved canonical arity negatable expands letters letter rest j
  j=$((start + 1))
  while [[ $j -lt \${#args[@]} ]]; do
    token="\${args[$j]}"
    if [[ "$options_ended" == true ]]; then operands+=("$token"); ((j+=1)); continue; fi
    if [[ "$token" == -- || "$token" == --end-of-options ]]; then
      options_ended=true
      [[ "$token" == -- ]] && pathspec_separator=true
      ((j+=1)); continue
    fi
    if [[ "$token" == --* ]]; then
      base="\${token#--}"; value=''
      [[ "$base" == *=* ]] && { value="\${base#*=}"; base="\${base%%=*}"; }
      resolved="$(resolve_long_option "$command" "$base")"
      negated="\${resolved##*|}"
      metadata="\${resolved%|*}"
      if [[ -n "$metadata" ]]; then
        IFS='|' read -r canonical arity negatable expands <<< "$metadata"
        if [[ "$negated" == true && "$negatable" != true ]]; then
          [[ -n "$normalization_error" ]] || normalization_error="$token"
        else
          add_metadata "$metadata" "$negated"
        fi
        if [[ "$arity" == required && -z "$value" && $((j + 1)) -lt \${#args[@]} ]]; then ((j+=1)); fi
      else [[ -n "$normalization_error" ]] || normalization_error="$token"; fi
      ((j+=1)); continue
    fi
    if [[ "$token" == -?* ]]; then
      letters="\${token#-}"
      for ((k=0; k<\${#letters}; k++)); do
        letter="\${letters:k:1}"
        metadata="$(short_option_metadata "$command" "$letter")"
        if [[ -z "$metadata" ]]; then [[ -n "$normalization_error" ]] || normalization_error="-$letter"; break; fi
        IFS='|' read -r canonical arity negatable expands <<< "$metadata"
        add_metadata "$metadata" false
        [[ "$arity" == none ]] && continue
        rest="\${letters:$((k + 1))}"
        [[ -n "$rest" || "$arity" != required || $((j + 1)) -ge \${#args[@]} ]] || ((j+=1))
        break
      done
      ((j+=1)); continue
    fi
    operands+=("$token")
    ((j+=1))
  done
}

has_canon() { local wanted="$1" value; for value in "\${canon[@]}"; do [[ "$value" == "$wanted" ]] && return 0; done; return 1; }
`;

/**
 * A PATH-shadowing git wrapper for agent processes. Runtime values are data
 * files beside the wrapper so this source remains deterministic and auditable.
 */
export const GIT_GUARD_SCRIPT = `#!/usr/bin/env bash
set -u
guard_dir="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
real_git="$(cat "$guard_dir/../git-guard/real-git")"
feature_common="$(cat "$guard_dir/../git-guard/common-dir")"

refuse() {
  printf 'ai-conductor git guard: refused %s — %s. Safe alternative: %s.\\n' "$1" "$2" "$3" >&2
  exit 1
}

# Keep the original argv for exec; classify after one safe non-shell alias expansion.
args=("$@")
original_args=("$@")
i=0
unknown_global=''
unknown_prefix_end=-1
while [[ $i -lt \${#args[@]} ]]; do
  case "\${args[$i]}" in
${globalOptionCase}
    -*)
      if [[ -z "$unknown_global" ]]; then
        unknown_global="\${args[$i]}"
        unknown_prefix_end=$i
      fi
      ((i++)); continue ;;
  esac
  break
done
command="\${args[$i]:-}"
if [[ -n "$unknown_global" ]]; then
  command=''
  for candidate in "\${args[@]:$((unknown_prefix_end + 1))}"; do
    if [[ "$candidate" =~ ^(reset|branch|clean|push|checkout|restore)$ ]]; then command="$candidate"; break; fi
  done
fi
if [[ -n "$unknown_global" && -n "$command" ]]; then
  common="$("$real_git" "\${args[@]:0:$unknown_prefix_end}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [[ "$common" == "$feature_common" ]] && refuse "$command" "unrecognized git option «$unknown_global» before «$command»" 'spell the option in full'
fi
# These are Git's own non-destructive query commands.  Keep this a static
# built-in-only set: consulting config for one of these commands both adds an
# observable real-git call and incorrectly treats a built-in as an alias.
if [[ -n "$command" ]] && [[ ! "$command" =~ ^(add|annotate|blame|bugreport|cat-file|check-attr|check-ignore|check-mailmap|check-ref-format|column|config|count-objects|describe|diff|diff-files|diff-index|diff-tree|fetch|for-each-ref|fsck|get-tar-commit-id|grep|help|ls-files|ls-remote|ls-tree|log|merge-base|name-rev|range-diff|rev-list|rev-parse|show|show-branch|show-index|show-ref|status|var|verify-commit|verify-pack|verify-tag|whatchanged|worktree)$ ]]; then
  alias_value="$($real_git "\${args[@]:0:$i}" config --get "alias.$command" 2>/dev/null || true)"
  if [[ -n "$alias_value" && "$alias_value" != '!'* ]]; then
    # Git aliases use quote-aware split_cmdline semantics, not bash's plain
    # word splitting.  Keep shell bang aliases above out of this path.
    expanded=(); token=''; quote=''; started=false
    for ((p=0; p<\${#alias_value}; p++)); do
      ch="\${alias_value:p:1}"
      if [[ -n "$quote" ]]; then
        if [[ "$ch" == "$quote" ]]; then quote=''; started=true
        elif [[ "$ch" == '\\' && "$quote" != "'" && $((p + 1)) -lt \${#alias_value} ]]; then ((p++)); token+="\${alias_value:p:1}"; started=true
        else token+="$ch"; started=true; fi
      elif [[ "$ch" == "'" || "$ch" == '"' ]]; then quote="$ch"; started=true
      elif [[ "$ch" == '\\' && $((p + 1)) -lt \${#alias_value} ]]; then ((p++)); token+="\${alias_value:p:1}"; started=true
      elif [[ "$ch" =~ [[:space:]] ]]; then
        if [[ "$started" == true ]]; then expanded+=("$token"); token=''; started=false; fi
      else token+="$ch"; started=true; fi
    done
    [[ -n "$quote" ]] && expanded=()
    [[ "$started" == true ]] && expanded+=("$token")
    args=("\${args[@]:0:$i}" "\${expanded[@]}" "\${args[@]:$((i+1))}")
    command="\${args[$i]:-}"
  fi
fi

${guardedOptionNormalizer}
if [[ "$command" =~ ^(reset|branch|clean|push|checkout|restore)$ ]]; then
  normalize_options "$command" "$i"
fi
if [[ -n "$normalization_error" ]]; then
  common="$("$real_git" "\${args[@]:0:$i}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [[ "$common" == "$feature_common" ]] && refuse "$command" "unrecognized option «$normalization_error» for git «$command»" 'spell the option in full'
fi

destructive=false
reason=''
alternative=''
case "$command" in
  push)
    for a in "\${operands[@]}"; do
      [[ "$a" == +* ]] && { destructive=true; reason='bare force push can rewrite remote history'; alternative='git push --force-with-lease'; break; }
    done
    has_canon force && { destructive=true; reason='bare force push can rewrite remote history'; alternative='git push --force-with-lease'; } ;;
  reset)
    has_canon hard && { destructive=true; reason='hard reset discards working-tree changes'; alternative='git reset --keep <target>'; } ;;
  clean)
    has_canon force && { destructive=true; reason='forced clean deletes untracked files'; alternative='git clean -n then remove named paths'; } ;;
  checkout)
    has_paths="$pathspec_separator"; safe_side=false
    has_canon ours || has_canon theirs || has_canon merge && safe_side=true
    [[ "$has_paths" == true && "$safe_side" == false ]] && { destructive=true; reason='path checkout discards working-tree changes'; alternative='commit a WIP first or use a temporary worktree'; } ;;
  restore)
    safe_side=false; staged=false; worktree=false
    has_canon ours || has_canon theirs || has_canon merge && safe_side=true
    has_canon staged && staged=true
    has_canon worktree && worktree=true
    [[ "$safe_side" == false && ( "$staged" == false || "$worktree" == true ) ]] && { destructive=true; reason='restore discards working-tree changes'; alternative='commit a WIP first or use a temporary worktree'; } ;;
  branch)
    force=false; delete=false; names=("\${operands[@]}")
    has_canon force && force=true
    has_canon delete && delete=true
    if [[ "$force" == true && "$delete" == true ]] && (( \${#names[@]} > 0 )); then
      for name in "\${names[@]}"; do
        reachable=false
        while IFS= read -r ref; do
          [[ "$ref" == "refs/heads/$name" ]] && continue
          if "$real_git" "\${args[@]:0:$i}" merge-base --is-ancestor "refs/heads/$name" "$ref" >/dev/null 2>&1; then
            reachable=true
            break
          fi
        done < <("$real_git" "\${args[@]:0:$i}" for-each-ref --format='%(refname)' refs/heads refs/remotes)
        [[ "$reachable" == false ]] && { destructive=true; reason='force deletion would make commits unreachable'; alternative='git branch -d <branch>'; break; }
      done
    fi ;;
esac

if [[ "$destructive" == true ]]; then
  common="$($real_git "\${args[@]:0:$i}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  [[ "$common" == "$feature_common" ]] && refuse "$command" "$reason" "$alternative"
fi
exec "$real_git" "\${original_args[@]}"
`;

/**
 * Git hook scripts embedded as engine assets
 *
 * Both hooks are written to .pipeline/git-hooks/ at worktree provisioning
 * and wired via git config core.hooksPath. They use no dist references; the
 * commit-msg hook invokes the installed ai-conductor scope-check command.
 */

const protectedArtifactPathCase = `    ${PROTECTED_ARTIFACT_DIRECTORIES
  .flatMap((directory) => [directory, `${directory}/*`])
  .join('|')})`;

/**
 * pre-commit hook
 *
 * Rejects staged protected artifacts before a commit is created. The emitted
 * Bash remains self-contained while its protected-path cases are derived from
 * the engine's shared protected artifact definition.
 */
export const PRE_COMMIT_HOOK = [
  '#!/bin/bash',
  'set -e',
  '',
  '# Engine bookkeeping is intentionally outside the preventive gate.',
  'if [[ "${CONDUCT_ENGINE_COMMIT:-}" == "1" ]]; then exit 0; fi',
  '',
  'WORKTREE_ROOT="$(git rev-parse --show-toplevel)"',
  'MARKER="$WORKTREE_ROOT/.pipeline/phase-active"',
  '[[ -f "$MARKER" ]] || exit 0',
  'PHASE="$(sed -n "s/^phase: //p" "$MARKER" | head -1)"',
  '[[ "$PHASE" == "BUILD" || "$PHASE" == "SHIP" ]] || exit 0',
  'PLAN_REF="$WORKTREE_ROOT/.pipeline/task-status.json"',
  'FEATURE_STEM=""',
  'if [[ -f "$PLAN_REF" ]]; then',
  '  FEATURE_STEM="$(sed -n "s/.*\\\"plan_ref\\\"[[:space:]]*:[[:space:]]*\\\"\\([^\\\"]*\\\)\\\".*/\\1/p" "$PLAN_REF" | head -1)"',
  '  FEATURE_STEM="${FEATURE_STEM##*/}"; FEATURE_STEM="${FEATURE_STEM%.md}"',
  'fi',
  'OFFENDERS=()',
  'while IFS= read -r -d "" path; do',
  '  allowed=false',
  '  while IFS= read -r prefix; do',
  '    [[ -z "$prefix" ]] || [[ "$path" != "$prefix"* ]] || allowed=true',
  '  done < <(sed -n "s/^allow: //p" "$MARKER")',
  '  [[ "$allowed" == true ]] && continue',
  '  own=false',
  '  if [[ -n "$FEATURE_STEM" ]]; then',
  '    stem="${path##*/}"; stem="${stem%.md}"',
  '    own_stem="$(printf "%s" "$FEATURE_STEM" | sed -E "s/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//")"',
  '    path_stem="$(printf "%s" "$stem" | sed -E "s/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//")"',
  '    [[ "$own_stem" == "$path_stem" ]] && own=true',
  '  fi',
  '  case "$path" in',
  '    ""|/*|../*|*/../*|*/./*)',
  '      # Git normally supplies repository-relative names, but never let a',
  '      # malformed or escaping target turn the preventive gate into allow.',
  '      OFFENDERS+=("$path")',
  '      ;;',
  protectedArtifactPathCase,
  '      [[ "$own" == true ]] || OFFENDERS+=("$path")',
  '      ;;',
  '  esac',
  'done < <(git diff --cached --name-only -z)',
  '',
  'if [[ ${#OFFENDERS[@]} -gt 0 ]]; then',
  '  printf "pre-commit: rejected protected artifact(s) during %s: %s\\n" "$PHASE" "${OFFENDERS[*]}" >&2',
  '  echo "Amend the owning DECIDE artifact through its DECIDE step, not this BUILD/SHIP commit." >&2',
  '  exit 1',
  'fi',
  '',
  '# Preserve repository-owned hooks after the engine gate has passed.',
  'COMMON_DIR="$(git rev-parse --git-common-dir)"',
  'COMMON_HOOKS_DIR="$COMMON_DIR/hooks"',
  '[[ "$COMMON_DIR" = /* ]] || COMMON_HOOKS_DIR="$WORKTREE_ROOT/$COMMON_DIR/hooks"',
  'CHAINED_HOOK="$COMMON_HOOKS_DIR/pre-commit"',
  '[[ ! -x "$CHAINED_HOOK" ]] || "$CHAINED_HOOK" "$@"',
  '',
  'exit 0',
].join('\n');

/**
 * reference-transaction hook.
 *
 * Provisioned now so every prepared worktree has the complete hook surface;
 * subsequent tasks add its preventive ref-deletion policy.
 */
export const REFERENCE_TRANSACTION_HOOK = [
  '#!/bin/bash',
  'set -u',
  '',
  'INPUT="$(mktemp)"',
  'trap "rm -f \"$INPUT\"" EXIT',
  'cat > "$INPUT"',
  '',
  '# Resolve the common hooks directory without invoking git on pass-through paths.',
  'common_hooks_dir() {',
  '  local common_relative',
  '  if [[ -n "${GIT_DIR:-}" && -f "$GIT_DIR/commondir" ]]; then',
  '    IFS= read -r common_relative < "$GIT_DIR/commondir"',
  '    printf "%s/hooks\\n" "$(cd "$GIT_DIR/$common_relative" && pwd -P)"',
  '  elif [[ -n "${GIT_DIR:-}" ]]; then',
  '    printf "%s/hooks\\n" "$GIT_DIR"',
  '  fi',
  '}',
  'chain_hook() {',
  '  local chained_hook',
  '  chained_hook="$(common_hooks_dir)"/reference-transaction',
  '  [[ ! -x "$chained_hook" ]] || "$chained_hook" "$@" < "$INPUT"',
  '}',
  '',
  '# Git invokes this hook for several stages. Only prepared can veto.',
  '[[ "${1:-}" == "prepared" ]] || {',
  '  chain_hook "$@"',
  '  exit $?',
  '}',
  '',
  'needs_decision=false',
  "while IFS=' ' read -r _old new ref; do",
  '  [[ "$ref" == refs/heads/* && "$new" =~ ^0+$ ]] && { needs_decision=true; break; }',
  'done < "$INPUT"',
  'if [[ "$needs_decision" == false ]]; then',
  '  chain_hook "$@"',
  '  exit $?',
  'fi',
  '',
  'COMMON_DIR="$(git rev-parse --git-common-dir)"',
  '[[ "$COMMON_DIR" = /* ]] || COMMON_DIR="$(git rev-parse --show-toplevel)/$COMMON_DIR"',
  "while IFS=' ' read -r old new ref; do",
  '  [[ "$ref" == refs/heads/* && "$new" =~ ^0+$ ]] || continue',
  '  # pack-refs and gc remove a loose duplicate after recording the same tip.',
  '  loose_ref="$COMMON_DIR/$ref"',
  '  if [[ -f "$loose_ref" && -f "$COMMON_DIR/packed-refs" ]] && grep -Fqx "$old $ref" "$COMMON_DIR/packed-refs"; then',
  '    continue',
  '  fi',
  '  tip="$(git rev-parse -q --verify "$ref" 2>/dev/null || true)"',
  '  [[ -n "$tip" ]] || continue',
  '  reachable=false',
  '  while IFS= read -r other; do',
  '    [[ "$other" == "$ref" ]] && continue',
  '    if git merge-base --is-ancestor "$tip" "$other" >/dev/null 2>&1; then reachable=true; break; fi',
  '  done < <(git for-each-ref --format="%(refname)" refs/heads refs/remotes)',
  '  if [[ "$reachable" == false ]]; then',
  "    printf 'refused branch deletion of %s: its commits would become unreachable. Safe alternatives: push or merge it first, or use git branch -d. To rename, create the new branch first and then delete the old one with git branch -d.\\n' \"$ref\" >&2",
  '    exit 1',
  '  fi',
  'done < "$INPUT"',
  '',
  'CHAINED_HOOK="$COMMON_DIR/hooks/reference-transaction"',
  '[[ ! -x "$CHAINED_HOOK" ]] || "$CHAINED_HOOK" "$@" < "$INPUT"',
  'exit $?',
  '',
].join('\n');

/**
 * pre-push hook.
 *
 * Provisioned now so every prepared worktree has the complete hook surface;
 * subsequent tasks add its preventive remote-update policy.
 */
export const PRE_PUSH_HOOK = [
  '#!/bin/bash',
  'set -u',
  '',
  'INPUT="$(mktemp)"',
  'trap "rm -f \"$INPUT\"" EXIT',
  'cat > "$INPUT"',
  'remote="${1:-}"',
  '',
  "while IFS=' ' read -r local_ref local_sha remote_ref remote_sha; do",
  '  # Remote deletion, branch creation, and fast-forwards cannot overwrite history.',
  '  [[ "$local_sha" =~ ^0+$ || "$remote_sha" =~ ^0+$ ]] && continue',
  '  if git merge-base --is-ancestor "$remote_sha" "$local_sha" >/dev/null 2>&1; then continue; fi',
  '  branch="${remote_ref#refs/heads/}"',
  '  tracked="$(git rev-parse -q --verify "refs/remotes/$remote/$branch" 2>/dev/null || true)"',
  '  # A matching tracking ref is the local proof required by --force-with-lease.',
  '  [[ "$tracked" == "$remote_sha" ]] && continue',
  "  printf 'refused push to %s: it would overwrite remote history this worktree has not fetched. Safe alternatives: git fetch, then git push --force-with-lease.\\n' \"$remote_ref\" >&2",
  '  exit 1',
  'done < "$INPUT"',
  '',
  'COMMON_DIR="$(git rev-parse --git-common-dir)"',
  '[[ "$COMMON_DIR" = /* ]] || COMMON_DIR="$(git rev-parse --show-toplevel)/$COMMON_DIR"',
  'CHAINED_HOOK="$COMMON_DIR/hooks/pre-push"',
  '[[ ! -x "$CHAINED_HOOK" ]] || "$CHAINED_HOOK" "$@" < "$INPUT"',
  'exit $?',
  '',
].join('\n');

/**
 * prepare-commit-msg hook
 * Stamps Task: <id> via git interpret-trailers only when the commit message
 * has no explicit Task: trailer. An explicit trailer is task-local telemetry
 * and is never replaced from the workspace-global .pipeline/current-task.
 * The stamp ID comes from .pipeline/current-task, else the hook abstains.
 * Abstains on amend, rebase-in-progress, or when current-task is absent.
 */
export const PREPARE_COMMIT_MSG_HOOK = [
  '#!/bin/bash',
  'set -e',
  '',
  'COMMIT_MSG_FILE="$1"',
  'COMMIT_SOURCE="${2:-}"',
  '',
  '# Abstain during amend (never restamp old commits)',
  'if [[ "$COMMIT_SOURCE" == "commit" ]]; then',
  '  exit 0',
  'fi',
  '',
  '# Abstain during rebase (replayed commits are never restamped)',
  'if [[ -d "$(git rev-parse --git-path rebase-merge)" ]] || [[ -d "$(git rev-parse --git-path rebase-apply)" ]]; then',
  '  exit 0',
  'fi',
  '',
  'WORKTREE_ROOT="$(git rev-parse --show-toplevel)"',
  'CO_AUTHOR_FILE="$WORKTREE_ROOT/.pipeline/co-author"',
  'if [[ -f "$CO_AUTHOR_FILE" ]]; then',
  '  CO_AUTHOR="$(cat "$CO_AUTHOR_FILE")"',
  '  [[ -z "$CO_AUTHOR" ]] || git interpret-trailers --in-place --if-exists addIfDifferent --trailer "$CO_AUTHOR" "$COMMIT_MSG_FILE" || true',
  'fi',
  '',
  '# Abstain if there are no staged changes (amend with just message change).',
  '# Co-author stamping deliberately precedes this so --allow-empty daemon',
  '# evidence commits still retain their resolved attribution.',
  'if git diff-index --cached --quiet HEAD 2>/dev/null; then',
  '  exit 0',
  'fi',
  'CURRENT_TASK_FILE="$WORKTREE_ROOT/.pipeline/current-task"',
  'TASK_STATUS_FILE="$WORKTREE_ROOT/.pipeline/task-status.json"',
  '',
  '# Try to get task id from current-task file',
  'TASK_ID=""',
  'if [[ -f "$CURRENT_TASK_FILE" ]]; then',
  '  TASK_ID="$(cat "$CURRENT_TASK_FILE" 2>/dev/null || true)"',
  'fi',
  '',
  '# An explicit Task: trailer belongs to the committing task. Never replace it',
  '# with workspace-global telemetry: concurrent agents can legitimately differ.',
  'EXPLICIT_TASK_TRAILER=$(git interpret-trailers --parse < "$COMMIT_MSG_FILE" 2>/dev/null | grep \'^Task:\' | head -1 || true)',
  '',
  '# Auto-stamp only messages with no explicit trailer. commit-msg validates',
  '# both explicit and auto-stamped values against task-status.json.',
  'if [[ -z "$EXPLICIT_TASK_TRAILER" ]] && [[ -n "$TASK_ID" ]]; then',
  '  git interpret-trailers --in-place --if-exists replace --trailer "Task: $TASK_ID" "$COMMIT_MSG_FILE" || true',
  'fi',
  '',
  '# Chain to the repository\'s own prepare-commit-msg hook if it exists',
  'COMMON_DIR="$(git rev-parse --git-common-dir)"',
  'COMMON_HOOKS_DIR="$COMMON_DIR/hooks"',
  'if [[ ! "$COMMON_DIR" = /* ]]; then',
  '  # Relative path — make it absolute',
  '  COMMON_HOOKS_DIR="$(git rev-parse --show-toplevel)/$COMMON_DIR/hooks"',
  'fi',
  'CHAINED_HOOK="$COMMON_HOOKS_DIR/prepare-commit-msg"',
  '',
  'if [[ -x "$CHAINED_HOOK" ]]; then',
  '  "$CHAINED_HOOK" "$@" || exit $?',
  'fi',
  '',
  'exit 0',
].join('\n');

/**
 * commit-msg hook
 *
 * Task 14 (#773): per-task commit attribution/evidence is demoted from a
 * gate to telemetry. This hook no longer rejects commits for missing or
 * unresolvable Task:/Evidence: trailers — that fail-closed behavior
 * (formerly "Surface A", #505 Task 5/7) is retired.
 *
 * What remains: when a Task: trailer IS present, its FORMAT is still
 * validated (rejects task-N naming drift; rejects an id not present in
 * task-status.json). Enforces plan-scope containment for attributed commits
 * and warns on subject-vs-trailer mismatch. Chains to $GIT_COMMON_DIR/hooks/
 * commit-msg if it exists.
 */
export function buildCommitMsgHook(launcher = resolveCanonicalLauncher()): string {
  const scopeCheck = `${shellQuote(launcher)} scope-check "$COMMIT_MSG_FILE"`;
  return [
  '#!/bin/bash',
  'set -e',
  '',
  'COMMIT_MSG_FILE="$1"',
  '',
  'WORKTREE_ROOT="$(git rev-parse --show-toplevel)"',
  'TASK_STATUS_FILE="$WORKTREE_ROOT/.pipeline/task-status.json"',
  '',
  '# Extract Task: trailer value',
  'TASK_TRAILER=$(git interpret-trailers --parse < "$COMMIT_MSG_FILE" 2>/dev/null | grep \'^Task:\' | head -1 | sed \'s/^Task: *//\' || true)',
  '',
  '# Extract Evidence: satisfied-by value',
  'EVIDENCE_TRAILER=$(git interpret-trailers --parse < "$COMMIT_MSG_FILE" 2>/dev/null | grep \'^Evidence: satisfied-by\' | head -1 | sed \'s/^Evidence: satisfied-by *//\' || true)',
  '',
  '# Extract Evidence: skipped <reason> value (alternative acceptance form for',
  '# empty commits — mirrors the deriver in autoheal.ts, which already treats',
  '# this trailer as satisfying a task).',
  'EVIDENCE_SKIPPED_REASON=$(git interpret-trailers --parse < "$COMMIT_MSG_FILE" 2>/dev/null | grep \'^Evidence: skipped\' | head -1 | sed \'s/^Evidence: skipped *//\' | sed \'s/^[[:space:]]*//;s/[[:space:]]*$//\' || true)',
  '',
  '# Exemption: merge commits legitimately lack a Task: trailer — MERGE_HEAD',
  '# is set by git itself for the duration of a merge commit.',
  'MERGE_HEAD_PATH="$(git rev-parse --git-path MERGE_HEAD 2>/dev/null || true)"',
  'if [[ -n "$MERGE_HEAD_PATH" ]] && [[ -f "$MERGE_HEAD_PATH" ]]; then',
  '  exit 0',
  'fi',
  '',
  '# Exemption: amend commits. GIT_REFLOG_ACTION is not',
  '# reliably set in this hook\'s environment across git versions or when -m is',
  '# combined with --amend, so fall back to inspecting the invoking git',
  '# process\'s own command line (our direct parent, always `git commit ...`)',
  '# for the --amend flag.',
  'if [[ "${GIT_REFLOG_ACTION:-}" == "commit (amend)" ]]; then',
  '  exit 0',
  'fi',
  'PARENT_GIT_CMD="$(ps -o args= -p "$PPID" 2>/dev/null || true)"',
  'if [[ "$PARENT_GIT_CMD" == *"commit"*"--amend"* ]]; then',
  '  exit 0',
  'fi',
  '',
  '# Exemption: commits replayed during a rebase are never restamped.',
  'REBASE_MERGE_PATH="$(git rev-parse --git-path rebase-merge 2>/dev/null || true)"',
  'REBASE_APPLY_PATH="$(git rev-parse --git-path rebase-apply 2>/dev/null || true)"',
  'if { [[ -n "$REBASE_MERGE_PATH" ]] && [[ -d "$REBASE_MERGE_PATH" ]]; } || { [[ -n "$REBASE_APPLY_PATH" ]] && [[ -d "$REBASE_APPLY_PATH" ]]; }; then',
  '  exit 0',
  'fi',
  '',
  '# Exemption (#505 Task 7): engine-authored bookkeeping commits. The engine',
  '# sets CONDUCT_ENGINE_COMMIT=1 in the environment for the duration of a',
  '# commit it makes itself (not a dispatched agent).',
  'if [[ "${CONDUCT_ENGINE_COMMIT:-}" == "1" ]]; then',
  '  exit 0',
  'fi',
  '',
  '# Task 14 (#773): commit evidence rejection is retired — per-task',
  '# attribution/evidence is now telemetry, not a gate. Missing Task:/',
  '# Evidence: trailers on a build-step commit no longer block the commit.',
  '',
  '# If there\'s a Task: trailer, validate its FORMAT (this is not gating on',
  '# presence — it only fires when a trailer was actually supplied).',
  'if [[ -n "$TASK_TRAILER" ]]; then',
  '  # Reject task-N format (naming drift)',
  '  if [[ "$TASK_TRAILER" =~ ^task- ]]; then',
  '    echo "commit-msg: rejected — Task: trailer uses task-N format; must be numeric id only" >&2',
  '    exit 1',
  '  fi',
  '',
  '  # Check if id exists in task-status.json',
  '  if [[ -f "$TASK_STATUS_FILE" ]]; then',
  '    # Keep runtime values out of JavaScript source. The option terminator',
  '    # makes both values data even when they resemble Node flags.',
  '    if ID_EXISTS=$(node -e \'const fs = require("fs"); const [statusPath, taskId] = process.argv.slice(1); try { const data = JSON.parse(fs.readFileSync(statusPath, "utf8")); const ids = (Array.isArray(data.tasks) ? data.tasks : []).map((task) => String(task && task.id)); console.log(ids.includes(taskId) ? "yes" : "no"); } catch (error) { console.error(`commit-msg: task-status processing failed: ${error.message}`); process.exit(2); }\' -- "$TASK_STATUS_FILE" "$TASK_TRAILER" 2>&1); then',
  '      :',
  '    else',
  '      printf "%s\\n" "$ID_EXISTS" >&2',
  '      echo "commit-msg: rejected — could not process task-status.json" >&2',
  '      exit 1',
  '    fi',
  '',
  '    if [[ "$ID_EXISTS" != "yes" ]]; then',
  '      echo "commit-msg: rejected — Task: $TASK_TRAILER not found in task-status.json" >&2',
  '      exit 1',
  '    fi',
  '  fi',
  '',
  '  # Task 14 (#773): the empty-commit Evidence: requirement is retired —',
  '  # evidence trailers are telemetry now, not a gate. An empty build-step',
  '  # commit with a Task: trailer no longer needs an Evidence: trailer.',
  '',
  '  # ADR 2026-08-09 D3: scope-check records containment; it never blocks.',
  '  # See adr-2026-08-09-non-blocking-plan-scope-containment. An out-of-floor',
  '  # result is advisory; an unresolvable check records ambiguity before exit 3.',
  '  if [[ -f "$TASK_STATUS_FILE" ]]; then',
  '    rc=0',
  `    CONDUCT_SCOPE_CHECK_PROJECT_ROOT="$WORKTREE_ROOT" ${scopeCheck} || rc=$?`,
  '    if [[ "$rc" == "3" ]]; then',
  '      echo "commit-msg: scope-check recorded ambiguity (exit 3); allowing commit" >&2',
  '    elif [[ "$rc" != "0" ]]; then',
  '      echo "commit-msg: scope-check abstained (exit $rc); allowing commit" >&2',
  '    fi',
  '  fi',
  '',
  '  # Warn on subject vs trailer mismatch',
  '  SUBJECT=$(head -1 "$COMMIT_MSG_FILE" || true)',
  '  if [[ "$SUBJECT" =~ [Tt]ask[[:space:]]+[0-9] ]]; then',
  '    # Extract numeric task reference from subject (e.g., "Task 5" or "task 7")',
  '    SUBJECT_TASK=$(echo "$SUBJECT" | grep -oE \'[Tt]ask[[:space:]]+[0-9]+\' | grep -oE \'[0-9]+\' || true)',
  '    if [[ -n "$SUBJECT_TASK" ]] && [[ "$SUBJECT_TASK" != "$TASK_TRAILER" ]]; then',
  '      echo "commit-msg: WARNING — subject references Task $SUBJECT_TASK but trailer is Task: $TASK_TRAILER" >&2',
  '    fi',
  '  fi',
  'fi',
  '',
  '# Chain to the repository\'s own commit-msg hook if it exists',
  'COMMON_DIR="$(git rev-parse --git-common-dir)"',
  'COMMON_HOOKS_DIR="$COMMON_DIR/hooks"',
  'if [[ ! "$COMMON_DIR" = /* ]]; then',
  '  # Relative path — make it absolute',
  '  COMMON_HOOKS_DIR="$(git rev-parse --show-toplevel)/$COMMON_DIR/hooks"',
  'fi',
  'CHAINED_HOOK="$COMMON_HOOKS_DIR/commit-msg"',
  '',
  'if [[ -x "$CHAINED_HOOK" ]]; then',
  '  "$CHAINED_HOOK" "$COMMIT_MSG_FILE" "$@" || exit $?',
  'fi',
  '',
  'exit 0',
  ].join('\n');
}

export const COMMIT_MSG_HOOK = buildCommitMsgHook();
