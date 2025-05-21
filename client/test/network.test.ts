// test/network.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NetworkFactory } from '../src/network/NetworkFactory';
import { INetworkAdapter } from '../src/network/INetworkAdapter';

// Test configuration
const TEST_TIMEOUT = 5000; // 5 seconds timeout per test
const TEST_WEBTRANSPORT = false; // Set to true to test WebTransport, if implemented

describe('Real Network Adapter Tests', () => {
  let adapter: INetworkAdapter;

  beforeAll(() => {
    adapter = NetworkFactory.createAdapter(TEST_WEBTRANSPORT);
  });

  afterAll(() => {
    adapter.disconnect();
  });

  it('should connect to the real server', async () => {
    await expect(adapter.connect()).resolves.toBeUndefined();
    expect(adapter.readyState).toBe('open');
  }, TEST_TIMEOUT);

  it('should receive "connected" message after handshake', async () => {
    const response = await new Promise(resolve => {
      adapter.onMessage(data => resolve(data));
      adapter.send({ type: 'handshake' }); 
    });

    expect(response).toMatchObject({
      type: 'connected',
      id: expect.any(String),
      players: expect.anything()
    });
  }, TEST_TIMEOUT);

  it('should request and receive chunk data', async () => {
    const response = await new Promise(resolve => {
      adapter.onMessage((data: unknown) => {
        if (typeof data === 'object' && data !== null && 'type' in data && (data as any).type === 'chunkData') {
          resolve(data);
        }
      });
      adapter.send({ type: 'requestChunk', x: 0, y: 0 }); // Request test chunk
    });

    expect(response).toMatchObject({
      type: 'chunkData',
      chunk: {
        x: expect.any(Number),
        y: expect.any(Number),
        tiles: expect.any(Array)
      }
    });
  }, TEST_TIMEOUT);
});