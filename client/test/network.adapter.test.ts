// test/network.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NetworkFactory } from '../src/network/NetworkFactory';
import { INetworkAdapter } from '../src/network/INetworkAdapter'

// Test configuration
const TEST_TIMEOUT = 5000; // 5 seconds timeout per test

describe('WebSocket Network Adapter Tests', () => {
  let adapter: INetworkAdapter;

  beforeAll(() => {
    adapter = NetworkFactory.createAdapter();
  });

  afterAll(async () => {
    await adapter.disconnect();
    await new Promise(resolve => setTimeout(resolve, 300)); // Cleanup delay
  });

  it('should connect to the real server', async () => {
    await expect(adapter.connect()).resolves.toBeUndefined();
    expect(adapter.readyState.toLowerCase()).toBe('open');
  }, TEST_TIMEOUT);

  it('should receive "connected" message after handshake', async () => {
    await adapter.connect();
    const response = await waitForMessage(adapter, 'connected');
    expect(response).toMatchObject({
      type: 'connected',
      id: expect.any(String),
    });
  });

  it('should receive "handshook" message', async () => {
    adapter.send({ type: 'handshake' });
    const handshakeResponse = await waitForMessage(adapter, 'handshook');
    expect(handshakeResponse).toMatchObject({ type: 'handshook' });
  });

  it('should request and receive chunk data', async () => {
    adapter.send({ type: 'requestChunk', x: 0, y: 0 });
    const response = await waitForMessage(adapter, 'chunkData');
    expect(response).toMatchObject({
      type: 'chunkData',
      chunk: {
        x: expect.any(Number),
        y: expect.any(Number),
        tiles: expect.any(Array)
      }
    });
  });
});

function waitForMessage<T = any>(
  adapter: INetworkAdapter,
  type: string,
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (data: any) => {
      if (data?.type === type) {
        adapter.offMessage?.(handler);
        resolve(data);
      }
    };
    adapter.onMessage(handler);

    setTimeout(() => {
      adapter.offMessage?.(handler);
      reject(new Error(`Timed out waiting for message of type "${type}"`));
    }, timeout);
  });
}