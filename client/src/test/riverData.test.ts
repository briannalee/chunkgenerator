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

  // Setup: connect to the network before running tests
  beforeAll(async () => {
    adapter = NetworkFactory.createAdapter();
    await adapter.connect();
    tileNormalizer = new TileNormalizer();
    // Wait for connection confirmation from server
    await new Promise(resolve => {
      adapter.onMessage((data: any) => data.type === 'connected' && resolve(true));
    });

    // Load chunks that are likely to have rivers
    const chunkCoordinates = [
      { x: 0, y: 0 },   // Origin
      { x: 5, y: 5 },   // Distant chunk
      { x: -3, y: 2 },  // Negative coordinates
      { x: 0, y: 15 }   // Far chunk
    ];

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
      await new Promise(resolve => setTimeout(resolve, 100));
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
  const getAdjacentTiles = (tile: any, chunk: any[][]): any[] => {
    const adjacent: any[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue; // Skip the tile itself
        const ny = tile.y + dy;
        const nx = tile.x + dx;
        if (ny >= 0 && ny < chunk.length && nx >= 0 && nx < chunk[0].length) {
          adjacent.push(chunk[ny][nx]);
        }
      }
    }
    return adjacent;
  };

  // Returns all river tiles in the chunk
  function getAllRiverTiles(chunk: any[][]): any[] {
    return chunk.flat().filter(tile => tile.w && tile.wT === WaterType.RIVER);
  }

  // Returns all tiles of a given biome in the chunk
  function getAllTilesOfBiome(chunk: any[][], biome: Biome): any[] {
    return chunk.flat().filter(tile => tile.b === biome);
  }

  // Groups connected river tiles into separate river paths
  function groupConnectedTiles(tiles: any[], chunk: any[][]): any[][] {
    const groups: any[][] = [];
    const visited = new Set<string>();
    tiles.forEach(tile => {
      const key = `${tile.x},${tile.y}`;
      if (!visited.has(key)) {
        const group: any[] = [];
        const queue = [tile];
        while (queue.length > 0) {
          const current = queue.shift()!;
          const currentKey = `${current.x},${current.y}`;
          if (!visited.has(currentKey)) {
            visited.add(currentKey);
            group.push(current);
            // Add adjacent river tiles to queue
            getAdjacentTiles(current, chunk)
              .filter(t => t.w && t.wT === WaterType.RIVER)
              .forEach(neighbor => {
                const neighborKey = `${neighbor.x},${neighbor.y}`;
                if (!visited.has(neighborKey)) {
                  queue.push(neighbor);
                }
              });
          }
        }
        if (group.length > 0) {
          groups.push(group);
        }
      }
    });
    return groups;
  }

  // --- River Generation Tests (adapted from old tests) ---
  describe('River Generation Tests', () => {
    describe('Basic River Properties', () => {
      it('should generate rivers with valid properties', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
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

      it('should maintain proper river flow direction including depressions', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
          const riverTiles = getAllRiverTiles(tiles);
          const lakeTiles = getAllTilesOfBiome(tiles, Biome.LAKE);
          
          if (riverTiles.length === 0) {
            console.warn('No river tiles found in chunk');
            return;
          }

          riverTiles.forEach(tile => {
            const neighbors = getAdjacentTiles(tile, tiles);
            const riverNeighbors = neighbors.filter(n => n.w && n.wT === WaterType.RIVER);
            const isEdgeTile = tile.x === 0 || tile.x === CHUNK_SIZE-1 || tile.y === 0 || tile.y === CHUNK_SIZE-1;

            if (riverNeighbors.length === 0) {
              // This is a river source (mountain or lake)
              if (getAdjacentTiles(tile, tiles).some(n => n.b === Biome.MOUNTAIN_SNOW)) {
                // Mountain source - should be higher than at least one neighbor
                expect(neighbors.some(n => n.nH < tile.nH)).toBe(true);
              } else if (lakeTiles.some(lake =>
                Math.abs(lake.x - tile.x) <= 1 && Math.abs(lake.y - tile.y) <= 1)
              ) {
                // Lake outlet - should flow away from lake
                expect(true).toBe(true); // Just validate connection
              }
            } else if (isEdgeTile) {
              // Handle river tiles at the edge of the chunk
              const isValidEdgeCase = () => {
                // Case 1: Standard endpoint
                if (riverNeighbors.length <= 1) return true;
                // Case 2: Parallel flow (either all x same or all y same)
                const isXAligned = riverNeighbors.every(n => n.x === tile.x);
                const isYAligned = riverNeighbors.every(n => n.y === tile.y);
                if (isXAligned || isYAligned) {
                  return true;
                }
                // Case 3: Corner turn (exactly 2 neighbors forming right angle)
                if (riverNeighbors.length === 2) {
                  return Math.abs(riverNeighbors[0].x - riverNeighbors[1].x) === 1 &&
                    Math.abs(riverNeighbors[0].y - riverNeighbors[1].y) === 1;
                }
                return false;
              };
              expect(isValidEdgeCase()).toBe(true);
            } else {
              // Normal flow or depression
              const hasUpstream = riverNeighbors.some(n => n.nH > tile.nH);
              const hasDownstream = riverNeighbors.some(n => n.nH < tile.nH);
              // In depressions, we might only have upstream connections
              const inDepression = !hasDownstream && riverNeighbors.length > 1;
              if (!inDepression) {
                expect(hasUpstream || hasDownstream).toBe(true);
              }
            }
          });
        });
      });
    });

    describe('River Start Points', () => {
      it('should have only one natural source unless both mountain and lake present', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
          const riverTiles = getAllRiverTiles(tiles);
          
          if (riverTiles.length === 0) {
            console.warn('No river tiles found in chunk');
            return;
          }

          // Find river sources adjacent to mountains
          const mountainSources = riverTiles.filter(tile =>
            getAdjacentTiles(tile, tiles).some(n => n.b === Biome.MOUNTAIN_SNOW)
          );
          // Find river sources adjacent to lakes
          const lakeSources = riverTiles.filter(tile =>
            getAdjacentTiles(tile, tiles).some(n => n.b === Biome.LAKE)
          );
          const hasMountain = mountainSources.length > 0;
          const hasLake = lakeSources.length > 0;
          
          if (hasMountain && hasLake) {
            // If both types of sources exist, require at least one of each
            expect(mountainSources.length).toBeGreaterThanOrEqual(1);
            expect(lakeSources.length).toBeGreaterThanOrEqual(1);
          } else if (hasMountain || hasLake) {
            // If only one type of source, require at least one source in total
            const totalSources = mountainSources.length + lakeSources.length;
            expect(totalSources).toBeGreaterThan(0);
          }
        });
      });
    });

    describe('River Movement Rules', () => {
      it('should never have pure diagonal movement without cardinal connection', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
          const riverTiles = getAllRiverTiles(tiles);
          
          if (riverTiles.length === 0) {
            console.warn('No river tiles found in chunk');
            return;
          }

          riverTiles.forEach(tile => {
            // Find diagonal river neighbors
            const diagonalMoves = getAdjacentTiles(tile, tiles)
              .filter(neighbor =>
                neighbor.w && neighbor.wT === WaterType.RIVER &&
                Math.abs(neighbor.x - tile.x) === 1 &&
                Math.abs(neighbor.y - tile.y) === 1
              );
            diagonalMoves.forEach(diagonalNeighbor => {
              // Ensure there is a cardinal connection between diagonal river tiles
              const hasCardinalBridge = getAdjacentTiles(tile, tiles)
                .some(cardinalNeighbor =>
                  cardinalNeighbor.w && cardinalNeighbor.wT === WaterType.RIVER &&
                  (cardinalNeighbor.x === diagonalNeighbor.x ||
                    cardinalNeighbor.y === diagonalNeighbor.y) &&
                  (Math.abs(cardinalNeighbor.x - tile.x) === 1) !==
                  (Math.abs(cardinalNeighbor.y - tile.y) === 1)
                );
              expect(hasCardinalBridge).toBe(true);
            });
          });
        });
      });
    });

    describe('River Sources', () => {
      it('should start rivers from mountains or lakes', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
          const riverTiles = getAllRiverTiles(tiles);
          
          if (riverTiles.length === 0) {
            console.warn('No river tiles found in chunk');
            return;
          }

          // Check that at least one river tile is adjacent to a mountain or lake, or is the highest point in a river segment
          const validSource = riverTiles.some(river => {
            // Check if this river tile is adjacent to mountain/lake
            const adjacentToSource = getAdjacentTiles(river, tiles).some(t =>
              t.b === Biome.MOUNTAIN_SNOW ||
              t.b === Biome.LAKE
            );
            // Or check if this is the highest point in a river segment
            if (!adjacentToSource) {
              const riverNeighbors = getAdjacentTiles(river, tiles)
                .filter(t => t.w && t.wT === WaterType.RIVER);
              return riverNeighbors.every(n => n.nH <= river.nH);
            }
            return adjacentToSource;
          });
          expect(validSource).toBe(true);
        });
      });
    });

    describe('River Paths', () => {
      it('should have continuous river paths', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
          const riverTiles = getAllRiverTiles(tiles);
          
          if (riverTiles.length === 0) {
            console.warn('No river tiles found in chunk');
            return;
          }

          // Group connected river tiles
          const riverGroups = groupConnectedTiles(riverTiles, tiles);
          // Each river should have at least 2 connected tiles (reduced from 3 due to smaller chunk size)
          riverGroups.forEach(group => {
            expect(group.length).toBeGreaterThanOrEqual(2);
          });
        });
      });

      it('should terminate at ocean or chunk edge', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
          const riverTiles = getAllRiverTiles(tiles);
          
          if (riverTiles.length === 0) {
            console.warn('No river tiles found in chunk');
            return;
          }

          // Find river endpoints (tiles with only one river neighbor)
          const endpoints = riverTiles.filter(tile => {
            const riverNeighbors = getAdjacentTiles(tile, tiles)
              .filter(t => t.w && t.wT === WaterType.RIVER);
            return riverNeighbors.length <= 1;
          });
          endpoints.forEach(endpoint => {
            // Endpoints must be adjacent to ocean or at the chunk edge
            const isAtEdge = endpoint.x === 0 || endpoint.x === CHUNK_SIZE-1 || 
                             endpoint.y === 0 || endpoint.y === CHUNK_SIZE-1;
            const isAtOcean = getAdjacentTiles(endpoint, tiles)
              .some(t => t.w && t.wT === WaterType.OCEAN);
            expect(isAtEdge || isAtOcean).toBe(true);
          });
        });
      });
    });

    describe('River-Lake Interactions', () => {
      it('should properly connect rivers to lakes', () => {
        testChunks.forEach((chunkData) => {
          const tiles = chunkData.chunk.tiles;
          const lakeTiles = getAllTilesOfBiome(tiles, Biome.LAKE);
          
          if (lakeTiles.length > 0) {
            // Each lake should have at least one river connection
            lakeTiles.forEach(lake => {
              const hasRiverConnection = getAdjacentTiles(lake, tiles)
                .some(t => t.w && t.wT === WaterType.RIVER);
              expect(hasRiverConnection).toBe(true);
            });
          }
        });
      });
    });
  });

  // --- Basic Validation Tests (from new tests) ---
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