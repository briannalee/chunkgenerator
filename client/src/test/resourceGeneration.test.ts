// This test suite validates the resource generation system in a live server environment.
// It covers guaranteed resource placement, biome constraints, density, node properties, and edge cases.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { GameLogic } from "../logic/GameLogic";
import { BiomeResourceDensity, BiomeResourceMap, BiomeResourceSettings, ResourceAmountBiomeMultipliers, ResourceAmountRange, ResourceHardnessRange, ResourceRespawnRange, ResourceType } from 'shared/ResourceTypes';
import { Biome } from 'shared/TerrainTypes'
import { LandTile, Tile } from 'shared/TileTypes';
import { INetworkAdapter } from '../network/INetworkAdapter';
import { NetworkFactory } from '../network/NetworkFactory';

describe("Resource Generation System (Live Server Tests)", () => {
  let gameLogic: GameLogic;
  let testChunks: any[] = [];
  let adapter: INetworkAdapter;

  // Hardcoded chunk coordinates to cover a variety of map areas and edge cases (origin, distant, negative, ocean, etc.)
  let chunkCoordinates = [
    { x: 0, y: 0 },   // Origin
    { x: 5, y: 5 },   // Distant chunk
    { x: -3, y: 2 },  // Negative coordinates
    { x: 10, y: -7 }, // Mixed coordinates
    { x: 0, y: 15 },  // Far chunk
    { x: -1, y: -1 }, // All ocean
    { x: 1, y: -1 }
  ];

  // Before all tests, connect to the game logic and request all test chunks
  beforeAll(async () => {
    gameLogic = new GameLogic();
    await gameLogic.connect();

    // Request each chunk for the test coordinates
    await Promise.all(
      chunkCoordinates.flatMap(({ x, y }) => [
        gameLogic.requestChunk(x, y, 'chunk'),
      ])
    );

    // Wait for all chunk requests to be processed
    await new Promise(resolve => setTimeout(resolve, 500));

    // Collect the loaded chunk objects for testing
    chunkCoordinates.forEach(coords => {
      const chunkKey = `${coords.x},${coords.y}`;
      testChunks.push(gameLogic.chunks[`${coords.x},${coords.y}`]);
    })
  }, 30000);

  // After all tests, disconnect from the game logic
  afterAll(async () => {
    await gameLogic.disconnect();
  });

  // Test group: Checks that resources are always placed where required by biome rules
  describe("Guaranteed Resource Placement", () => {
    it("should place correct resources in appropriate biomes", () => {
      for (const chunk of testChunks) {
        for (const tile of chunk.tiles) {
          // Lake and river tiles must always have water resources
          if (tile.b === Biome.LAKE || tile.b === Biome.RIVER) {
            expect(tile.r).toBeDefined();
            expect(tile.r!.type).toBe(ResourceType.Water);
            continue;
          }

          // Forest, jungle, and dense forest tiles (not steep or cliff) must have a resource (wood, coal, or iron)
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

  // Test group: Ensures resources are never placed on unplaceable terrain (cliffs, steep slopes)
  describe("Resource Placement Constraints", () => {
    it("should never place resources on cliffs", () => {
      for (const chunk of testChunks) {
        expect(chunk).toBeDefined();
        for (const tile of chunk.tiles) {
          // Cliff tiles must never have resources
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
          // Steep terrain must never have resources
          if (tile.stp > BiomeResourceSettings.STEEP_CUTOFF) {
            expect(tile.r).toBeUndefined();
          }
        }
      }
    });
  });

  // Test group: Checks that only valid resource types are placed in each biome
  describe("Biome-Specific Resource Distribution", () => {
    Object.entries(BiomeResourceMap).forEach(([biomeStr, expectedTypes]) => {
      const biome = parseInt(biomeStr) as Biome;
      it(`should only place ${expectedTypes.join(',')} in ${Biome[biome]} biome`, () => {
        for (const chunk of testChunks) {
          if (!chunk) continue;
          chunk.tiles.forEach((tile: Tile) => {
            // For each biome, only the allowed resource types should be present
            if (tile.b === biome && tile.r) {
              expect(expectedTypes).toContain(tile.r.type);
            }
          });
        }
      });
    });
  });

  // Test group: Validates that the number of randomly placed resources matches biome density settings
  describe("Resource Density", () => {
    it("should maintain correct resource density", () => {
      for (const chunk of testChunks) {
        const tiles = chunk.tiles;

        let guaranteed = 0; // Tiles that must always have a resource (e.g. water, forest)
        let excluded = 0;   // Tiles where resources cannot be placed
        let biomeDensitySum = 0; // Sum of biome density values for eligible tiles

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

        // Calculate expected min/max random resource count based on density settings
        const expectedMinRandom = BiomeResourceSettings.MIN;
        const expectedMaxRandom = Math.floor(avgDensity * BiomeResourceSettings.MAX_MULTIPLIER);
        const tolerance = 2; // buffer for rng noise

        if (eligible <= guaranteed) {
          return; // skip assertion if all eligible tiles are guaranteed
        }

        expect(randomPlaced).toBeGreaterThanOrEqual(expectedMinRandom);
        expect(randomPlaced).toBeLessThanOrEqual(expectedMaxRandom + tolerance);
      }
    });
  });

  // Test group: Checks that all generated resource nodes have valid and consistent properties
  describe("Resource Node Properties", () => {
    it("should generate valid resource nodes with all required properties", () => {
      for (const chunk of testChunks) {
        expect(chunk).toBeDefined();

        for (const tile of chunk.tiles) {
          if (tile.r) {
            const resource = tile.r;
            // Resource must have a type, positive amount, correct remaining, valid hardness, and correct coordinates
            expect(resource.type).toBeDefined();
            expect(resource.amount).toBeGreaterThan(0);
            expect(resource.remaining).toBe(resource.amount);
            expect(resource.hardness).toBeGreaterThanOrEqual(0);
            expect(resource.x).toBe(tile.x);
            expect(resource.y).toBe(tile.y);

            // Only non-water resources should have a respawn time
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

          // Hardness must be within the allowed range for the resource type, with extra difficulty for steep tiles
          const hardnessRange = ResourceHardnessRange[r.type as ResourceType];
          const maxExpectedHardness = hardnessRange[1] +
            (tile.stp > BiomeResourceSettings.STEEP_HARDNESS_CUTOFF ? BiomeResourceSettings.STEEP_HARDNESS_DIFFICULTY : 0);

          expect(r.hardness).toBeGreaterThanOrEqual(hardnessRange[0]);
          expect(r.hardness).toBeLessThanOrEqual(maxExpectedHardness);

          // Respawn time must be within the allowed range for the resource type (if defined)
          const respawnRange = ResourceRespawnRange[r.type as ResourceType];
          if (respawnRange) {
            expect(r.respawnTime).toBeDefined();
            expect(r.respawnTime).toBeGreaterThanOrEqual(respawnRange[0]);
            expect(r.respawnTime).toBeLessThanOrEqual(respawnRange[1]);
          } else {
            expect(r.respawnTime).toBeUndefined();
          }

          // Water resources should never have a respawn time
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

          // Resource amount must be within the allowed range for the type, adjusted by biome multiplier
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
  describe('Mining Network Interaction', () => {
    beforeAll(async () => {
      adapter = NetworkFactory.createAdapter();
      await adapter.connect();
      // Wait for connection confirmation from server
      await new Promise(resolve => {
        adapter.onMessage((data: any) => data.type === 'connected' && resolve(true));
      });

    });
    it('should succeed mining a tile with a resource', async () => {
      // Find one tile with a resource among loaded chunks
      let tileWithResource: any | undefined;
      for (const chunk of testChunks) {
        tileWithResource = chunk.tiles.find((t: any) => t.r !== undefined);
        if (tileWithResource) break;
      }
      expect(tileWithResource).toBeDefined();
      if (!tileWithResource) return;

      // Send mining request
      adapter.send({
        type: 'mining',
        x: tileWithResource.x,
        y: tileWithResource.y,
        tool: 'pickaxe' // tool can be hand, pickaxe, or drill
      });

      // Await miningSuccess response for that tile
      const miningSuccess = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for miningSuccess')), 5000);

        const handler = (data: any) => {
          if (
            data.type === 'miningSuccess' &&
            data.x === tileWithResource.x &&
            data.y === tileWithResource.y
          ) {
            clearTimeout(timeout);
            if (adapter.offMessage) {
              adapter.offMessage(handler);
            }
            resolve(data);
          }
        };
        adapter.onMessage(handler);
      });

      expect(miningSuccess).toHaveProperty('resource');
      expect(miningSuccess).toHaveProperty('amount');
      const miningSuccessData = miningSuccess as { x: number; y: number; resource: any; amount: number };
      expect(miningSuccessData.x).toBe(tileWithResource.x);
      expect(miningSuccessData.y).toBe(tileWithResource.y);
    });

    it('should fail mining a tile without a resource', async () => {
      // Find one tile without a resource
      let tileWithoutResource: any | undefined;
      for (const chunk of testChunks) {
        tileWithoutResource = chunk.tiles.find((t: any) => t.r === undefined);
        if (tileWithoutResource) break;
      }
      expect(tileWithoutResource).toBeDefined();
      if (!tileWithoutResource) return;

      // Send mining request
      adapter.send({
        type: 'mining',
        x: tileWithoutResource.x,
        y: tileWithoutResource.y,
        tool: 'hand'
      });

      // Await miningFailed response for that tile
      const miningFailed = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for miningFailed')), 5000);

        const handler = (data: any) => {
          if (
            data.type === 'miningFailed' &&
            data.x === tileWithoutResource.x &&
            data.y === tileWithoutResource.y
          ) {
            clearTimeout(timeout);
            if (adapter.offMessage) {
              adapter.offMessage(handler);
            }
            resolve(data);
          }
        };
        adapter.onMessage(handler);
      });

      expect(miningFailed).toMatchObject({
        type: 'miningFailed',
        x: tileWithoutResource.x,
        y: tileWithoutResource.y
      });
    });
  });

});



// Type guard for land tiles (tiles that can have cliffs)
function isLandTile(tile: Tile): tile is LandTile {
  return 'iC' in tile;
}