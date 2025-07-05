import { Biome } from "./TerrainTypes";

export enum ResourceType {
  Iron = 'iron',
  Gold = 'gold',
  Coal = 'coal',
  Stone = 'stone',
  Wood = 'wood',
  Crystal = 'crystal',
  Oil = 'oil',
  Water = 'water'
}

export interface ResourceNode {
  type: ResourceType;
  amount: number;       // Total available amount
  remaining: number;    // Current remaining amount
  hardness: number;     // Mining difficulty (0-1)
  x: number;            // World X position
  y: number;            // World Y position
  respawnTime?: number; // Time in ms until respawn
}

export const BiomeResourceMap: Partial<Record<Biome, readonly ResourceType[]>> = {
  [Biome.MOUNTAIN]: [ResourceType.Iron, ResourceType.Stone, ResourceType.Coal],
  [Biome.MOUNTAIN_SNOW]: [ResourceType.Iron, ResourceType.Stone, ResourceType.Coal],
  [Biome.DESERT]: [ResourceType.Stone, ResourceType.Oil, ResourceType.Crystal],
  [Biome.TUNDRA]: [ResourceType.Stone, ResourceType.Coal, ResourceType.Iron],
  [Biome.GRASSLAND]: [ResourceType.Wood, ResourceType.Stone, ResourceType.Coal, ResourceType.Iron],
  [Biome.BEACH]: [ResourceType.Stone],
}

export const BiomeResourceDensity: Partial<Record<Biome, number>> = {
  [Biome.LAKE]: 1,
  [Biome.RIVER]: 1,
  [Biome.MOUNTAIN]: 0.8,
  [Biome.MOUNTAIN_SNOW]: 0.8,
  [Biome.FOREST]: 1,
  [Biome.JUNGLE]: 1,
  [Biome.DENSE_FOREST]: 1,
  [Biome.DESERT]: 0.5,
  [Biome.TUNDRA]: 0.3,
  [Biome.GRASSLAND]: 0.5,
  [Biome.SAVANNA]: 0.5,
  [Biome.BEACH]: 0.2,
  [Biome.OCEAN_SHALLOW]: 0.1,
  [Biome.OCEAN_DEEP]: 0.0
};

export const BiomeResourceSettings = {
  MIN: 2,
  MAX_MULTIPLIER: 15,
  STEEP_CUTOFF: 0.8,
  STEEP_HARDNESS_CUTOFF: 0.5,
  STEEP_HARDNESS_DIFFICULTY: 0.1
} as const;

export type ResourceProbabilities = readonly [ResourceType, number][];

// Example: For MOUNTAIN, if rand < 0.5 => Iron; if rand < 0.8 => Stone; else Coal
export const BiomeResourceProbabilities: Partial<Record<Biome, ResourceProbabilities>> = {
  [Biome.MOUNTAIN]: [
    [ResourceType.Iron, 0.5],
    [ResourceType.Stone, 0.8],
    [ResourceType.Coal, 1.0],
  ],
  [Biome.MOUNTAIN_SNOW]: [
    [ResourceType.Iron, 0.5],
    [ResourceType.Stone, 0.8],
    [ResourceType.Coal, 1.0],
  ],
  [Biome.DESERT]: [
    [ResourceType.Stone, 0.7],
    [ResourceType.Oil, 0.9],
    [ResourceType.Crystal, 1.0],
  ],
  [Biome.TUNDRA]: [
    [ResourceType.Stone, 0.6],
    [ResourceType.Coal, 0.9],
    [ResourceType.Iron, 1.0],
  ],
  [Biome.GRASSLAND]: [
    [ResourceType.Wood, 0.5],
    [ResourceType.Stone, 0.8],
    [ResourceType.Coal, 0.95],
    [ResourceType.Iron, 1.0],
  ],
  [Biome.SAVANNA]: [
    [ResourceType.Wood, 0.5],
    [ResourceType.Stone, 0.8],
    [ResourceType.Coal, 0.95],
    [ResourceType.Iron, 1.0],
  ],
  [Biome.BEACH]: [
    [ResourceType.Stone, 1.0],
  ],
  [Biome.FOREST]: [
    [ResourceType.Wood, 0.8],
    [ResourceType.Coal, 0.9],
    [ResourceType.Iron, 1.0],
  ],
  [Biome.DENSE_FOREST]: [
    [ResourceType.Wood, 0.8],
    [ResourceType.Coal, 0.9],
    [ResourceType.Iron, 1.0],
  ],
  [Biome.JUNGLE]: [
    [ResourceType.Wood, 0.8],
    [ResourceType.Coal, 0.9],
    [ResourceType.Iron, 1.0],
  ],
};

export const ResourceHardnessRange: Record<ResourceType, readonly [number, number]> = {
  [ResourceType.Wood]: [0.1, 0.2],
  [ResourceType.Stone]: [0.5, 0.7],
  [ResourceType.Iron]: [0.7, 0.8],
  [ResourceType.Gold]: [0.8, 0.9],
  [ResourceType.Coal]: [0.4, 0.6],
  [ResourceType.Crystal]: [0.9, 1.0],
  [ResourceType.Oil]: [0.6, 0.8],
  [ResourceType.Water]: [0.0, 0.1],
} as const;

export const ResourceRespawnRange: Partial<Record<ResourceType, readonly [number, number]>> = {
  [ResourceType.Wood]: [1_800_000, 3_600_000],       // 30m to 1h
  [ResourceType.Stone]: [3_600_000, 7_200_000],      // 1h to 2h
  [ResourceType.Iron]: [7_200_000, 14_400_000],      // 2h to 4h
  [ResourceType.Gold]: [14_400_000, 28_800_000],     // 4h to 8h
  [ResourceType.Coal]: [5_400_000, 10_800_000],      // 1.5h to 3h
  [ResourceType.Crystal]: [21_600_000, 43_200_000],  // 6h to 12h
  [ResourceType.Oil]: [10_800_000, 21_600_000],      // 3h to 6h
  // Water has no respawn
};

export const ResourceAmountRange: Record<ResourceType, readonly [number, number]> = {
  [ResourceType.Wood]: [50, 100],
  [ResourceType.Stone]: [30, 60],
  [ResourceType.Iron]: [20, 40],
  [ResourceType.Gold]: [10, 20],
  [ResourceType.Coal]: [40, 80],
  [ResourceType.Crystal]: [5, 15],
  [ResourceType.Oil]: [15, 30],
  [ResourceType.Water]: [100, 200],
} as const;

export const ResourceAmountBiomeMultipliers: Partial<Record<Biome, Partial<Record<ResourceType, number>>>> = {
  [Biome.MOUNTAIN]: {
    [ResourceType.Iron]: 1.5,
    [ResourceType.Stone]: 1.5,
    [ResourceType.Crystal]: 1.5,
  },
  [Biome.MOUNTAIN_SNOW]: {
    [ResourceType.Iron]: 1.5,
    [ResourceType.Stone]: 1.5,
    [ResourceType.Crystal]: 1.5,
  },
  [Biome.JUNGLE]: {
    [ResourceType.Wood]: 1.3,
  },
  [Biome.DESERT]: {
    [ResourceType.Oil]: 1.2,
    [ResourceType.Crystal]: 1.2,
  },
};