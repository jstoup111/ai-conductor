#!/bin/bash
set -e

MARKER_PATH=".pipeline/phase-active"

# Enforcement inactive (no build phase in flight) — pass through WITHOUT
# reading stdin, so this never blocks waiting on payload delivery.
if [ ! -f "$MARKER_PATH" ]; then
  exit 0
fi

# Bound stdin read to 1MiB to avoid hanging or OOMing on a runaway payload.
# timeout 3: never hang the session if the host holds hook stdin open —
# a timed-out (empty/partial) payload falls through the fail-open path.
PAYLOAD="$(timeout 3 head -c 1048576 2>/dev/null || true)"

# Extract the target path (Edit/Write use tool_input.file_path,
# NotebookEdit uses tool_input.notebook_path) via a bounded node JSON
# parse. A malformed/unparseable payload yields an empty PARSED, which
# falls through to the fail-open branch below.
TARGET="$(printf '%s' "$PAYLOAD" | node -e '
let data = "";
process.stdin.on("data", (chunk) => { data += chunk; });
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(data);
    const input = payload && payload.tool_input ? payload.tool_input : {};
    const target =
      typeof input.file_path === "string"
        ? input.file_path
        : typeof input.notebook_path === "string"
          ? input.notebook_path
          : "";
    process.stdout.write(target);
  } catch (err) {
    // Malformed/unparseable payload — fail open: emit a diagnostic on
    // stderr and nothing on stdout, so the caller falls through to the
    // fail-open branch (exit 0) rather than blocking the mutation.
    process.stderr.write(
      "docs-guard-hook: unparseable payload, passing through: " + String(err && err.message) + "\n"
    );
  }
});
' || true)"

# Fail-closed: by this point the phase-active marker is known to exist
# (the marker-absent fast path already exited above), so an empty TARGET
# — payload unparseable, timed out, or carrying no path — is undeterminable
# under an active phase. This write-surface hook must not pass an
# undeterminable target through silently: block it.
if [ -z "$TARGET" ]; then
  {
    echo "docs-guard: blocked write — target path could not be determined while a build phase is active."
    echo "Marker: .pipeline/phase-active"
    echo "Remedy: if this write is intentional and allowlisted, no action needed; otherwise run 'rm .pipeline/phase-active' only if you are certain the phase should not be active."
  } >&2
  exit 2
fi

# Classify the requested target from the physical project root. Absolute
# aliases are recognized by resolving each existing prefix in filesystem
# order, not by trusting a particular spelling of PWD. This retains the
# requested suffix beneath a root alias, while also resolving the final
# destination now so a broken link, cycle, unreadable component, or invalid
# path cannot fall through as unprotected.
CLASSIFICATION="$(printf '%s' "$TARGET" | node -e '
const fs = require("fs");
const path = require("path");
const raw = fs.readFileSync(0, "utf8");
const physicalRoot = fs.realpathSync.native(process.cwd());

const resolveInFilesystemOrder = (value) => {
  const parsed = path.parse(value);
  const parts = value.slice(parsed.root.length).split(path.sep);
  let current = parsed.root;
  let missing = false;
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") { current = path.dirname(current); continue; }
    const next = path.join(current, part);
    if (missing) { current = next; continue; }
    try {
      fs.lstatSync(next);
    } catch (err) {
      if (err && err.code === "ENOENT") { current = next; missing = true; continue; }
      throw err;
    }
    // lstat succeeds for a broken symlink; realpath must remain a distinct
    // operation so that failure is never misclassified as a missing leaf.
    current = fs.realpathSync.native(next);
  }
  return current;
};

const normalizeSuffix = (parts) => {
  const normalized = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (normalized.length && normalized[normalized.length - 1] !== "..") normalized.pop();
      else normalized.push(part);
    } else normalized.push(part);
  }
  return normalized.join("/");
};

try {
  if (raw.includes("\0")) throw new Error("target contains NUL");
  const requestedAbsolute = path.isAbsolute(raw) ? raw : `${physicalRoot}/${raw}`;
  const parsed = path.parse(requestedAbsolute);
  const parts = requestedAbsolute.slice(parsed.root.length).split(path.sep);
  let prefix = parsed.root;
  let requested;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    prefix += (prefix.endsWith(path.sep) ? "" : path.sep) + part;
    if (resolveInFilesystemOrder(prefix) === physicalRoot) {
      const suffix = normalizeSuffix(parts.slice(index + 1));
      // A root-returning link inside an already protected requested suffix
      // is not another root spelling. Preserve that protected suffix.
      if (requested === undefined || (!requested.startsWith(".docs/") && requested !== ".docs")) {
        requested = suffix;
      }
    }
  }
  const resolved = resolveInFilesystemOrder(requestedAbsolute);
  // Task 1 applies the existing policy to the requested root-relative
  // spelling. Keeping resolved here makes the later dual-candidate policy
  // additive without ever treating an unresolvable destination as safe.
  void resolved;
  process.stdout.write(`ok:${requested === undefined ? "" : requested}`);
} catch {
  process.stdout.write("undeterminable");
}
' || true)"

if [ "$CLASSIFICATION" = "undeterminable" ]; then
  {
    echo "docs-guard: blocked write — target path could not be resolved safely while a build phase is active."
    echo "Marker: .pipeline/phase-active"
    echo "Remedy: if this write is intentional and allowlisted, no action needed; otherwise run 'rm .pipeline/phase-active' only if you are certain the phase should not be active."
  } >&2
  exit 2
fi

TARGET="${CLASSIFICATION#ok:}"

case "$TARGET" in
  .docs/*|.docs)
    # Allow-prefix bypass: any `allow: <prefix>` line in the marker exempts
    # targets that start with that literal prefix string. Prefixes are
    # written with a trailing slash (see writePhaseMarker), so a plain
    # `case`-glob prefix match is already directory-segment-boundary-safe:
    # '.docs/plans-archive/x.md' does not start with the literal string
    # '.docs/plans/', so it does not false-match the '.docs/plans/' allow.
    while IFS= read -r ALLOW_PREFIX; do
      case "$TARGET" in
        "$ALLOW_PREFIX"*)
          exit 0
          ;;
      esac
    done < <(sed -n 's/^allow: //p' "$MARKER_PATH")
    # Default-deny: no allow-prefix matched — block the write.
    STEP="$(sed -n 's/^step: //p' "$MARKER_PATH" | head -n1)"
    PHASE="$(sed -n 's/^phase: //p' "$MARKER_PATH" | head -n1)"
    STEP="${STEP:-unknown}"
    PHASE="${PHASE:-unknown}"
    {
      echo "docs-guard: blocked write to '$TARGET' during $PHASE phase (step: $STEP) - spec artifacts are frozen during BUILD/SHIP."
      echo "Marker: .pipeline/phase-active"
      echo "Remedy: if this write is intentional and allowlisted, no action needed; otherwise run 'rm .pipeline/phase-active' only if you are certain the phase should not be active."
    } >&2
    exit 2
    ;;
  *)
    exit 0
    ;;
esac
