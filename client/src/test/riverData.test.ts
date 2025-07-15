import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { INetworkAdapter } from "../network/INetworkAdapter";
import { NetworkFactory } from "../network/NetworkFactory";
import { WaterType, SoilType, Biome, ColorIndex } from "shared/TerrainTypes";
import { TileNormalizer } from "../logic/NormalizeTiles";
import { LandTile } from "shared/TileTypes";

// Main test suite for terrain quality
describe('River Generation and Quality Tests', () => {
  let adapter: INetworkAdapter;
  let testChunks: any[] = [];
  let tileNormalizer: TileNormalizer;
  const CHUNK_SIZE = 10;

  // Setup: connect to the network before running tests, request chunks
  beforeAll(async () => {
    adapter = NetworkFactory.createAdapter();
    await adapter.connect();
    tileNormalizer = new TileNormalizer();

    await new Promise(resolve => {
      adapter.onMessage((data: any) => data.type === 'connected' && resolve(true));
    });

    const maxTries = 100;
    let tries = 0;
    let found = 0;
    const seenCoords = new Set<string>();

    // Hardcoded chunk coordinates
    const hardcodedCoords = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 21, y: 16 },
      { x:-5, y: 48}
    ];

    for (const { x, y } of hardcodedCoords) {
      const key = `${x},${y}`;
      seenCoords.add(key);

      const chunkData: any = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData' && data.chunk?.x === x && data.chunk?.y === y) {
            data.chunk.tiles = TileNormalizer.NormalizeTiles(data.chunk.tiles);
            expect(data.chunk.tiles.length).toBe(100);
            resolve(data);
          }
        });
        adapter.send({ type: 'requestChunk', x, y });
      });

      const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);
      if (riverTiles.length > 0) {
        testChunks.push(chunkData);
        found++;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Sample random chunks until we get 5 chunks with rivers or hit maxTries
    while (found < 5 && tries < maxTries) {
      const x = Math.floor(Math.random() * 100) - 50;
      const y = Math.floor(Math.random() * 100) - 50;
      const key = `${x},${y}`;
      if (seenCoords.has(key)) continue;
      seenCoords.add(key);

      tries++;

      const chunkData: any = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData' && data.chunk?.x === x && data.chunk?.y === y) {
            data.chunk.tiles = TileNormalizer.NormalizeTiles(data.chunk.tiles);
            resolve(data);
          }
        });
        adapter.send({ type: 'requestChunk', x, y });
      });

      const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);
      if (riverTiles.length > 0) {
        testChunks.push(chunkData);
        found++;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if (testChunks.length < 5) {
      throw new Error(`Only found ${testChunks.length} chunks with rivers after ${tries} random tries`);
    }
  }, 30000);
  // Cleanup: disconnect after all tests
  afterAll(async () => {
    await adapter.disconnect();
  });

  /**
   * Returns all tiles adjacent to the given tile (including diagonals).
   * @param tile - The tile to find neighbors for.
   * @param chunk - The 2D array of tiles representing the chunk.
   * @returns An array of adjacent tiles.
   */
  function getAdjacentTilesAt(grid: any[][], x: number, y: number): any[] {
    const adjacent: any[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ny = y + dy;
        const nx = x + dx;
        if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
          adjacent.push(grid[ny][nx]);
        }
      }
    }
    return adjacent;
  }

  function to2DTileGrid(flatTiles: any[], width: number, height: number): any[][] {
    const grid: any[][] = [];
    for (let y = 0; y < height; y++) {
      const row: any[] = [];
      for (let x = 0; x < width; x++) {
        const tile = flatTiles[y * width + x];
        row.push(tile);
      }
      grid.push(row);
    }
    return grid;
  }

  // Returns all river tiles in the chunk
  function getAllRiverTiles(chunk: any[][]): any[] {
    return chunk.flat().filter(tile => tile.w && tile.wT === WaterType.RIVER);
  }

  // Returns all tiles of a given biome in the chunk
  function getAllTilesOfBiome(chunk: any[][], biome: Biome): any[] {
    return chunk.flat().filter(tile => tile.b === biome);
  }
  function countIsolatedRiverTiles(tileGrid: any[][]): number {
    let isolatedCount = 0;
    for (let y = 0; y < tileGrid.length; y++) {
      for (let x = 0; x < tileGrid[0].length; x++) {
        const tile = tileGrid[y][x];
        if (!tile.w || tile.wT !== WaterType.RIVER) continue;

        const neighbors = getAdjacentTilesAt(tileGrid, x, y);
        const riverNeighbors = neighbors.filter(n => n.w && n.wT === WaterType.RIVER);
        if (riverNeighbors.length === 0) {
          isolatedCount++;
        }
      }
    }
    return isolatedCount;
  }

  // --- River Generation Tests ---
  describe('River Generation Tests', () => {
    describe('Basic River Properties', () => {
      it('should generate rivers with valid properties', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
          expect(tiles.length).toBe(100);
          const riverTiles = getAllRiverTiles(tiles);

          if (riverTiles.length === 0) {
            console.warn('No river tiles found in chunk');
            return;
          }

          riverTiles.forEach(tile => {
            expect(tile.w).toBe(true);
            expect(tile.wT).toBe(WaterType.RIVER);
            expect(tile.b).toBe(Biome.RIVER);
            expect(tile.c).toBe(ColorIndex.RIVER);
            // River tiles should not have land-specific properties
            expect(tile.sT).toBeUndefined();
            expect(tile.v).toBeUndefined();
            expect(tile.vT).toBeUndefined();
          });
        });
      });
    });

    describe('Quantity Checks', () => {
      it('should include at least one chunk with 15 or more river tiles', () => {
        const qualifyingChunks = testChunks.filter(chunkData => {
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);
          return riverTiles.length >= 15;
        });

        if (qualifyingChunks.length === 0) {
          const counts = testChunks.map(chunkData => getAllRiverTiles(chunkData.chunk.tiles).length);
          console.warn(`River tile counts per chunk: [${counts.join(', ')}]`);
        }

        expect(qualifyingChunks.length).toBeGreaterThan(0);
      });
    });

    describe('Elevation Checks', () => {
      it('should not generate river tiles below sea level (elevation < 0.3)', () => {
        testChunks.forEach((chunkData) => {
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);
          riverTiles.forEach(tile => {
            if (tile.nH <= 0.3) {
              console.warn(`Failed elevation check: Too low in chunk ${chunkData.chunk.x}, ${chunkData.chunk.y}`);
            }
            expect(tile.nH).toBeGreaterThanOrEqual(0.3);
          });
        });
      });

      it('should not generate river tiles above 0.8 elevation', () => {
        testChunks.forEach((chunkData) => {
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);
          riverTiles.forEach(tile => {
            if (tile.nH > 0.8) {
              console.warn(`Failed elevation check: Too high in chunk ${chunkData.chunk.x}, ${chunkData.chunk.y}`);
            }
            expect(tile.nH).toBeLessThanOrEqual(0.8);
          });
        });
      });
    });

    describe('Continuity Checks', () => {
      it('should have a low ratio of isolated river tiles', () => {
        const MIN_RIVER_TILES = 5;

        testChunks.forEach((chunkData) => {
          const tileGrid = to2DTileGrid(chunkData.chunk.tiles, CHUNK_SIZE, CHUNK_SIZE);
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);

          if (riverTiles.length < MIN_RIVER_TILES) {
            console.log(`Skipping isolated-tile check on Chunk ${chunkData.chunk.x}, ${chunkData.chunk.y} (only ${riverTiles.length} river tiles)`);
            return;
          }

          const isolatedCount = countIsolatedRiverTiles(tileGrid);
          const ratio = isolatedCount / riverTiles.length;

          if (ratio >= 0.25) {
            console.warn(`Failed on Chunk ${chunkData.chunk.x}, ${chunkData.chunk.y}: ${isolatedCount} out of ${riverTiles.length} are isolated`);
          }

          expect(ratio).toBeLessThan(0.25);
        });
      });

      it('should contain at least one wide river region ("lake-like") in the test set', () => {
        let foundLakeLike = false;

        testChunks.forEach(({ chunk }) => {
          const flatTiles = chunk.tiles;
          const riverTiles = getAllRiverTiles(flatTiles);
          const tileGrid = to2DTileGrid(flatTiles, CHUNK_SIZE, CHUNK_SIZE);

          for (const tile of riverTiles) {
            const neighbors = getAdjacentTilesAt(tileGrid, tile.x, tile.y);
            const directionsCovered = new Set();
            neighbors.forEach(n => {
              if (n.w && n.wT === WaterType.RIVER) {
                const dx = n.x - tile.x;
                const dy = n.y - tile.y;
                directionsCovered.add(`${dx},${dy}`);
              }
            });

            if (directionsCovered.size >= 5) { // coverage in at least 5 directions = "lake-like"
              foundLakeLike = true;
              break;
            }
          }
        });

        expect(foundLakeLike).toBe(true);
      });
    });
  });

  // --- Basic Validation Tests ---
  describe('Basic Validation Across All Chunks', () => {
    it(`river tiles should have valid structure`, () => {
      testChunks.forEach((chunkData) => {
        expect(chunkData).toMatchObject({
          type: 'chunkData',
          chunk: {
            x: expect.any(Number),
            y: expect.any(Number),
            tiles: expect.any(Array)
          }
        });

        chunkData.chunk.tiles.forEach((tile: any) => {
          expect(tile).toMatchObject({
            x: expect.any(Number),
            y: expect.any(Number),
            h: expect.any(Number),
            nH: expect.any(Number),
            t: expect.any(Number),
            p: expect.any(Number),
            w: expect.any(Boolean),
            stp: expect.any(Number),
            c: expect.any(Number)
          });

          if ('w' in tile && tile.w) {
            expect(tile).toMatchObject({
              wT: expect.any(Number),
            });
          }
        });
      });
    });
  });

  // --- Performance and Determinism Tests (from new tests) ---
  describe('Performance and Determinism', () => {
    it('should generate terrain within reasonable time', async () => {
      const startTime = Date.now();
      const testCoord = { x: 20, y: 20 };

      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Chunk generation took too long (>8 seconds)'));
        }, 8000);

        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') {
            clearTimeout(timeout);
            resolve(data);
          }
        });

        adapter.send({ type: 'requestChunk', x: testCoord.x, y: testCoord.y });
      });

      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should generate identical terrain with same seed', async () => {
      const seedValue = 12345;
      const testCoord = { x: 25, y: 25 };

      const chunk1 = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') resolve(data);
        });
        adapter.send({
          type: 'requestChunk',
          x: testCoord.x,
          y: testCoord.y,
          seed: seedValue
        });
      });

      await new Promise(resolve => setTimeout(resolve, 150));

      const chunk2 = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') resolve(data);
        });
        adapter.send({
          type: 'requestChunk',
          x: testCoord.x,
          y: testCoord.y,
          seed: seedValue
        });
      });

      expect((chunk1 as any).chunk.tiles.length).toBe((chunk2 as any).chunk.tiles.length);
      (chunk1 as any).chunk.tiles.forEach((tile1: any, index: number) => {
        const tile2 = (chunk2 as any).chunk.tiles[index];
        expect(tile1).toMatchObject(tile2);
      });
    });
  });
});