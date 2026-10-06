// Covers: task:15, task:19
import { execFile as execFileCallback } from "node:child_process";
import { createServer, type Server } from "node:http";
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { BasicTracerProvider, type ReadableSpan } from "@opentelemetry/sdk-trace-base";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSpoolRuntime, resolveSpoolDir, warnDisabledSpoolBacklog, warnSpoolUnavailable } from "../../../src/engine/otel/spool-wiring.js";
import { buildExporters } from "../../../src/engine/otel/transport.js";
import { resolveOtelConfig } from "../../../src/engine/otel/otel-config.js";
import type { ConductorEventEmitter } from "../../../src/ui/events.js";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];
const servers: Server[] = [];
const DEFAULT_PROVENANCE = { commit: true, pr: true, issue: true, feature: true };
// The collector is fixture-owned; bypass the ambient test marker only for
// this direct construction, never by mutating process.env.
const loopbackOtelEnv: NodeJS.ProcessEnv = {};

async function endpoint(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve()));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP test-server address");
  return `http://127.0.0.1:${address.port}`;
}

function exportSpan(exporter: { export(spans: ReadableSpan[], callback: () => void): void }, span: ReadableSpan): Promise<void> {
  return new Promise((resolve) => exporter.export([span], resolve));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("resolveSpoolDir", () => {
  it("resolves referenced headers at drain time through the production runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spool-wiring-headers-"));
    temporaryDirectories.push(directory);
    const header = "OTEL_SPOOL_WIRING_HEADER";
    const previous = process.env[header];
    process.env[header] = "before";
    let received = "";
    const collector = createServer(async (request, response) => {
      received = String(request.headers.authorization);
      for await (const _chunk of request) { /* consume */ }
      response.writeHead(200).end();
    });
    const config = resolveOtelConfig({ otel: {
      exporter: "otlp", endpoint: await endpoint(collector), headers: { Authorization: { env: header } }, spool: { enabled: true },
    } }, join(directory, ".pipeline"));
    expect(config).toMatchObject({ enabled: true, exporter: "otlp" });
    if (!config.enabled || config.exporter !== "otlp") return;
    const runtime = createSpoolRuntime(directory, config);
    await runtime.store.write("traces", Buffer.from("batch"));
    process.env[header] = "after";
    const draining = runtime.drainer.drainUntilStopped();
    for (let turn = 0; turn < 1_000 && received === ''; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    await runtime.drainer.stop();
    await draining;
    expect(received).toBe("after");
    if (previous === undefined) delete process.env[header]; else process.env[header] = previous;
  });

  it("uses the linked worktree's main checkout for the durable spool", async () => {
    const root = await mkdtemp(join(tmpdir(), "spool-wiring-"));
    temporaryDirectories.push(root);
    const mainRoot = join(root, "main");
    const worktree = join(root, "linked-worktree");
    await mkdir(mainRoot, { recursive: true });

    await execFile("git", ["init", "--initial-branch=main", mainRoot]);
    await execFile("git", ["-C", mainRoot, "config", "user.email", "test@example.com"]);
    await execFile("git", ["-C", mainRoot, "config", "user.name", "Test User"]);
    await execFile("git", ["-C", mainRoot, "commit", "--allow-empty", "-m", "initial"]);
    await execFile("git", ["-C", mainRoot, "worktree", "add", "-b", "linked", worktree]);
    await mkdir(join(worktree, "src"));

    const spoolDir = await resolveSpoolDir(join(worktree, "src"));

    expect(spoolDir).toBe(join(mainRoot, ".daemon", "otel-spool"));
    expect(dirname(spoolDir!)).not.toBe(join(worktree, ".daemon"));

    const secret = "linked-worktree-secret";
    const header = "OTEL_SPOOL_WIRING_WORKTREE_HEADER";
    const previous = process.env[header];
    process.env[header] = secret;
    const received: Buffer[] = [];
    const collector = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks));
      response.writeHead(200).end();
    });
    const config = resolveOtelConfig({ otel: {
      exporter: "otlp", endpoint: await endpoint(collector), headers: { Authorization: { env: header } },
    } }, join(worktree, ".pipeline"));
    if (!config.enabled || config.exporter !== "otlp") throw new Error("expected OTLP configuration");
    const runtime = createSpoolRuntime(spoolDir!, config);
    const provider = new BasicTracerProvider();
    const span = provider.getTracer("spool-wiring-test").startSpan("survives-worktree-removal");
    span.end();
    await exportSpan(buildExporters(config, { spoolStore: runtime.store, env: loopbackOtelEnv }).spanExporter, span as unknown as ReadableSpan);
    const [batch] = await runtime.store.list("traces");
    expect(batch).toBeDefined();
    if (!batch) throw new Error("expected spooled traces batch");

    await execFile("git", ["-C", mainRoot, "worktree", "remove", "--force", worktree]);
    await expect(access(batch.path)).resolves.toBeUndefined();

    const scan = async (directory: string): Promise<Array<{ name: string; content: string }>> => {
      const entries = await readdir(directory, { withFileTypes: true });
      return (await Promise.all(entries.map(async (entry) => entry.isDirectory()
        ? scan(join(directory, entry.name))
        : [{ name: join(directory, entry.name), content: await readFile(join(directory, entry.name), "utf8") }]
      ))).flat();
    };
    await runtime.lease.acquire();
    for (const file of await scan(spoolDir!)) {
      expect(file.name).not.toContain(secret);
      expect(file.content).not.toContain(secret);
    }
    const draining = runtime.drainer.drainUntilStopped();
    for (let turn = 0; turn < 1_000 && (received.length === 0 || (await runtime.store.list("traces")).length !== 0); turn += 1) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await runtime.drainer.stop();
    await draining;
    await runtime.lease.release();
    if (previous === undefined) delete process.env[header]; else process.env[header] = previous;

    expect(received).toHaveLength(1);
    expect(await runtime.store.list("traces")).toEqual([]);
  });

  it("disables the spool and warns once when no main checkout can be resolved", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spool-wiring-non-git-"));
    temporaryDirectories.push(directory);
    const emit = vi.fn().mockResolvedValue(undefined);
    const events = { emit } as unknown as ConductorEventEmitter;
    warnSpoolUnavailable(directory, events);
    warnSpoolUnavailable(directory, events);

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("leaves a disabled spool untouched and warns once with its path and size", async () => {
    const root = await mkdtemp(join(tmpdir(), "spool-wiring-disabled-"));
    temporaryDirectories.push(root);
    await execFile("git", ["init", "--initial-branch=main", root]);
    const spoolDir = join(root, ".daemon", "otel-spool");
    await mkdir(spoolDir, { recursive: true });
    await Promise.all([
      writeFile(join(spoolDir, "one.json"), "a"),
      writeFile(join(spoolDir, "two.json"), "bb"),
      writeFile(join(spoolDir, "three.json"), "ccc"),
    ]);
    const before = await Promise.all(["one.json", "two.json", "three.json"].map((file) => readFile(join(spoolDir, file))));
    const emit = vi.fn().mockResolvedValue(undefined);
    const events = { emit } as unknown as ConductorEventEmitter;
    const config = {
      enabled: true as const,
      exporter: "otlp" as const,
      endpoint: "http://localhost:4318",
      spool: { enabled: false, maxBytes: 1024 },
      provenance: DEFAULT_PROVENANCE,
    };

    await warnDisabledSpoolBacklog(config, root, events);
    await warnDisabledSpoolBacklog(config, root, events);

    expect(await Promise.all(["one.json", "two.json", "three.json"].map((file) => readFile(join(spoolDir, file))))).toEqual(before);
    expect(emit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      type: "renderer_error",
      rendererName: "otel",
      error: expect.stringContaining(spoolDir),
    }));
    expect(emit.mock.calls[0]![0].error).toContain("6");
  });

  it("exports directly without creating a spool when disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "spool-wiring-direct-"));
    temporaryDirectories.push(root);
    await execFile("git", ["init", "--initial-branch=main", root]);
    let received = 0;
    const collector = createServer(async (request, response) => {
      for await (const _chunk of request) { /* consume request */ }
      received += 1;
      response.writeHead(200).end();
    });
    const config = {
      enabled: true as const,
      exporter: "otlp" as const,
      endpoint: await endpoint(collector),
      spool: { enabled: false, maxBytes: 1024 },
      provenance: DEFAULT_PROVENANCE,
    };
    const provider = new BasicTracerProvider();
    const span = provider.getTracer("spool-wiring-test").startSpan("direct-disabled-spool");
    span.end();

    const exporters = buildExporters(config, { env: loopbackOtelEnv });
    await exportSpan(exporters.spanExporter, span as unknown as ReadableSpan);

    expect(received).toBe(1);
    await expect(access(join(root, ".daemon", "otel-spool"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps file exporter output byte-identical without creating a spool", async () => {
    const root = await mkdtemp(join(tmpdir(), "spool-wiring-file-"));
    temporaryDirectories.push(root);
    await execFile("git", ["init", "--initial-branch=main", root]);
    const directPath = join(root, "direct.jsonl");
    const wiredPath = join(root, "wired.jsonl");
    const provider = new BasicTracerProvider();
    const span = provider.getTracer("spool-wiring-test").startSpan("file-is-unspooled");
    span.end();
    const directConfig = {
      enabled: true as const, exporter: "file" as const, file: directPath, provenance: DEFAULT_PROVENANCE,
    };
    const wiredConfig = {
      enabled: true as const, exporter: "file" as const, file: wiredPath, provenance: DEFAULT_PROVENANCE,
    };

    await exportSpan(buildExporters(directConfig).spanExporter, span as unknown as ReadableSpan);
    await exportSpan(buildExporters(wiredConfig).spanExporter, span as unknown as ReadableSpan);

    expect(await readFile(wiredPath)).toEqual(await readFile(directPath));
    await expect(access(join(root, ".daemon", "otel-spool"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
