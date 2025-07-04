import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GameLogic } from "../logic/GameLogic";
import { BiomeResourceDensity, BiomeResourceMap, BiomeResourceSettings, ResourceAmountBiomeMultipliers, ResourceAmountRange, ResourceHardnessRange, ResourceRespawnRange, ResourceType } from 'shared/ResourceTypes';
import { Biome } from 'shared/TerrainTypes'
import { LandTile, Tile } from 'shared/TileTypes';

describe("Resource Generation System (Live Server Tests)", () => {
  let gameLogic: GameLogic;
  let testChunks: any[] = [];

  // Define hardcoded test chunk coordinates for coverage of various map areas
  let chunkCoordinates = [
    { x: 0, y: 0 },   // Origin
    { x: 5, y: 5 },   // Distant chunk
    { x: -3, y: 2 },  // Negative coordinates
    { x: 10, y: -7 }, // Mixed coordinates
    { x: 0, y: 15 },  // Far chunk
    { x: -1, y: -1 }, // All ocean
    { x: 1, y: -1 }
  ];

  beforeAll(async () => {
    gameLogic = new GameLogic();
    await gameLogic.connect();

    // Request each chunk
    await Promise.all(
      chunkCoordinates.flatMap(({ x, y }) => [
        gameLogic.requestChunk(x, y, 'chunk'),
      ])
    );

    // Wait for all chunk requests to be processed
    await new Promise(resolve => setTimeout(resolve, 500));

    chunkCoordinates.forEach(coords => {
      const chunkKey = `${coords.x},${coords.y}`;
      testChunks.push(gameLogic.chunks[`${coords.x},${coords.y}`]);
    })
  }, 30000);

  afterAll(async () => {
    await gameLogic.disconnect();
  });

  describe("Guaranteed Resource Placement", () => {
    it("should place correct resources in appropriate biomes", () => {
      for (const chunk of testChunks) {
        for (const tile of chunk.tiles) {
          // Lake and river tiles always get water, no slope/cliff check
          if (tile.b === Biome.LAKE || tile.b === Biome.RIVER) {
            expect(tile.r).toBeDefined();
            expect(tile.r!.type).toBe(ResourceType.Water);
            continue;
          }

          const isForest =
            tile.b === Biome.FOREST ||
            tile.b === Biome.JUNGLE ||
            tile.b === Biome.DENSE_FOREST;

          const isSteepOrCliff = tile.iC || tile.stp > BiomeResourceSettings.STEEP_CUTOFF;

          if (isForest && !isSteepOrCliff) {
            expect(tile.r).toBeDefined();
            expect([
              ResourceType.Wood,
              ResourceType.Coal,
              ResourceType.Iron,
            ]).toContain(tile.r!.type);
          }
        }
      }
    });
  });

  describe("Resource Placement Constraints", () => {
    it("should never place resources on cliffs", () => {
      for (const chunk of testChunks) {
        expect(chunk).toBeDefined();
        for (const tile of chunk.tiles) {
          if (isLandTile(tile) && tile.iC) {
            expect(tile.r).toBeUndefined();
          }
        }
      }
    });

    it("should never place resources on steep terrain", () => {
      for (const chunk of testChunks) {
        expect(chunk).toBeDefined();
        for (const tile of chunk.tiles) {
          if (tile.stp > BiomeResourceSettings.STEEP_CUTOFF) {
            expect(tile.r).toBeUndefined();
          }
        }
      }
    });
  });

  describe("Biome-Specific Resource Distribution", () => {
    Object.entries(BiomeResourceMap).forEach(([biomeStr, expectedTypes]) => {
      const biome = parseInt(biomeStr) as Biome;
      it(`should only place ${expectedTypes.join(',')} in ${Biome[biome]} biome`, () => {
        for (const chunk of testChunks) {
          if (!chunk) continue;
          chunk.tiles.forEach((tile: Tile) => {
            if (tile.b === biome && tile.r) {
              expect(expectedTypes).toContain(tile.r.type);
            }
          });
        }
      });
    });
  });

  describe("Resource Density", () => {
    it("should maintain correct resource density", () => {
      for (const chunk of testChunks) {
        const tiles = chunk.tiles;

        let guaranteed = 0;
        let excluded = 0;
        let biomeDensitySum = 0;

        for (const t of tiles) {
          const isWater = t.b === Biome.LAKE || t.b === Biome.RIVER;
          const isForest = t.b === Biome.FOREST || t.b === Biome.JUNGLE || t.b === Biome.DENSE_FOREST;
          const isOcean = t.b === Biome.OCEAN_DEEP || t.b === Biome.OCEAN_SHALLOW;
          const isCliffOrSteep = t.iC || t.stp > BiomeResourceSettings.STEEP_CUTOFF;
          const isUnplaceable = t.w || isCliffOrSteep || isOcean;

          if (isUnplaceable) {
            excluded++;
            continue;
          }

          if (isWater || isForest) {
            guaranteed++;
          }

          biomeDensitySum += BiomeResourceDensity[t.b as Biome] ?? 0.5;
        }

        const eligible = tiles.length - excluded;
        const avgDensity = eligible > 0 ? biomeDensitySum / eligible : 0.5;

        const actualCount = tiles.filter((t: Tile) => t.r).length;
        const randomPlaced = actualCount - guaranteed;

        const expectedMinRandom = BiomeResourceSettings.MIN;
        const expectedMaxRandom = Math.floor(avgDensity * BiomeResourceSettings.MAX_MULTIPLIER);
        const tolerance = 2; // buffer for rng noise

        if (eligible <= guaranteed) {
          return; // skip assertion
        }

        expect(randomPlaced).toBeGreaterThanOrEqual(expectedMinRandom);
        expect(randomPlaced).toBeLessThanOrEqual(expectedMaxRandom + tolerance);
      }
    });
  });

  describe("Resource Node Properties", () => {
    it("should generate valid resource nodes with all required properties", () => {
      for (const chunk of testChunks) {
        expect(chunk).toBeDefined();

        for (const tile of chunk.tiles) {
          if (tile.r) {
            const resource = tile.r;
            expect(resource.type).toBeDefined();
            expect(resource.amount).toBeGreaterThan(0);
            expect(resource.remaining).toBe(resource.amount);
            expect(resource.hardness).toBeGreaterThanOrEqual(0);
            expect(resource.x).toBe(tile.x);
            expect(resource.y).toBe(tile.y);

            if (resource.type !== ResourceType.Water) {
              expect(resource.respawnTime).toBeDefined();
            }
          }
        }
      }
    });

    it("should have hardness and respawnTime within valid range", () => {
      for (const chunk of testChunks) {
        for (const tile of chunk.tiles) {
          const r = tile.r;
          if (!r) continue;

          const hardnessRange = ResourceHardnessRange[r.type as ResourceType];
          const maxExpectedHardness = hardnessRange[1] +
            (tile.stp > BiomeResourceSettings.STEEP_HARDNESS_CUTOFF ? BiomeResourceSettings.STEEP_HARDNESS_DIFFICULTY : 0);

          expect(r.hardness).toBeGreaterThanOrEqual(hardnessRange[0]);
          expect(r.hardness).toBeLessThanOrEqual(maxExpectedHardness);

          const respawnRange = ResourceRespawnRange[r.type as ResourceType];
          if (respawnRange) {
            expect(r.respawnTime).toBeDefined();
            expect(r.respawnTime).toBeGreaterThanOrEqual(respawnRange[0]);
            expect(r.respawnTime).toBeLessThanOrEqual(respawnRange[1]);
          } else {
            expect(r.respawnTime).toBeUndefined();
          }

          if (r.type === ResourceType.Water) {
            expect(r.respawnTime).toBeUndefined();
          }
        }
      }
    });

    it("should generate valid resource amounts", () => {
      for (const chunk of testChunks) {
        expect(chunk).toBeDefined();

        for (const tile of chunk.tiles) {
          if (!tile.r) continue;

          const resource = tile.r;
          const type = resource.type;

          if (!(type in ResourceAmountRange)) {
            throw new Error(`Unhandled resource type: ${type}`);
          }

          const [baseMin, baseMax] = ResourceAmountRange[type as ResourceType];
          const biomeMultiplier = ResourceAmountBiomeMultipliers[tile.b as Biome]?.[type as ResourceType] ?? 1;

          const expectedMin = Math.floor(baseMin * biomeMultiplier);
          const expectedMax = Math.floor((baseMax - 1) * biomeMultiplier);

          expect(resource.amount).toBeGreaterThanOrEqual(expectedMin);
          expect(resource.amount).toBeLessThanOrEqual(expectedMax);
        }
      }
    });
  });
});

function isLandTile(tile: Tile): tile is LandTile {
  return 'iC' in tile;
}