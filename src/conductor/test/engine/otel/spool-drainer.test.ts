// Covers: task:10
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpoolDrainer } from '../../../src/engine/otel/spool-drainer.js';
import { SpoolStore } from '../../../src/engine/otel/spool-store.js';

const directories: string[] = [];
const servers: Server[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'otel-spool-drainer-'));
  directories.push(directory);
  return directory;
}

function listen(server: Server, port = 0): Promise<string> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('expected a TCP test-server address');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function reserveEndpoint(): Promise<number> {
  const server = createServer();
  const endpoint = await listen(server);
  await close(server);
  servers.splice(servers.indexOf(server), 1);
  return Number(new URL(endpoint).port);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => close(server)));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('SpoolDrainer', () => {
  it('posts three traces batches oldest-first after the closed endpoint starts, then deletes each accepted batch', async () => {
    const reservedPort = await reserveEndpoint();
    let now = 1_727_000_000_000;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    const oldest = await store.write('traces', Buffer.from('oldest-trace-protobuf'));
    now += 1;
    const middle = await store.write('traces', Buffer.from('middle-trace-protobuf'));
    now += 1;
    const newest = await store.write('traces', Buffer.from('newest-trace-protobuf'));
    const received: Array<{ path: string; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push({ path: request.url ?? '', body: Buffer.concat(chunks) });
      response.writeHead(200).end();
    });
    const endpoint = await listen(server, reservedPort);

    await new SpoolDrainer(store, { endpoint, headers: () => ({}) }).drain();

    expect({
      received: received.map(({ path, body }) => ({ path, body: body.toString() })),
      remaining: await store.list('traces'),
      written: [oldest.name, middle.name, newest.name],
    }).toEqual({
      received: [
        { path: '/v1/traces', body: 'oldest-trace-protobuf' },
        { path: '/v1/traces', body: 'middle-trace-protobuf' },
        { path: '/v1/traces', body: 'newest-trace-protobuf' },
      ],
      remaining: [],
      written: expect.arrayContaining([oldest.name, middle.name, newest.name]),
    });
  });

  it('sends both signals with protobuf content type and headers resolved when draining', async () => {
    const received: Array<{ path: string; contentType: string | undefined; authorization: string | undefined; body: Buffer }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push({
        path: request.url ?? '',
        contentType: request.headers['content-type'],
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks),
      });
      response.writeHead(200).end();
    });
    const endpoint = await listen(server);
    const store = new SpoolStore(await temporaryDirectory());
    await store.write('traces', Buffer.from('trace-protobuf'));
    await store.write('metrics', Buffer.from('metric-protobuf'));
    let apiKey = 'value-at-spool-time';
    const drainer = new SpoolDrainer(store, {
      endpoint,
      headers: () => ({ authorization: `Bearer ${apiKey}` }),
    });
    apiKey = 'value-at-drain-time';

    await drainer.drain();

    expect(received).toEqual(expect.arrayContaining([
      { path: '/v1/traces', contentType: 'application/x-protobuf', authorization: 'Bearer value-at-drain-time', body: Buffer.from('trace-protobuf') },
      { path: '/v1/metrics', contentType: 'application/x-protobuf', authorization: 'Bearer value-at-drain-time', body: Buffer.from('metric-protobuf') },
    ]));
  });

  it('posts a days-old spool body without a local age check', async () => {
    const received: Buffer[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks));
      response.writeHead(200).end();
    });
    const endpoint = await listen(server);
    const daysOld = 1_727_000_000_000 - (7 * 24 * 60 * 60 * 1_000);
    const store = new SpoolStore(await temporaryDirectory(), { now: () => daysOld });
    const batch = await store.write('traces', Buffer.from('days-old-protobuf-body'));

    await new SpoolDrainer(store, { endpoint, headers: () => ({}) }).drain();

    expect({ received, remaining: await store.list('traces'), batch: batch.name }).toEqual({
      received: [Buffer.from('days-old-protobuf-body')], remaining: [], batch: expect.any(String),
    });
  });

  it('redelivers exactly once after an accepted batch is left behind by a crash, then continues', async () => {
    const received: string[] = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      received.push(Buffer.concat(chunks).toString());
      response.writeHead(200).end();
    });
    const endpoint = await listen(server);
    let now = 1_727_000_000_000;
    const store = new SpoolStore(await temporaryDirectory(), { now: () => now });
    const acceptedButUndeleted = await store.write('traces', Buffer.from('accepted-before-crash'));
    now += 1;
    await store.write('traces', Buffer.from('next-batch'));
    const crashBeforeDelete = Object.assign(Object.create(store) as SpoolStore, {
      delete: async () => { throw new Error('simulated crash after accept before delete'); },
    });

    await expect(new SpoolDrainer(crashBeforeDelete, { endpoint, headers: () => ({}) }).drain())
      .rejects.toThrow('simulated crash after accept before delete');
    await new SpoolDrainer(store, { endpoint, headers: () => ({}) }).drain();

    expect({
      received,
      acceptedReceipts: received.filter((body) => body === 'accepted-before-crash'),
      remaining: await store.list('traces'),
      acceptedButUndeleted: acceptedButUndeleted.name,
    }).toEqual({
      received: ['accepted-before-crash', 'accepted-before-crash', 'next-batch'],
      acceptedReceipts: ['accepted-before-crash', 'accepted-before-crash'],
      remaining: [],
      acceptedButUndeleted: expect.any(String),
    });
  });
});
