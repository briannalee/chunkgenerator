import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { INetworkAdapter } from "../network/INetworkAdapter";
import { NetworkFactory } from "../network/NetworkFactory";
import { WaterType, SoilType, Biome, ColorIndex } from "shared/TerrainTypes";
import { TileNormalizer } from "../logic/NormalizeTiles";
import { Tile } from "shared/TileTypes";
import { T } from "vitest/dist/chunks/reporters.d.C-cu31ET";

// Main test suite for terrain quality
// This 'describe' block defines a test suite focused on the generation and quality of rivers within the game's terrain.
describe('River Generation and Quality Tests', () => {
  // Declare variables that will be used across multiple tests within this suite.
  let adapter: INetworkAdapter; // Network adapter to communicate with the terrain generation service.
  let testChunks: any[] = []; // Array to store chunk data that contains rivers, used for testing.
  const CHUNK_SIZE = 10; // Defines the size of a chunk (e.g., 10x10 tiles).

  // These two values roughly determine the min % of terrain that must be rivers
  const MIN_RIVER_TILES = 5; // Minimum number of river tiles required to perform tests on
  const MAX_TRIES = 100; // Maximum amount of chunks to try when looking for river tiles.

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

    let tries = 0; // Counter for random chunk request attempts.
    let found = 0; // Counter for chunks found that contain rivers.
    const seenCoords = new Set<string>(); // Set to store coordinates of requested chunks to avoid duplicates.

    // Hardcoded chunk coordinates to request initially.
    // Useful for debug or testing known chunks
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
    while (found < MIN_RIVER_TILES && tries < MAX_TRIES) {
      // Generate random chunk coordinates within a reasonable range.
      const x = Math.floor(Math.random() * 200) - 100;
      const y = Math.floor(Math.random() * 200) - 100;
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
      // If rivers are present (avoiding chunks with <MIN_RIVER_TILES), add the chunk to the testChunks and increment 'found'.
      if (riverTiles.length >= MIN_RIVER_TILES) {
        testChunks.push(chunkData);
        found++;
      }

      // Introduce a small delay.
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // After attempting to gather chunks, if fewer than 5 chunks with rivers were found, log a warning.
    if (testChunks.length < MIN_RIVER_TILES) {
      console.warn(`Only found ${testChunks.length} chunks with rivers after ${tries} random tries. River generation too sparse. Minimum river tiles: ${MIN_RIVER_TILES}`);
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
   * @param x - The local x-coordinate of the tile.
   * @param y - The local y-coordinate of the tile.
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

        // Since we are checking only the inner 9x9 grid, all tiles should have 8 neighbors
        expect(neighbors.length).toBe(8);

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
      // very rare (as to violate spec) or too small 
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

      // New test: Check that 75% of chunks have more than 5 river tiles
      it('should have at least 75% of chunks containing more than 5 river tiles', () => {
        let chunksMeetingCriteriaCount = 0; // Counter for chunks that meet the criteria
        const minRiverTilesPerChunk = 5; // Minimum number of river tiles required per chunk
        const requiredRatio = 0.75; // 75%

        testChunks.forEach(({ chunk }) => {
          const riverTiles = getAllRiverTiles(chunk.tiles);
          // Check if the number of river tiles is strictly greater than the minimum
          if (riverTiles.length > minRiverTilesPerChunk) {
            chunksMeetingCriteriaCount++;
          }
        });

        // Calculate the actual percentage of chunks that met the criteria
        const percentageMeetingCriteria = (chunksMeetingCriteriaCount / testChunks.length);

        // Assert that the percentage is greater than or equal to the required ratio
        // Add a console warning if the condition is not met for easier debugging
        if (percentageMeetingCriteria < requiredRatio) {
          console.warn(`Only ${chunksMeetingCriteriaCount} out of ${testChunks.length} chunks (${(percentageMeetingCriteria * 100).toFixed(2)}%) had more than ${minRiverTilesPerChunk} river tiles. Expected at least ${(requiredRatio * 100).toFixed(2)}%.`);
        }
        expect(percentageMeetingCriteria).toBeGreaterThanOrEqual(requiredRatio);
      });

      it('should have at least 50% of chunks containing at least 10 regular tiles', () => {
        let chunksMeetingCriteriaCount = 0; // Counter for chunks that meet the criteria
        const minRegularTilesPerChunk = 10; // Minimum number of non-river tiles required per chunk
        const requiredRatio = 0.50; // 50%

        testChunks.forEach(({ chunk }) => {
          const tiles = chunk.tiles;
          const riverTiles = getAllRiverTiles(tiles);
          const nonRiverTilesCount = tiles.length - riverTiles.length;

          if (nonRiverTilesCount >= minRegularTilesPerChunk) {
            chunksMeetingCriteriaCount++;
          }
        });

        // Calculate the percentage of chunks that met the criteria
        const percentageMeetingCriteria = (chunksMeetingCriteriaCount / testChunks.length);

        // Assert that the percentage is greater than or equal to the required ratio
        expect(percentageMeetingCriteria).toBeGreaterThanOrEqual(requiredRatio);
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
            if (tile.nH < 0.3) {
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

        testChunks.forEach((chunkData) => {
          // Convert the flat tile array to a 2D grid for easier spatial analysis.
          const tileGrid = to2DTileGrid(chunkData.chunk.tiles, CHUNK_SIZE, CHUNK_SIZE);
          const riverTiles = getAllRiverTiles(chunkData.chunk.tiles); // Get river tiles.

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
            // Calculate local coordinates within the current chunk
            const localTileX = (tile.x % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;
            const localTileY = (tile.y % CHUNK_SIZE + CHUNK_SIZE) % CHUNK_SIZE;

            const neighbors = getAdjacentTilesAt(tileGrid, localTileX, localTileY);

            // A tile should never have less than 3 neighbors (corner tiles)
            expect(neighbors.length).toBeGreaterThanOrEqual(3);

            const directionsCovered = new Set(); // Set to store unique directions covered by river neighbors.

            neighbors.forEach(n => {
              // If a neighbor is also a river tile, determine the direction relative to the current tile.
              if (n.w && n.wT === WaterType.RIVER) {
                // 'n' (neighbor) also has local chunk coordinates (0 to CHUNK_SIZE-1)
                // because it's retrieved from the 'tileGrid' which is built from local coordinates.
                // Therefore, dx and dy calculated from these local coordinates are correct for directions.
                const dx = n.x - localTileX; // X-difference (e.g., -1, 0, 1)
                const dy = n.y - localTileY; // Y-difference (e.g., -1, 0, 1)
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

      // This tests checks chunk border continuity using row/column/point requests to get bordering chunk data.
      // This is how the client determines tile interpolation, so it is very important
      it('should have at least one river that continues across a chunk boundary (including diagonals)', async () => {
        const fetchedData = new Map<string, any>();
        const pendingRequests = new Set<string>();

        function chunkKey(x: number, y: number): string {
          return `${x},${y}`;
        }

        function borderKey(worldX: number, worldY: number): string {
          return `${worldX},${worldY}`;
        }

        // Helper to wait for border data
        async function waitForBorderData(key: string): Promise<any> {
          const maxWait = 500;
          const interval = 50;
          let elapsed = 0;

          while (elapsed < maxWait) {
            if (fetchedData.has(key)) {
              return fetchedData.get(key);
            }
            await new Promise(res => setTimeout(res, interval));
            elapsed += interval;
          }

          console.warn(`Border data for ${key} not available after waiting.`);
          return null;
        }

        // Helper to request border data if missing
        function requestBorderIfMissing(key: string, worldX: number, worldY: number, mode: string) {
          if (!fetchedData.has(key) && !pendingRequests.has(key)) {
            pendingRequests.add(key);
            adapter.send({ type: "requestChunk", x: worldX, y: worldY, mode });
          }
        }

        // Set up message handler for border data
        adapter.onMessage((data: any) => {
          if (data.type === 'chunkData' && data.chunk) {
            // Normalize tiles
            data.chunk.tiles = TileNormalizer.NormalizeTiles(data.chunk.tiles);

            // Store in cache using appropriate key
            if (data.mode === 'row' || data.mode === 'column' || data.mode === 'point') {
              const key = borderKey(data.x, data.y);
              fetchedData.set(key, data);
              pendingRequests.delete(key);
            } else {
              // Full chunk
              const key = chunkKey(data.chunk.x, data.chunk.y);
              fetchedData.set(key, data);
              pendingRequests.delete(key);
            }
          }
        });

        let foundConnected = false;

        for (const { chunk } of testChunks) {
          const { x: chunkX, y: chunkY, tiles } = chunk;
          const key = chunkKey(chunkX, chunkY);
          fetchedData.set(key, { chunk }); // prime cache

          // Convert chunk coordinates to world coordinates
          const chunkWorldX = chunkX * CHUNK_SIZE;
          const chunkWorldY = chunkY * CHUNK_SIZE;

          // Filter for river tiles that are on the very edge of the CURRENT chunk
          const edgeRiverTiles = tiles.filter((t: Tile) =>
            t.w && t.wT === WaterType.RIVER &&
            (
              t.x === chunkWorldX ||
              t.x === chunkWorldX + CHUNK_SIZE - 1 ||
              t.y === chunkWorldY ||
              t.y === chunkWorldY + CHUNK_SIZE - 1
            )
          );

          if (edgeRiverTiles.length === 0) continue;

          // Define edge directions for row/column requests
          const edgeDefs = [
            {
              dx: -1, dy: 0, mode: 'column',
              worldX: chunkWorldX - 1, worldY: chunkWorldY,
              borderKey: borderKey(chunkWorldX - 1, chunkWorldY)
            },
            {
              dx: 1, dy: 0, mode: 'column',
              worldX: chunkWorldX + CHUNK_SIZE, worldY: chunkWorldY,
              borderKey: borderKey(chunkWorldX + CHUNK_SIZE, chunkWorldY)
            },
            {
              dx: 0, dy: -1, mode: 'row',
              worldX: chunkWorldX, worldY: chunkWorldY - 1,
              borderKey: borderKey(chunkWorldX, chunkWorldY - 1)
            },
            {
              dx: 0, dy: 1, mode: 'row',
              worldX: chunkWorldX, worldY: chunkWorldY + CHUNK_SIZE,
              borderKey: borderKey(chunkWorldX, chunkWorldY + CHUNK_SIZE)
            }
          ];

          // Define corner directions for point requests
          const cornerDefs = [
            {
              dx: -1, dy: -1,
              worldX: chunkWorldX - 1,
              worldY: chunkWorldY - 1,
              borderKey: borderKey(chunkWorldX - 1, chunkWorldY - 1)
            },
            {
              dx: 1, dy: -1,
              worldX: chunkWorldX + CHUNK_SIZE,
              worldY: chunkWorldY - 1,
              borderKey: borderKey(chunkWorldX + CHUNK_SIZE, chunkWorldY - 1)
            },
            {
              dx: -1, dy: 1,
              worldX: chunkWorldX - 1,
              worldY: chunkWorldY + CHUNK_SIZE,
              borderKey: borderKey(chunkWorldX - 1, chunkWorldY + CHUNK_SIZE)
            },
            {
              dx: 1, dy: 1,
              worldX: chunkWorldX + CHUNK_SIZE,
              worldY: chunkWorldY + CHUNK_SIZE,
              borderKey: borderKey(chunkWorldX + CHUNK_SIZE, chunkWorldY + CHUNK_SIZE)
            }
          ];

          // Request all border data upfront
          for (const { worldX, worldY, mode, borderKey: bKey } of edgeDefs) {
            requestBorderIfMissing(bKey, worldX, worldY, mode);
          }

          for (const { worldX, worldY, borderKey: bKey } of cornerDefs) {
            requestBorderIfMissing(bKey, worldX, worldY, 'point');
          }

          // Wait for all border data
          const borderPromises = edgeDefs.map(({ borderKey: bKey }) =>
            waitForBorderData(bKey)
          );
          const cornerPromises = cornerDefs.map(({ borderKey: bKey }) =>
            waitForBorderData(bKey)
          );

          await Promise.all([...borderPromises, ...cornerPromises]);

          // Check each edge river tile against all 8 directions
          const directions = [
            [-1, -1], [0, -1], [1, -1],
            [-1, 0], [1, 0],
            [-1, 1], [0, 1], [1, 1]
          ];

          for (const tile of edgeRiverTiles) {
            for (const [dx, dy] of directions) {
              const neighborGlobalX = tile.x + dx;
              const neighborGlobalY = tile.y + dy;

              // Calculate which chunk the neighbor belongs to
              const potentialNeighborChunkX = Math.floor(neighborGlobalX / CHUNK_SIZE);
              const potentialNeighborChunkY = Math.floor(neighborGlobalY / CHUNK_SIZE);

              // Skip if neighbor is in the same chunk
              if (potentialNeighborChunkX === chunkX && potentialNeighborChunkY === chunkY) {
                continue;
              }

              // Determine which border data to check
              let borderData = null;
              let searchKey = '';

              // Check if this is a corner (diagonal) neighbor
              if (dx !== 0 && dy !== 0) {
                // This is a corner - use point request
                searchKey = borderKey(neighborGlobalX, neighborGlobalY);
                borderData = fetchedData.get(searchKey);
              } else {
                // This is an edge neighbor - use row/column request
                if (dx === 0) {
                  // Vertical neighbor - use row request
                  searchKey = borderKey(chunkWorldX, neighborGlobalY);
                } else {
                  // Horizontal neighbor - use column request
                  searchKey = borderKey(neighborGlobalX, chunkWorldY);
                }
                borderData = fetchedData.get(searchKey);
              }

              if (borderData && borderData.chunk && borderData.chunk.tiles) {
                // Find the specific tile using global coordinates
                const neighborTile = borderData.chunk.tiles.find((t: Tile) =>
                  t.x === neighborGlobalX && t.y === neighborGlobalY
                );

                if (neighborTile && neighborTile.w && neighborTile.wT === WaterType.RIVER) {
                  foundConnected = true;
                  break;
                }
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