import { parentPort } from 'worker_threads';
import Redis from 'ioredis';
import { ChunkData } from '../models/Chunk';

const redis = new Redis();

async function findChunk(x: number, y: number): Promise<ChunkData | null> {
  const key = `db:chunk:${x}:${y}`;
  const data = await redis.get(key);
  if (!data) return null;
  const parsed = JSON.parse(data);
  return {
    x,
    y,
    tiles: parsed.tiles,
    terrain: parsed.terrain || []
  };
}

async function saveChunk(chunk: ChunkData): Promise<void> {
  const key = `db:chunk:${chunk.x}:${chunk.y}`;
  await redis.set(key, JSON.stringify({
    tiles: chunk.tiles,
    terrain: chunk.terrain || []
  }));
}

// No batching needed for Redis

// Handle messages from main thread
parentPort?.on('message', async (data) => {
  const { type, x, y, chunk, requestId } = data;
  
  if (type === 'find') {
    try {
      const result = await findChunk(x, y);
      parentPort?.postMessage({ success: true, result, requestId });
    } catch (error) {
      parentPort?.postMessage({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId 
      });
    }
  } else if (type === 'save') {
    try {
      await saveChunk(chunk);
      parentPort?.postMessage({ success: true, requestId });
    } catch (error) {
      parentPort?.postMessage({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error',
        requestId 
      });
    }
  }
});

// No need for Redis
