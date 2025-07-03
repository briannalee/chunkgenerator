import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { INetworkAdapter } from "../network/INetworkAdapter";
import { NetworkFactory } from "../network/NetworkFactory";
import { WaterType, SoilType, Biome } from "shared/TerrainTypes";
import {TileNormalizer } from "../logic/NormalizeTiles";
import { LandTile } from "shared/TileTypes";

// Main test suite for terrain quality
describe('River Quality Tests', () => {
  let adapter: INetworkAdapter;
  let testChunks: any[] = [];
  let tileNormalizer: TileNormalizer;

  // Define hardcoded test chunk coordinates for coverage of various map areas
  let chunkCoordinates = [
    { x: 0, y: 0 },   // Origin
    { x: 5, y: 5 },   // Distant chunk
    { x: -3, y: 2 },  // Negative coordinates
    { x: 10, y: -7 }, // Mixed coordinates
    { x: 0, y: 15 }   // Far chunk
  ];

  // Randomly generated chunk coordinates for additional coverage
  for (let i = 0; i < 5; i++) {
    chunkCoordinates.push({
      x: Math.floor(Math.random() * 5000) - 2500,
      y: Math.floor(Math.random() * 5000) - 2500
    });
  }

  // Setup: connect to the network and load test chunks before running tests
  beforeAll(async () => {
    adapter = NetworkFactory.createAdapter();
    await adapter.connect();
    tileNormalizer = new TileNormalizer();
    // Wait for connection confirmation from server
    await new Promise(resolve => {
      adapter.onMessage((data: any) => data.type === 'connected' && resolve(true));
    });

    // Load multiple chunks for testing
    for (const coord of chunkCoordinates) {
      const chunk = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') {
            // Normalize tiles when received
            data.chunk.tiles = TileNormalizer.NormalizeTiles(data.chunk.tiles);
            resolve(data);
          }
        });
        adapter.send({ type: 'requestChunk', x: coord.x, y: coord.y });
      });
      testChunks.push(chunk);

      // Small delay between requests to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, 30000);

  // Cleanup: disconnect after all tests
  afterAll(async () => {
    await adapter.disconnect();
  });


  // --- Basic Validation Tests ---
  describe('Basic Validation Across All Chunks', () => {

    // Each chunk should have the expected structure and properties
    it(`river tiles should have valid structure`, () => {
      testChunks.forEach((chunkData, index) => {
        expect(chunkData).toMatchObject({
          type: 'chunkData',
          chunk: {
            x: expect.any(Number),
            y: expect.any(Number),
            tiles: expect.any(Array)
          }
        });

        // Each tile should have the expected properties
        chunkData.chunk.tiles.forEach((tile: any) => {

          expect(tile).toMatchObject({

            x: expect.any(Number),
            y: expect.any(Number),
            h: expect.any(Number), // Height
            nH: expect.any(Number), // Normalized height
            t: expect.any(Number), // Temperature
            p: expect.any(Number), // Precipitation
            w: expect.any(Boolean), // Water flag
            stp: expect.any(Number), // Steepness
            c: expect.any(Number) // Color
          });

          // If water tile, it should have additional properties
          if ('w' in tile && tile.w) {
            expect(tile).toMatchObject({
              wT: expect.any(Number), // Water type
            });
          }
        });
      });
    });
  });

  // --- Water Tile Tests ---
  describe('Water Tiles Across All Chunks', () => {

    // Water tiles should have valid water-specific properties
    it(`Chunk should have valid water properties`, () => {
      testChunks.forEach((chunkData, chunkIndex) => {
        const waterTiles = chunkData.chunk.tiles.filter((t: any) => 'w' in t && t.w === true);
        waterTiles.forEach((tile: any) => {
          expect(tile).toMatchObject({
            w: true,
            wT: expect.any(Number),
            stp: expect.any(Number)
          });

          // Water-specific validations
          expect(tile.sT).toBeUndefined(); // No soil type in water
          if (tile.wT === 1) { // Ocean
            expect(tile.iC).toBeUndefined(); // No cliffs in ocean (rivers may have cliffs, e.g. waterfalls)
            // If warm ocean, precipitation should be higher
            if (tile.t > 0.5) {
              expect(tile.p).toBeGreaterThan(0.1); // Warm ocean should have precipitation
            } else {
              // If cold ocean, precipitation should still be non-zero
              expect(tile.p).toBeGreaterThanOrEqual(0.05); // Cold ocean should have some precipitation
            }
          }
        });
      });
    });

    // Water tiles should not have land-specific properties
    it(`Chunk should not mix water/land properties`, () => {
      testChunks.forEach((chunkData, chunkIndex) => {
        const waterTiles = chunkData.chunk.tiles.filter((t: any) => 'w' in t && t.w === true);
        waterTiles.forEach((tile: any) => {
          expect(tile.vg).toBeUndefined();
          expect(tile.vT).toBeUndefined();
        });
      });
    });
  });

  // --- Cross-Chunk Edge Case Tests ---
  describe('Cross-Chunk Edge Cases', () => {
    it('should maintain consistent coastlines across chunks', () => {
      testChunks.forEach((chunkData) => {
        const { tiles } = chunkData.chunk;

        // Find proper coastal tiles (sand beaches adjacent to ocean)
        const coastalTiles = tiles.filter((t: any) => {
          if (t.w) return false; // Skip water tiles
          if (t.iC) return false; // Skip cliffs
          if (t.nH < 0.4 - 0.03 || t.nH > 0.4 + 0.03) return false; // Must be near sea level

          // Check for adjacent ocean tiles (not rivers/lakes)
          const hasOceanNeighbor = tiles.some((n: any) =>
            n.w &&
            n.wT === WaterType.OCEAN && // Only count ocean water
            Math.abs(n.x - t.x) + Math.abs(n.y - t.y) === 1 // Only direct neighbors (no diagonals)
          );

          return hasOceanNeighbor;
        });

        // Verify coastal properties
        coastalTiles.forEach((tile: LandTile) => {
          expect(tile.b).toBe(Biome.BEACH); // Should be beach biome
          expect(tile.sT).toBe(SoilType.SAND);    // Should have sandy soil
          expect(tile.nH).toBeGreaterThan(0.4 - 0.03); // Should be just above sea level
          expect(tile.nH).toBeLessThan(0.4 + 0.03);   // but not too high
        });
      });
    });
  });

  // --- Performance and Determinism Tests ---

  // Terrain generation should complete within a reasonable time
  it('should generate terrain within reasonable time', () => {
    const performanceResults: any[] = [];

    return new Promise(async (resolve, reject) => {
      try {
        for (let i = 0; i < 3; i++) {
          const startTime = Date.now();
          const testCoord = { x: 20 + i, y: 20 + i };

          const chunk = await new Promise((chunkResolve, chunkReject) => {
            const timeout = setTimeout(() => {
              chunkReject(new Error(`Chunk ${i + 1} generation took too long (>8 seconds)`));
            }, 8000);

            adapter.onMessage((data: any) => {
              if (data.type === 'chunkData') {
                clearTimeout(timeout);
                chunkResolve(data);
              }
            });

            adapter.send({ type: 'requestChunk', x: testCoord.x, y: testCoord.y });
          });

          const endTime = Date.now();
          const generationTime = endTime - startTime;
          performanceResults.push({ coord: testCoord, time: generationTime });

          expect(generationTime).toBeLessThan(5000);

          // Small delay between requests
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        const avgTime = performanceResults.reduce((sum, r) => sum + r.time, 0) / performanceResults.length;

        resolve(true);
      } catch (error) {
        reject(error);
      }
    });
  });

  // Terrain generation should be deterministic for the same seed and coordinates
  it('should generate identical terrain with same seed', async () => {
    const seedValue = 12345;
    const testCoordinates = [
      { x: 25, y: 25 },
      { x: -10, y: 15 },
      { x: 0, y: -20 }
    ];

    for (const coord of testCoordinates) {
      // Request the same chunk twice with the same seed
      const chunk1 = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') resolve(data);
        });
        adapter.send({
          type: 'requestChunk',
          x: coord.x,
          y: coord.y,
          seed: seedValue
        });
      });

      // Small delay to ensure the first request is processed
      await new Promise(resolve => setTimeout(resolve, 150));

      const chunk2 = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') resolve(data);
        });
        adapter.send({
          type: 'requestChunk',
          x: coord.x,
          y: coord.y,
          seed: seedValue
        });
      });

      // Verify chunks are identical
      expect((chunk1 as any).chunk.tiles.length).toBe((chunk2 as any).chunk.tiles.length);

      (chunk1 as any).chunk.tiles.forEach((tile1: any, index: number) => {
        const tile2 = (chunk2 as any).chunk.tiles[index];

        // All properties should be identical
        expect(tile1.x).toBe(tile2.x);
        expect(tile1.y).toBe(tile2.y);
        expect(tile1.h).toBe(tile2.h);
        expect(tile1.t).toBe(tile2.t);
        expect(tile1.p).toBe(tile2.p);
        expect(tile1.w).toBe(tile2.w);
        expect(tile1.stp).toBe(tile2.stp);
        expect(tile1.iC).toBe(tile2.iC);
        expect(tile1.sT).toBe(tile2.sT);

        // Optional properties should also match
        if (tile1.vg !== undefined) {
          expect(tile1.vg).toBe(tile2.vg);
        }
        if (tile1.wT !== undefined) {
          expect(tile1.wT).toBe(tile2.wT);
        }
      });

      // Delay between coordinate tests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  });
});