import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { INetworkAdapter } from "../src/network/INetworkAdapter";
import { NetworkFactory } from "../src/network/NetworkFactory";

// Main test suite for terrain quality
describe('Terrain Quality Tests', () => {
  let adapter: INetworkAdapter;
  let testChunks: any[] = [];

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

    // Wait for connection confirmation from server
    await new Promise(resolve => {
      adapter.onMessage((data: any) => data.type === 'connected' && resolve(true));
    });

    // Load multiple chunks for testing
    for (const coord of chunkCoordinates) {
      const chunk = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') resolve(data);
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

  // Helper function to find adjacent tiles (8-way adjacency)
  const getAdjacentTiles = (tile: any, tiles: any[]) => {
    return tiles.filter(t =>
      Math.abs(t.x - tile.x) <= 1 &&
      Math.abs(t.y - tile.y) <= 1 &&
      !(t.x === tile.x && t.y === tile.y)
    );
  };

  // --- Basic Validation Tests ---
  describe('Basic Validation Across All Chunks', () => {

    // Ensure all chunks have been loaded
    it('should have loaded all chunks', () => {
      expect(testChunks.length).toBe(chunkCoordinates.length);
    });

    // Each chunk should have at least one tile
    it(`should have non-empty tiles in chunk`, () => {
      testChunks.forEach((chunkData, index) => {
        expect(chunkData.chunk.tiles.length).toBeGreaterThan(0);
      });
    });

    // Each chunk should have the expected structure and properties
    it(`should have valid structure in chunk`, () => {
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

          // If land tile, it should have additional properties
          if ('w' in tile && !tile.w) {
            expect(tile).toMatchObject({
              sT: expect.any(Number), // Soil type
              b: expect.any(Number), // Biome
              iC: expect.any(Boolean), // Is cliff
              v: expect.any(Number), // Vegetation
              vT: expect.any(Number), // Vegetation type
            });
          }

          // If water tile, it should have additional properties
          if ('w' in tile && tile.w) {
            expect(tile).toMatchObject({
              wT: expect.any(Number), // Water type
            });
          }
        });
      });
    });

    // Each chunk should contain either water or land tiles
    it(`should have either water or land tiles in chunk`, () => {
      testChunks.forEach((chunkData, index) => {
        const hasWater = chunkData.chunk.tiles.some((t: any) => 'w' in t && t.w === true);
        const hasLand = chunkData.chunk.tiles.some((t: any) => 'w' in t && t.w === false);
        expect(hasWater || hasLand).toBe(true);
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
          expect(tile.stp).toBeLessThan(0.3);
          expect(tile.iC).toBe(false);
          if (tile.wT === 1) { // Ocean
            expect(tile.rf).toBeGreaterThan(0.8);
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
          expect(tile.sT).toBeUndefined();
        });
      });
    });
  });

  // --- Land Tile Tests ---
  describe('Land Tiles Across All Chunks', () => {

    // Land tiles should have valid terrain and property relationships
    it(`Chunk should have valid terrain`, () => {
      testChunks.forEach((chunkData, chunkIndex) => {
        const landTiles = chunkData.chunk.tiles.filter((t: any) => 'w' in t && t.w === false);

        landTiles.forEach((tile: any) => {
          // Basic properties
          expect(tile.sT).toBeDefined();
          expect(tile.stp).toBeDefined();

          // Elevation-specific temperature checks
          if (tile.h > 0.8) { // High mountains
            expect(tile.t).toBeLessThan(0.0); // Should be cold (below freezing at peak)
          } else if (tile.h < 0.3) { // Lowlands
            expect(tile.t).toBeGreaterThan(0.4); // Should be warm (unless polar region)
          }
        });
      });
    });

    // Cliff tiles should have steepness above threshold
    it(`[Chunk should have valid cliffs`, () => {
      testChunks.forEach((chunkData, chunkIndex) => {
        const landTiles = chunkData.chunk.tiles.filter((t: any) => 'w' in t && t.w === false);
        landTiles.forEach((tile: any) => {
          if (tile.iC) {
            expect(tile.stp).toBeGreaterThan(0.7);
          }
        });
      });
    });
  });

  // --- Cross-Chunk Edge Case Tests ---
  describe('Cross-Chunk Edge Cases', () => {
    // Coastline tiles should have consistent properties
    it('should maintain consistent coastlines across chunks', () => {
      const allCoastalTiles: any[] = [];

      testChunks.forEach((chunkData, chunkIndex) => {
        const coastalTiles = chunkData.chunk.tiles.filter((t: any) =>
          !t.w && chunkData.chunk.tiles.some((n: any) =>
            n.w && Math.abs(n.x - t.x) <= 1 && Math.abs(n.y - t.y) <= 1
          )
        );
        allCoastalTiles.push(...coastalTiles);
      });

      allCoastalTiles.forEach(tile => {
        expect(tile.sT).toBe(0); // Sandy soil
      });
    });

    // Biome properties should be consistent at chunk borders
    it('should maintain biome consistency at chunk borders', () => {
      const borderTiles: any[] = [];

      // Compare adjacent chunks for border consistency
      for (let i = 0; i < testChunks.length; i++) {
        for (let j = i + 1; j < testChunks.length; j++) {
          const chunkA = testChunks[i];
          const chunkB = testChunks[j];

          // Find tiles within 1 unit of each other
          chunkA.chunk.tiles.forEach((tileA: any) => {
            chunkB.chunk.tiles.forEach((tileB: any) => {
              if (Math.abs(tileA.x - tileB.x) <= 1 &&
                Math.abs(tileA.y - tileB.y) <= 1) {
                borderTiles.push({ tileA, tileB });
              }
            });
          });
        }
      }

      borderTiles.forEach(({ tileA, tileB }) => {
        // Similar elevation at borders
        expect(Math.abs(tileA.h - tileB.h)).toBeLessThan(0.2);

        // Similar biome properties for land tiles
        if (!tileA.w && !tileB.w) {
          expect(Math.abs(tileA.t - tileB.t)).toBeLessThan(0.15);
          expect(Math.abs(tileA.p - tileB.p)).toBeLessThan(0.2);
        }
      });
    });
  });

  // --- Slope and Temperature Gradient Tests ---

  // Elevation should transition smoothly except at cliffs
  it('should have smooth elevation transitions', () => {
    testChunks.forEach((chunkData, chunkIndex) => {
      const tiles = chunkData.chunk.tiles;
      const maxElevationJump = 0.3;
      const cliffThreshold = 0.7;

      tiles.forEach((tile: any) => {
        if (tile.w) return; // Skip water tiles

        const adjacentTiles = getAdjacentTiles(tile, tiles);

        adjacentTiles.forEach((neighbor: any) => {
          if (neighbor.w) return; // Skip water neighbors

          const elevationDiff = Math.abs(tile.h - neighbor.h);

          // If neither tile is a cliff, elevation should transition smoothly
          if (!tile.iC && !neighbor.iC) {
            expect(elevationDiff).toBeLessThan(maxElevationJump);
          }

          // If there's a large elevation jump, at least one tile should be a cliff
          if (elevationDiff > maxElevationJump) {
            const hasCliff = tile.iC || neighbor.iC ||
              tile.stp > cliffThreshold || neighbor.stp > cliffThreshold;
            expect(hasCliff).toBe(true);
          }
        });
      });
    });
  });

  // Temperature should transition smoothly and correlate with elevation
  it('should have coherent temperature gradients', () => {
    let allHighElevationTiles: any[] = [];
    let allLowElevationTiles: any[] = [];

    testChunks.forEach((chunkData, chunkIndex) => {
      const tiles = chunkData.chunk.tiles;
      const maxTempJump = 0.25;

      tiles.forEach((tile: any) => {
        const adjacentTiles = getAdjacentTiles(tile, tiles);

        adjacentTiles.forEach((neighbor: any) => {
          const tempDiff = Math.abs(tile.t - neighbor.t);
          expect(tempDiff).toBeLessThan(maxTempJump);
        });
      });

      // Collect elevation data for cross-chunk analysis
      const landTiles = tiles.filter((t: any) => !t.w);
      allHighElevationTiles.push(...landTiles.filter((t: any) => t.h > 0.8));
      allLowElevationTiles.push(...landTiles.filter((t: any) => t.h < 0.3));
    });

    // Cross-chunk elevation-temperature correlation
    if (allHighElevationTiles.length > 0 && allLowElevationTiles.length > 0) {
      const avgHighTemp = allHighElevationTiles.reduce((sum: number, t: any) => sum + t.t, 0) / allHighElevationTiles.length;
      const avgLowTemp = allLowElevationTiles.reduce((sum: number, t: any) => sum + t.t, 0) / allLowElevationTiles.length;

      expect(avgHighTemp).toBeLessThan(avgLowTemp + 0.1);
    }
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