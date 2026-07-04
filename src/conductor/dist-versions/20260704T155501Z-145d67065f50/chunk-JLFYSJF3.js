// src/engine/restart-marker.ts
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
var RESTART_MARKER = ".daemon/RESTART-PENDING";
async function writeRestartPending(projectRoot, opts = {}) {
  await mkdir(join(projectRoot, ".daemon"), { recursive: true });
  const intent = {
    requestedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...opts.requestedBy !== void 0 ? { requestedBy: opts.requestedBy } : {},
    ...opts.blockingSlug !== void 0 ? { blockingSlug: opts.blockingSlug } : {}
  };
  await writeFile(join(projectRoot, RESTART_MARKER), JSON.stringify(intent, null, 2), "utf-8");
}
async function readRestartPending(projectRoot) {
  let raw;
  try {
    raw = await readFile(join(projectRoot, RESTART_MARKER), "utf-8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { requestedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
}

// src/engine/registry.ts
import { readFile as readFile2, writeFile as writeFile2, mkdir as mkdir2, rename, realpath } from "fs/promises";
import { existsSync } from "fs";
import { homedir } from "os";
import { join as join2, dirname, basename, isAbsolute, resolve as resolvePath } from "path";
var REGISTRY_DIR = ".ai-conductor";
var REGISTRY_FILE = "registry.json";
var SCHEMA_VERSION = 1;
function createRegistryReader(opts = {}) {
  function resolvedPath() {
    if (opts.registryPath) return opts.registryPath;
    return resolveRegistryPath({ home: opts.home, env: opts.env });
  }
  return {
    async listProjects() {
      return readRegistry(resolvedPath());
    },
    async getProject(p) {
      const records = await readRegistry(resolvedPath());
      const needle = await canonicalizePath(p);
      return records.find((r) => r.path === needle);
    }
  };
}
function resolveRegistryPath(args = {}) {
  const env = args.env ?? process.env;
  const override = env.AI_CONDUCTOR_REGISTRY;
  if (override && override.trim() !== "") {
    return override;
  }
  const home = args.home ?? homedir();
  if (!home || home.trim() === "") {
    throw new Error(
      "Cannot resolve registry path: no $AI_CONDUCTOR_REGISTRY override and home directory is unresolvable."
    );
  }
  return join2(home, REGISTRY_DIR, REGISTRY_FILE);
}
async function readRegistry(path) {
  if (!existsSync(path)) {
    return [];
  }
  const raw = await readFile2(path, "utf-8");
  if (raw.trim() === "") {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Registry at ${path} is corrupt (invalid JSON): ${e instanceof Error ? e.message : String(e)}`
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Registry at ${path} is corrupt: expected a JSON array of records.`);
  }
  return parsed;
}
async function writeRegistry(path, records) {
  await mkdir2(dirname(path), { recursive: true });
  const serialized = JSON.stringify(records, null, 2);
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile2(tmp, serialized, "utf-8");
  await rename(tmp, path);
}
async function canonicalizePath(p) {
  const abs = isAbsolute(p) ? p : resolvePath(p);
  try {
    return await realpath(abs);
  } catch {
    const parent = dirname(abs);
    const leaf = basename(abs);
    try {
      const realParent = await realpath(parent);
      return join2(realParent, leaf);
    } catch {
      return abs;
    }
  }
}
async function upsertProject(registryPath, record) {
  const records = await readRegistry(registryPath);
  const canonical = await canonicalizePath(record.path);
  const next = { ...record, path: canonical };
  const idx = records.findIndex((r) => r.path === canonical);
  if (idx === -1) {
    records.push(next);
  } else {
    const existing = records[idx];
    const status = existing.status === "created" ? "created" : next.status;
    records[idx] = { ...existing, ...next, status };
  }
  await writeRegistry(registryPath, records);
  return records;
}
function redactRemote(url) {
  if (!url) return url;
  const schemeMatch = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/]*@)?(.*)$/);
  if (schemeMatch) {
    const [, scheme, , rest] = schemeMatch;
    return `${scheme}${rest}`;
  }
  return url;
}

export {
  SCHEMA_VERSION,
  createRegistryReader,
  resolveRegistryPath,
  readRegistry,
  upsertProject,
  redactRemote,
  writeRestartPending,
  readRestartPending
};
//# sourceMappingURL=chunk-JLFYSJF3.js.map