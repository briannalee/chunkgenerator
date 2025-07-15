import { parentPort } from 'worker_threads';
import { WorldGenerator } from '../world/WorldGenerator';
import { ChunkData } from 'shared/ChunkTypes';
import Redis from 'ioredis';
import { TerrainPoint } from 'shared/TileTypes';
import { ResourceNode } from 'shared/ResourceTypes';

// Initialize Redis for worker-level caching
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const subClient = new Redis(REDIS_URL);

// Initialize world generator with the same seed for consistency
const worldGenerator = new WorldGenerator(12345);

// Subscribe to chunk invalidation broadcasts
subClient.subscribe('chunk_invalidate');
subClient.on('message', (channel, message) => {
  if (channel === 'chunk_invalidate') {
    const { x, y } = JSON.parse(message);
    const localKey = `chunk:${x},${y}`;

    // Delete from worker's local cache
    localCache.delete(localKey);
  }
});

// Worker-level cache for frequently accessed data
const localCache = new Map<string, ChunkData>();
const MAX_LOCAL_CACHE_SIZE = 100;

// Generate a chunk with realistic terrain
const generateTerrainUnit = async (
  x: number, // chunkX for chunk mode, or fixedCoord for row/column
  y: number, // chunkY for chunk mode, or startCoord for row/column
  mode: 'chunk' | 'row' | 'column'
): Promise<ChunkData> => {
  // Determine cache keys
  const localKey = `${mode}:${x},${y}`;

  // Check local in-memory cache first
  if (localCache.has(localKey)) {
    return localCache.get(localKey)!;
  }

  // Generate terrain
  let terrain: TerrainPoint[][];
  const chunkSize = 10;

  if (mode === 'chunk') {
    terrain = worldGenerator.generateChunk(x, y, chunkSize);
  } else if (mode === 'row') {
    const row = worldGenerator.generateTerrainLine(y, x, chunkSize, 'row');
    terrain = [row]; // 1 row
  } else {
    const col = worldGenerator.generateTerrainLine(x, y, chunkSize, 'column')
    terrain = col.map(pt => [pt]); // 1 column
  }

  // Record to store resources
  // We do not send with Tile data, tile data is primitive/enum types only
  const resources: Record<string, ResourceNode> = {};

  // Flatten terrain points into tile array
  const tiles: any[] = [];
  for (let row of terrain) {
    for (let point of row) {

      // First, extract resources (if any)
      if (point.r) {
        resources[`${point.x},${point.y}`] = point.r;
      }

      const h = Math.round(point.h * 100) / 100;
      const nH = Math.round(point.nH * 100) / 100;
      const t = Math.round(point.t * 100) / 100;
      const p = Math.round(point.p * 100) / 100;
      const stp = Math.round(point.stp * 100) / 100;
      const v = point.v ? Math.round(point.v * 100) / 100 : 0;

      tiles.push([
        point.x,
        point.y,
        h,
        nH,
        point.w ? 1 : 0,
        t,
        p,
        stp,
        point.b,
        point.c,
        point.iC ? 1 : 0,
        point.wT || 0,
        v,
        point.vT || 0,
        point.sT || 0,
      ]);
    }
  }

  const result: ChunkData = { x, y, tiles, terrain, mode, resources };

  // Cache everything locally in RAM
  setLocalCache(localKey, result);

  return result;
};

// Local cache management
function setLocalCache(key: string, chunk: ChunkData) {
  if (localCache.size >= MAX_LOCAL_CACHE_SIZE) {
    // Remove oldest entry (FIFO)
    const firstKey = localCache.keys().next().value;
    if (firstKey) {
      localCache.delete(firstKey);
    }
  }
  localCache.set(key, chunk);
}

// Listen for messages from the main thread
parentPort?.on('message', async (data) => {
  const { x, y, mode, requestId } = data;

  try {
    const chunk = await generateTerrainUnit(x, y, mode);
    parentPort?.postMessage({
      success: true,
      chunk,
      requestId
    });
  } catch (error) {
    parentPort?.postMessage({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId
    });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  subClient.quit();
  process.exit(0);
});