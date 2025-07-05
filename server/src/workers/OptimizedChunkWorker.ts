import { parentPort } from 'worker_threads';
import { WorldGenerator } from '../world/WorldGenerator';
import { ChunkData } from 'shared/ChunkTypes';
import Redis from 'ioredis';
import { TerrainPoint } from 'shared/TileTypes';
import {
  ResourceNode, ResourceType,
  BiomeResourceMap, BiomeResourceDensity,
  BiomeResourceSettings, BiomeResourceProbabilities,
  ResourceHardnessRange, ResourceAmountRange,
  ResourceAmountBiomeMultipliers
} from 'shared/ResourceTypes';
import { Biome } from 'shared/TerrainTypes';

// Initialize Redis for worker-level caching
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const subClient = new Redis(REDIS_URL);
const STEEP_CUTOFF = BiomeResourceSettings.STEEP_CUTOFF;

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

  // Flatten terrain points into tile array
  const tiles: any[] = [];
  const resources: Record<string, ResourceNode> = {};

  for (let row of terrain) {
    for (let point of row) {
      const h = Math.round(point.h * 100) / 100;
      const nH = Math.round(point.nH * 100) / 100;
      const t = Math.round(point.t * 100) / 100;
      const p = Math.round(point.p * 100) / 100;
      const stp = Math.round(point.stp * 100) / 100;
      const v = point.v ? Math.round(point.v * 100) / 100 : 0;

      // Create tile data (primitives only)
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

      // Extract and store resources separately
      if (point.r) {
        const key = `${point.x},${point.y}`;
        resources[key] = point.r;
      }
    }
  }

  // Add generated resources after post-processing
  if (mode === 'chunk') {
    const generatedResources = placeResources(terrain, x, y, chunkSize);
    Object.assign(resources, generatedResources);
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

// Main resource generation function
const placeResources = (terrain: TerrainPoint[][], chunkX: number, chunkY: number, chunkSize: number): Record<string, ResourceNode> => {
  const resources: Record<string, ResourceNode> = {};
  const suitableTiles: Array<TerrainPoint & { worldX: number, worldY: number }> = [];

  // Collect suitable tiles for resource placement
  for (let y = 0; y < chunkSize; y++) {
    for (let x = 0; x < chunkSize; x++) {
      const point = terrain[y][x];

      // Rules for suitable tiles:
      // A. Not cliff, not steep, not ocean, not water (except for lake/river water)
      // B. For lake and river biomes, always place water
      // C. For forest, jungle, dense forest, place guaranteed resources if not cliff/steep

      const worldX = chunkX * chunkSize + x;
      const worldY = chunkY * chunkSize + y;

      if (
        !point.iC && // not cliff
        point.stp <= STEEP_CUTOFF && // not steep
        !point.w // not water (lake/river will be handled separately)
      ) {
        suitableTiles.push({ ...point, worldX, worldY });
      }
    }
  }

  // Handle lake/river water resources
  suitableTiles.forEach((point) => {
    if (point.b === Biome.LAKE || point.b === Biome.RIVER) {
      const key = `${point.worldX},${point.worldY}`;
      if (!resources[key]) {
        resources[key] = {
          type: ResourceType.Water,
          amount: getRandomAmount(ResourceType.Water, terrain),
          remaining: getRandomAmount(ResourceType.Water, terrain),
          hardness: getRandomHardness(ResourceType.Water),
          x: point.worldX,
          y: point.worldY
        };
      }
    }
  });

  // Handle guaranteed resources for specific biomes
  suitableTiles.forEach((point) => {
    if (
      point.b === Biome.FOREST ||
      point.b === Biome.JUNGLE ||
      point.b === Biome.DENSE_FOREST
    ) {
      const key = `${point.worldX},${point.worldY}`;
      if (!resources[key] && Math.random() < 0.3) { // 30% chance for guaranteed resource
        const resourceType = getGuaranteedResource(point.b);
        if (resourceType) {
          resources[key] = {
            type: resourceType,
            amount: getRandomAmount(resourceType, terrain),
            remaining: getRandomAmount(resourceType, terrain),
            hardness: getRandomHardness(resourceType),
            x: point.worldX,
            y: point.worldY
          };
        }
      }
    }
  });

  // Handle random resource placement
  const avgDensity = BiomeResourceDensity[terrain[0][0].b] || 0.5;
  const maxResources = Math.floor(avgDensity * BiomeResourceSettings.MAX_MULTIPLIER);
  const targetResources = Math.max(BiomeResourceSettings.MIN, maxResources);

  let placedRandom = 0;
  const availableTiles = suitableTiles.filter(tile => !resources[`${tile.worldX},${tile.worldY}`]);

  // Try to place random resources
  for (let i = 0; i < targetResources && placedRandom < targetResources && availableTiles.length > 0; i++) {
    const tile = availableTiles[Math.floor(Math.random() * availableTiles.length)];
    const key = `${tile.worldX},${tile.worldY}`;

    if (!resources[key]) {
      const resourceType = getRandomResource(tile.b);
      if (resourceType) {
        resources[key] = {
          type: resourceType,
          amount: getRandomAmount(resourceType, terrain),
          remaining: getRandomAmount(resourceType, terrain),
          hardness: getRandomHardness(resourceType),
          x: tile.worldX,
          y: tile.worldY
        };
        placedRandom++;
      }
    }
  }

  // Fallback linear search if random placement fails
  if (placedRandom < targetResources && availableTiles.length > 0) {
    for (const tile of availableTiles) {
      const key = `${tile.worldX},${tile.worldY}`;
      if (!resources[key]) {
        const resourceType = getRandomResource(tile.b);
        if (resourceType) {
          resources[key] = {
            type: resourceType,
            amount: getRandomAmount(resourceType, terrain),
            remaining: getRandomAmount(resourceType, terrain),
            hardness: getRandomHardness(resourceType),
            x: tile.worldX,
            y: tile.worldY
          };
          placedRandom++;
          if (placedRandom >= targetResources) break;
        }
      }
    }
  }

  return resources;
};

const getRandomResource = (biome: Biome): ResourceType | null => {
  if (!BiomeResourceMap[biome] || BiomeResourceMap[biome].length === 0) return null;
  return BiomeResourceMap[biome][Math.floor(Math.random() * BiomeResourceMap[biome].length)];
};

const getGuaranteedResource = (biome: Biome): ResourceType | null => {
  if (!BiomeResourceProbabilities[biome]) return null;
  const probabilities = BiomeResourceProbabilities[biome];
  const rand = Math.random();
  for (const [type, prob] of probabilities) {
    if (rand < prob) {
      return type;
    }
  }
  return null;
};

const getRandomAmount = (type: ResourceType, terrain: TerrainPoint[][]): number => {
  const baseRange = ResourceAmountRange[type];
  if (!baseRange) return 10;

  // Apply biome multipliers if available
  const multipliers = ResourceAmountBiomeMultipliers[terrain[0][0].b] || {};
  const multiplier = multipliers[type] || 1.0;

  const min = Math.floor(baseRange[0] * multiplier);
  const max = Math.floor(baseRange[1] * multiplier);

  return Math.floor(Math.random() * (max - min) + min);
};

const getRandomHardness = (type: ResourceType): number => {
  const range = ResourceHardnessRange[type];
  if (!range) return 0.5;
  return Math.random() * (range[1] - range[0]) + range[0];
};

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