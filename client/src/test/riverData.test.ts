import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { INetworkAdapter } from "../network/INetworkAdapter";
import { NetworkFactory } from "../network/NetworkFactory";
import { WaterType, SoilType, Biome, ColorIndex } from "shared/TerrainTypes";
import { TileNormalizer } from "../logic/NormalizeTiles";
import { Tile } from "shared/TileTypes";

// Main test suite for terrain quality
// This 'describe' block defines a test suite focused on the generation and quality of rivers within the game's terrain.
describe('River Generation and Quality Tests', () => {
  // Declare variables that will be used across multiple tests within this suite.
  let adapter: INetworkAdapter; // Network adapter to communicate with the terrain generation service.
  let testChunks: any[] = []; // Array to store chunk data that contains rivers, used for testing.
  const CHUNK_SIZE = 10; // Defines the size of a chunk (e.g., 10x10 tiles).

  // Setup: This hook runs once before all tests in this describe block.
  // It's responsible for establishing a network connection, initializing the tile normalizer,
  // and requesting a set of chunk data, prioritizing those that contain rivers.
  beforeAll(async () => {
    // Create an instance of the network adapter using the factory.
    adapter = NetworkFactory.createAdapter();
    // Connect to the network service. This is an asynchronous operation.
    await adapter.connect();

    // Wait for the 'connected' message from the network adapter, ensuring the connection is established.
    await new Promise(resolve => {
      adapter.onMessage((data: any) => data.type === 'connected' && resolve(true));
    });

    const maxTries = 100; // Maximum attempts to find chunks with rivers.
    let tries = 0; // Counter for random chunk request attempts.
    let found = 0; // Counter for chunks found that contain rivers.
    const seenCoords = new Set<string>(); // Set to store coordinates of requested chunks to avoid duplicates.

    // Hardcoded chunk coordinates to request initially.
    // These specific coordinates are chosen because they are known to potentially contain rivers,
    // or to test specific edge cases or common river generation patterns.
    const hardcodedCoords = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 21, y: 16 },
      { x: -5, y: 48 }
    ];

    // Loop through the hardcoded coordinates to request these specific chunks.
    for (const { x, y } of hardcodedCoords) {
      const key = `${x},${y}`; // Create a unique key for the chunk coordinates.
      seenCoords.add(key); // Add the coordinates to the set of seen coordinates.

      // Request the chunk data and wait for the 'chunkData' message.
      const chunkData: any = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          // Check if the received message is 'chunkData' and matches the requested chunk's coordinates.
          if (data.type === 'chunkData' && data.chunk?.x === x && data.chunk?.y === y) {
            // Normalize the tiles within the received chunk data.
            data.chunk.tiles = TileNormalizer.NormalizeTiles(data.chunk.tiles);
            // Assert that the number of tiles in the chunk is as expected (e.g., 10x10 = 100 tiles).
            expect(data.chunk.tiles.length).toBe(100);
            resolve(data); // Resolve the promise with the chunk data.
          }
        });
        // Send the request for the specific chunk.
        adapter.send({ type: 'requestChunk', x, y });
      });

      // Get all river tiles from the received chunk.
      const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);
      // If rivers are present (avoiding single-river-tile chunks), add the chunk to the testChunks and increment 'found'.
      if (riverTiles.length > 1) {
        testChunks.push(chunkData);
        found++;
      }

      // Introduce a small delay to avoid overwhelming the network adapter or server.
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Sample random chunks until a desired number of chunks with rivers are found (at least 5)
    // or the maximum number of tries is reached.
    while (found < 5 && tries < maxTries) {
      // Generate random chunk coordinates within a reasonable range.
      const x = Math.floor(Math.random() * 100) - 50;
      const y = Math.floor(Math.random() * 100) - 50;
      const key = `${x},${y}`; // Create a unique key for the coordinates.
      // If these coordinates have already been seen, skip to the next iteration.
      if (seenCoords.has(key)) continue;
      seenCoords.add(key); // Add new coordinates to the seen set.

      tries++; // Increment the try counter.

      // Request the random chunk data.
      const chunkData: any = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          // Check for the 'chunkData' message corresponding to the requested chunk.
          if (data.type === 'chunkData' && data.chunk?.x === x && data.chunk?.y === y) {
            // Normalize the tiles.
            data.chunk.tiles = TileNormalizer.NormalizeTiles(data.chunk.tiles);
            resolve(data); // Resolve with the chunk data.
          }
        });
        // Send the request for the random chunk.
        adapter.send({ type: 'requestChunk', x, y });
      });

      // Check if the obtained chunk contains any river tiles.
      const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);
      // If rivers are present (avoiding single-river-tile chunks), add the chunk to the testChunks and increment 'found'.
      if (riverTiles.length > 1) {
        testChunks.push(chunkData);
        found++;
      }

      // Introduce a small delay.
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // After attempting to gather chunks, if fewer than 5 chunks with rivers were found, log a warning.
    if (testChunks.length < 5) {
      console.warn(`Only found ${testChunks.length} chunks with rivers after ${tries} random tries. River generation failure.`);
    }
  }, 30000); // Set a timeout of 30 seconds for the beforeAll hook, as network requests can take time.

  // Cleanup: This hook runs once after all tests in this describe block have completed.
  // It ensures that the network connection is properly closed.
  afterAll(async () => {
    await adapter.disconnect(); // Disconnect from the network service.
  });

  /**
   * Returns all tiles adjacent to the given tile (including diagonals).
   * This helper function is crucial for continuity checks of rivers, determining if a river tile
   * has other river tiles as neighbors.
   * @param grid - The 2D array of tiles representing the chunk.
   * @param x - The x-coordinate of the tile.
   * @param y - The y-coordinate of the tile.
   * @returns An array of adjacent tiles.
   */
  function getAdjacentTilesAt(grid: any[][], x: number, y: number): any[] {
    const adjacent: any[] = [];
    // Iterate through a 3x3 grid centered around the given tile (dx, dy from -1 to 1).
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        // Skip the tile itself (dx=0, dy=0).
        if (dx === 0 && dy === 0) continue;
        const ny = y + dy; // Calculate the neighbor's y-coordinate.
        const nx = x + dx; // Calculate the neighbor's x-coordinate.
        // Check if the neighbor's coordinates are within the bounds of the grid.
        if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
          adjacent.push(grid[ny][nx]); // Add the valid neighbor tile to the list.
        }
      }
    }
    return adjacent;
  }

  /**
   * Converts a flat array of tiles into a 2D grid representation.
   * This is useful for spatial operations like finding adjacent tiles, as it simplifies grid traversal.
   * @param flatTiles - The 1D array of tile objects.
   * @param width - The width of the chunk (number of tiles in X dimension).
   * @param height - The height of the chunk (number of tiles in Y dimension).
   * @returns A 2D array (grid) of tiles.
   */
  function to2DTileGrid(flatTiles: any[], width: number, height: number): any[][] {
    const grid: any[][] = [];
    for (let y = 0; y < height; y++) {
      const row: any[] = [];
      for (let x = 0; x < width; x++) {
        // Calculate the index in the flat array based on 2D coordinates.
        const tile = flatTiles[y * width + x];
        row.push(tile); // Add the tile to the current row.
      }
      grid.push(row); // Add the completed row to the grid.
    }
    return grid;
  }

  /**
   * Returns all tiles within a chunk that are identified as rivers.
   * This is a fundamental helper for all river-specific tests.
   * @param chunk - The 2D array of tiles representing the chunk.
   * @returns An array of river tiles.
   */
  function getAllRiverTiles(chunk: any[][]): any[] {
    // Flatten the 2D chunk array and filter for tiles that are water ('w' is true)
    // and specifically of 'WaterType.RIVER'.
    return chunk.flat().filter(tile => tile.w && tile.wT === WaterType.RIVER);
  }

  /**
   * Counts the number of "isolated" river tiles in a tile grid.
   * An isolated river tile is defined as a river tile that has no other river tiles
   * as direct (8-directional) neighbors within the same chunk. This is a key metric
   * for assessing river continuity and realism.
   * @param tileGrid - The 2D array of tiles representing the chunk.
   * @returns The count of isolated river tiles.
   */
  function countIsolatedRiverTiles(tileGrid: any[][]): number {
    let isolatedCount = 0; // Initialize counter for isolated river tiles.

    const height = tileGrid.length; // Get the height of the grid.
    const width = tileGrid[0].length; // Get the width of the grid.

    // Iterate through the inner tiles of the grid (excluding borders, as their neighbors might be in other chunks).
    // This simplifies the logic by not needing to handle out-of-bounds neighbor checks for border tiles.
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const tile = tileGrid[y][x];
        // Skip tiles that are not rivers.
        if (!tile.w || tile.wT !== WaterType.RIVER) continue;

        // Get all adjacent tiles for the current river tile.
        const neighbors = getAdjacentTilesAt(tileGrid, x, y);
        // Filter the neighbors to find only other river tiles.
        const riverNeighbors = neighbors.filter(n => n.w && n.wT === WaterType.RIVER);

        // If no river neighbors are found, the current tile is considered isolated.
        if (riverNeighbors.length === 0) {
          isolatedCount++; // Increment the isolated count.
        }
      }
    }

    return isolatedCount;
  }

  // --- River Generation Tests ---
  // This nested describe block groups tests specifically focused on the characteristics of generated rivers.
  describe('River Generation Tests', () => {
    // --- Basic River Properties Tests ---
    // This sub-block verifies that river tiles have the expected attributes after generation.
    describe('Basic River Properties', () => {

      // Ensure we found at least 5 chunks with rivers
      // If this fails, it indicates rivers are not being generated at all, are
      // very rare (as to violate spec) or severely fragmented
      it('should generate sufficient chunks with rivers', () => {
        expect(testChunks.length).toBeGreaterThanOrEqual(5)
      });

      it('should generate rivers with valid properties', () => {
        // Iterate over each chunk that was collected during the setup phase.
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles; // Get the tiles from the current chunk.
          // Assert that the chunk contains the expected number of tiles (10x10 = 100).
          expect(tiles.length).toBe(100);
          const riverTiles = getAllRiverTiles(tiles); // Get all river tiles from this chunk.

          // If no river tiles are found in a chunk, issue a warning and skip further checks for this chunk.
          // This can happen if the static chunk selection didn't yield many or any river-rich chunks.
          if (riverTiles.length === 0) {
            console.warn('No river tiles found in chunk');
            return;
          }

          // For each river tile, assert that it has the correct properties.
          riverTiles.forEach(tile => {
            // 'w' (isWater) should be true.
            expect(tile.w).toBe(true);
            // 'wT' (WaterType) should be RIVER.
            expect(tile.wT).toBe(WaterType.RIVER);
            // 'b' (Biome) should be RIVER.
            expect(tile.b).toBe(Biome.RIVER);
            // 'c' (ColorIndex) should be RIVER.
            expect(tile.c).toBe(ColorIndex.RIVER);
            // River tiles should *not* have land-specific properties, ensuring correct type differentiation.
            expect(tile.sT).toBeUndefined(); // SoilType should be undefined.
            expect(tile.v).toBeUndefined(); // Vegetation should be undefined.
            expect(tile.vT).toBeUndefined(); // VegetationType should be undefined.
          });
        });
      });
    });

    // --- Quantity Checks ---
    // This sub-block focuses on ensuring there's a sufficient presence of rivers.
    describe('Quantity Checks', () => {
      it('should include at least one chunk with 15 or more river tiles', () => {
        // Filter the collected chunks to find those with 15 or more river tiles.
        const qualifyingChunks = testChunks.filter(chunkData => {
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles);
          return riverTiles.length >= 15;
        });

        // If no qualifying chunks are found, log the river tile counts for all tested chunks
        // to aid in debugging and understanding the distribution.
        if (qualifyingChunks.length === 0) {
          const counts = testChunks.map(chunkData => getAllRiverTiles(chunkData.chunk.tiles).length);
          console.warn(`River tile counts per chunk: [${counts.join(', ')}]`);
        }

        // Assert that at least one chunk meets the minimum river tile count.
        expect(qualifyingChunks.length).toBeGreaterThan(0);
      });
    });

    // --- Elevation Checks ---
    // This sub-block tests the elevation constraints for river tile generation.
    describe('Elevation Checks', () => {
      it('should not generate river tiles below sea level (elevation < 0.3)', () => {
        // Iterate through all collected chunks.
        testChunks.forEach((chunkData) => {
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles); // Get river tiles.
          riverTiles.forEach(tile => {
            // If a river tile is found with elevation (nH) below 0.3, log a warning.
            if (tile.nH <= 0.3) {
              console.warn(`Failed elevation check: Too low in chunk ${chunkData.chunk.x}, ${chunkData.chunk.y}`);
            }
            // Assert that the river tile's normalized height (nH) is greater than or equal to 0.3.
            expect(tile.nH).toBeGreaterThanOrEqual(0.3);
          });
        });
      });

      it('should not generate river tiles above 0.8 elevation', () => {
        // Iterate through all collected chunks.
        testChunks.forEach((chunkData) => {
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles); // Get river tiles.
          riverTiles.forEach(tile => {
            // If a river tile is found with elevation (nH) above 0.8, log a warning.
            if (tile.nH > 0.8) {
              console.warn(`Failed elevation check: Too high in chunk ${chunkData.chunk.x}, ${chunkData.chunk.y}`);
            }
            // Assert that the river tile's normalized height (nH) is less than or equal to 0.8.
            expect(tile.nH).toBeLessThanOrEqual(0.8);
          });
        });
      });
    });

    // --- Continuity Checks ---
    // This sub-block focuses on ensuring rivers are continuous and form connected bodies.
    describe('Continuity Checks', () => {
      it('should have a low ratio of isolated river tiles', () => {
        const MIN_RIVER_TILES = 5; // Minimum number of river tiles required to perform this check.

        testChunks.forEach((chunkData) => {
          // Convert the flat tile array to a 2D grid for easier spatial analysis.
          const tileGrid = to2DTileGrid(chunkData.chunk.tiles, CHUNK_SIZE, CHUNK_SIZE);
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles); // Get river tiles.

          // Skip the check if the chunk has too few river tiles, as a ratio would be less meaningful.
          if (riverTiles.length < MIN_RIVER_TILES) {
            console.log(`Skipping isolated-tile check on Chunk ${chunkData.chunk.x}, ${chunkData.chunk.y} (only ${riverTiles.length} river tiles)`);
            return;
          }

          const isolatedCount = countIsolatedRiverTiles(tileGrid); // Count isolated river tiles.
          const ratio = isolatedCount / riverTiles.length; // Calculate the ratio of isolated to total river tiles.

          // If the ratio of isolated tiles is too high (>= 0.25), log a warning.
          if (ratio >= 0.25) {
            console.warn(`Failed on Chunk ${chunkData.chunk.x}, ${chunkData.chunk.y}: ${isolatedCount} out of ${riverTiles.length} are isolated`);
          }

          // Assert that the ratio of isolated river tiles is less than 0.25, indicating good continuity.
          expect(ratio).toBeLessThan(0.25);
        });
      });

      it('should contain at least one wide river region ("lake-like") in the test set', () => {
        let foundLakeLike = false; // Flag to track if a lake-like region is found.

        testChunks.forEach(({ chunk }) => {
          const flatTiles = chunk.tiles;
          const riverTiles = getAllRiverTiles(flatTiles); // Get all river tiles in the current chunk.
          // Convert to a 2D grid.
          const tileGrid = to2DTileGrid(flatTiles, CHUNK_SIZE, CHUNK_SIZE);

          // Iterate through each river tile to check its neighborhood.
          for (const tile of riverTiles) {
            // Get all adjacent tiles for the current river tile.
            const neighbors = getAdjacentTilesAt(tileGrid, tile.x, tile.y);
            const directionsCovered = new Set(); // Set to store unique directions covered by river neighbors.

            neighbors.forEach(n => {
              // If a neighbor is also a river tile, determine the direction relative to the current tile.
              if (n.w && n.wT === WaterType.RIVER) {
                const dx = n.x - tile.x; // X-difference (e.g., -1, 0, 1)
                const dy = n.y - tile.y; // Y-difference (e.g., -1, 0, 1)
                directionsCovered.add(`${dx},${dy}`); // Add the direction as a string to the set.
              }
            });

            // If a river tile has river neighbors in 5 or more directions (out of 8 possible),
            // it indicates a wider, "lake-like" river region.
            if (directionsCovered.size >= 5) {
              foundLakeLike = true; // Set the flag to true.
              break; // Exit the loop early as we've found one.
            }
          }
        });

        // Assert that at least one "lake-like" river region was found across all tested chunks.
        expect(foundLakeLike).toBe(true);
      });

      it('should have at least one river that continues across a chunk boundary (including diagonals)', async () => {
        const fetchedChunks = new Map<string, any>();

        function chunkKey(x: number, y: number): string {
          return `${x},${y}`;
        }

        // Helper to fetch and normalize a chunk, using cache
        async function getChunk(x: number, y: number): Promise<any> {
          const key = chunkKey(x, y);
          if (fetchedChunks.has(key)) return fetchedChunks.get(key);

          const chunkData = await new Promise(resolve => {
            adapter.onMessage((data: any) => {
              if (data.type === 'chunkData' && data.chunk?.x === x && data.chunk?.y === y) {
                data.chunk.tiles = TileNormalizer.NormalizeTiles(data.chunk.tiles);
                resolve(data);
              }
            });
            adapter.send({ type: 'requestChunk', x, y });
          });

          fetchedChunks.set(key, chunkData);
          return chunkData;
        }

        let foundConnected = false;

        for (const { chunk } of testChunks) {
          const { x: chunkX, y: chunkY, tiles } = chunk;
          fetchedChunks.set(chunkKey(chunkX, chunkY), { chunk }); // prime cache

          const edgeRiverTiles = tiles.filter((t: Tile) =>
            t.w && t.wT === WaterType.RIVER &&
            (t.x === 0 || t.x === CHUNK_SIZE - 1 || t.y === 0 || t.y === CHUNK_SIZE - 1)
          );

          if (edgeRiverTiles.length === 0) continue;

          // Check each tile against all 8 directions
          const directions = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
          ];

          for (const tile of edgeRiverTiles) {
            for (const [dx, dy] of directions) {
              const neighborChunkX = chunkX + (tile.x === 0 && dx === -1 ? -1
                : tile.x === CHUNK_SIZE - 1 && dx === 1 ? 1
                  : 0);

              const neighborChunkY = chunkY + (tile.y === 0 && dy === -1 ? -1
                : tile.y === CHUNK_SIZE - 1 && dy === 1 ? 1
                  : 0);

              // Only fetch actual neighboring chunks
              if (neighborChunkX === chunkX && neighborChunkY === chunkY) continue;

              const neighborChunk = (await getChunk(neighborChunkX, neighborChunkY)).chunk;

              // Convert local tile x/y into neighbor coordinates
              const neighborTileX =
                tile.x === 0 && dx === -1 ? CHUNK_SIZE - 1 :
                  tile.x === CHUNK_SIZE - 1 && dx === 1 ? 0 :
                    tile.x + dx;

              const neighborTileY =
                tile.y === 0 && dy === -1 ? CHUNK_SIZE - 1 :
                  tile.y === CHUNK_SIZE - 1 && dy === 1 ? 0 :
                    tile.y + dy;

              const neighborTile = neighborChunk.tiles.find((t: Tile) =>
                t.x === tile.x + dx && t.y === tile.y + dy
              );

              if (neighborTile && neighborTile.w && neighborTile.wT === WaterType.RIVER) {
                foundConnected = true;
                break;
              }
            }

            if (foundConnected) break;
          }

          if (foundConnected) break;
        }

        expect(foundConnected).toBe(true);
      });
    });
  });

  // --- Basic Validation Tests ---
  // This describe block contains general validation tests for all chunks, ensuring data integrity.
  describe('Basic Validation Across All Chunks', () => {
    it('river tiles should have valid structure', () => {
      testChunks.forEach((chunkData) => {
        // Assert that the chunkData object matches a specific structure.
        expect(chunkData).toMatchObject({
          type: 'chunkData', // Must be of type 'chunkData'.
          chunk: {
            x: expect.any(Number), // X-coordinate should be a number.
            y: expect.any(Number), // Y-coordinate should be a number.
            tiles: expect.any(Array) // Tiles should be an array.
          }
        });

        // For each tile within the chunk, assert its basic properties.
        chunkData.chunk.tiles.forEach((tile: any) => {
          expect(tile).toMatchObject({
            x: expect.any(Number), // Tile's x-coordinate.
            y: expect.any(Number), // Tile's y-coordinate.
            h: expect.any(Number), // Raw height.
            nH: expect.any(Number), // Normalized height.
            t: expect.any(Number), // Temperature.
            p: expect.any(Number), // Precipitation.
            w: expect.any(Boolean), // Is water?
            stp: expect.any(Number), // Some sort of stepping/path property? (Assumed from context)
            c: expect.any(Number) // Color index.
          });

          // If the tile is a water tile ('w' is true), it should also have a 'wT' (WaterType) property.
          if ('w' in tile && tile.w) {
            expect(tile).toMatchObject({
              wT: expect.any(Number), // WaterType should be a number.
            });
          }
        });
      });
    });
  });

  // --- Performance and Determinism Tests ---
  // This describe block focuses on non-functional requirements like speed and consistency of generation.
  describe('Performance and Determinism', () => {
    it('should generate terrain within reasonable time', async () => {
      const startTime = Date.now(); // Record the start time.
      const testCoord = { x: 20, y: 20 }; // Define a coordinate for testing generation speed.

      // Request a chunk and set a timeout for the generation.
      await new Promise((resolve, reject) => {
        // Set a timeout of 8 seconds. If the chunk isn't received within this time, reject the promise.
        const timeout = setTimeout(() => {
          reject(new Error('Chunk generation took too long (>8 seconds)'));
        }, 8000);

        adapter.onMessage((data: any) => {
          // When chunk data is received, clear the timeout and resolve the promise.
          if (data.type === 'chunkData') {
            clearTimeout(timeout);
            resolve(data);
          }
        });

        // Send the request for the test chunk.
        adapter.send({ type: 'requestChunk', x: testCoord.x, y: testCoord.y });
      });

      const endTime = Date.now(); // Record the end time.
      // Assert that the total time taken for chunk generation is less than 5 seconds.
      expect(endTime - startTime).toBeLessThan(5000);
    });

    it('should generate identical terrain with same seed', async () => {
      const seedValue = 12345; // Define a specific seed value for deterministic generation.
      const testCoord = { x: 25, y: 25 }; // Define a coordinate for deterministic testing.

      // Request the first chunk with the specified seed.
      const chunk1 = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') resolve(data);
        });
        adapter.send({
          type: 'requestChunk',
          x: testCoord.x,
          y: testCoord.y,
          seed: seedValue // Pass the seed value.
        });
      });

      // Introduce a small delay to ensure distinct requests if the system processes too fast.
      await new Promise(resolve => setTimeout(resolve, 150));

      // Request the second chunk with the *same* specified seed.
      const chunk2 = await new Promise(resolve => {
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData') resolve(data);
        });
        adapter.send({
          type: 'requestChunk',
          x: testCoord.x,
          y: testCoord.y,
          seed: seedValue // Pass the same seed value.
        });
      });

      // Assert that both chunks have the same number of tiles.
      expect((chunk1 as any).chunk.tiles.length).toBe((chunk2 as any).chunk.tiles.length);
      // Iterate through each tile and assert that corresponding tiles in both chunks are identical.
      // This checks for deep equality, ensuring determinism.
      (chunk1 as any).chunk.tiles.forEach((tile1: any, index: number) => {
        const tile2 = (chunk2 as any).chunk.tiles[index];
        expect(tile1).toMatchObject(tile2);
      });
    });
  });
});