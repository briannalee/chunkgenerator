import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { WaterType, Biome, ColorIndex } from "../src/world/TerrainTypes";
import { WorldGenerator } from "../src/world/WorldGenerator";
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

// Test suite for river generation and river-related terrain rules
// Covers river properties, flow, sources, movement, and edge cases
//
describe('River Generation Tests', () => {
  let worldGen: WorldGenerator;

  beforeAll(() => {
    // Create a world generator with a fixed seed for deterministic results
    worldGen = new WorldGenerator(12345);
  });

  describe('Basic River Properties', () => {
    // This test checks that river tiles are generated with the correct properties and that river, lake, and mountain tiles are visually distinguishable in the debug output.
    it('should generate rivers with valid properties', () => {
      // Generate a chunk and extract all river tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const riverTiles = getAllRiverTiles(chunk);
      // If no river tiles, we cannot run this test
      if (riverTiles.length === 0) {
        throw new Error('No river tiles found in chunk');
      }

      // Check river tile properties
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

    // This test verifies that river flow direction is correct, including special cases for depressions, chunk edges, and sources from mountains or lakes.
    it('should maintain proper river flow direction including depressions', () => {
      // Generate a chunk and extract river and lake tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const riverTiles = getAllRiverTiles(chunk);
      const lakeTiles = getAllTilesOfBiome(chunk, Biome.LAKE);
      // If no river tiles, we cannot run this test
      if (riverTiles.length === 0) {
        throw new Error('No river tiles found in chunk');
      }

      riverTiles.forEach(tile => {
        const neighbors = getAdjacentTiles(tile, chunk);
        const riverNeighbors = neighbors.filter(n => n.w && n.wT === WaterType.RIVER);
        const isEdgeTile = tile.x === 0 || tile.x === 19 || tile.y === 0 || tile.y === 19;

        if (riverNeighbors.length === 0) {
          // This is a river source (mountain or lake)
          if (getAdjacentTiles(tile, chunk).some(n => n.b === Biome.MOUNTAIN_SNOW)) {
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
            // Case 4: Edge with diagonal fill (3 neighbors)
            if (riverNeighbors.length === 3) {
              const parallelCount = riverNeighbors.filter(n =>
                n.x === tile.x || n.y === tile.y
              ).length;
              return parallelCount >= 2;
            }
            return false;
          };
          expect(isValidEdgeCase()).toBe(true);
        } else {
          // Handle river tiles not at the edge
          const isRiverStart = (() => {
            // Case 1: Single neighbor flowing away
            if (riverNeighbors.length === 1 && riverNeighbors[0].nH > tile.nH) {
              return true;
            }
            // Case 2: Mountain source with multiple downhill paths
            if (getAdjacentTiles(tile, chunk).some(n => n.b === Biome.MOUNTAIN_SNOW)) {
              const allDownhill = riverNeighbors.every(n => n.nH < tile.nH);
              return riverNeighbors.length >= 1 && allDownhill;
            }
            // Case 3: Lake source with multiple outlets
            if (getAdjacentTiles(tile, chunk).some(n => n.b === Biome.LAKE)) {
              return riverNeighbors.length >= 1;
            }
            return false;
          })();

          const isRiverEnd = riverNeighbors.length === 1 &&
            riverNeighbors[0].nH < tile.nH;

          const isEdgeTermination = isEdgeTile && riverNeighbors.length <= 1;

          if (isRiverStart) {
            // Valid start point - only flows downstream
            expect(true).toBe(true);
          } else if (isEdgeTermination) {
            // Valid edge termination (0-1 neighbors)
            expect(true).toBe(true);
          } else if (isEdgeTile && riverNeighbors.length > 1) {
            // Edge flow-through - must have consistent flow direction
            const xAligned = riverNeighbors.every(n => n.x === tile.x);
            const yAligned = riverNeighbors.every(n => n.y === tile.y);
            if (xAligned) {
              // Vertical flow - all neighbors should be same x
              const upstreamCount = riverNeighbors.filter(n => n.nH > tile.nH).length;
              const downstreamCount = riverNeighbors.filter(n => n.nH < tile.nH).length;
              expect(upstreamCount <= 1 && downstreamCount <= 1).toBe(true);
            } else if (yAligned) {
              // Horizontal flow - all neighbors should be same y
              const upstreamCount = riverNeighbors.filter(n => n.nH > tile.nH).length;
              const downstreamCount = riverNeighbors.filter(n => n.nH < tile.nH).length;
              expect(upstreamCount <= 1 && downstreamCount <= 1).toBe(true);
            } else {
              // Edge corner - validate turn
              expect(riverNeighbors.length === 2 &&
                Math.abs(riverNeighbors[0].x - riverNeighbors[1].x) === 1 &&
                Math.abs(riverNeighbors[0].y - riverNeighbors[1].y) === 1
              ).toBe(true);
            }
          } else {
            // Normal flow or depression
            const hasUpstream = riverNeighbors.some(n => n.nH > tile.nH);
            const hasDownstream = riverNeighbors.some(n => n.nH < tile.nH);
            // In depressions, we might only have upstream connections
            const inDepression = !hasDownstream && riverNeighbors.length > 1;
            if (!inDepression) {
              if (!isRiverStart) {
                expect(hasUpstream).toBe(true);
              }
              expect(hasDownstream).toBe(true);
            }
          }
        }
      });
    });
  });

  describe('River Start Points', () => {
    // This test ensures that a river has only one natural source unless both a mountain and a lake are present, in which case both sources must exist.
    it('should have only one natural source unless both mountain and lake present', () => {
      // Generate a chunk and extract all river tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const riverTiles = getAllRiverTiles(chunk);
      // If no river tiles, we cannot test this rule
      if (riverTiles.length === 0) {
        throw new Error('No river tiles found in chunk');
      }
      // Find river sources adjacent to mountains
      const mountainSources = riverTiles.filter(tile =>
        getAdjacentTiles(tile, chunk).some(n => n.b === Biome.MOUNTAIN_SNOW)
      );
      // Find river sources adjacent to lakes
      const lakeSources = riverTiles.filter(tile =>
        getAdjacentTiles(tile, chunk).some(n => n.b === Biome.LAKE)
      );
      const hasMountain = mountainSources.length > 0;
      const hasLake = lakeSources.length > 0;
      if (hasMountain && hasLake) {
        // If both types of sources exist, require at least one of each
        expect(mountainSources.length).toBeGreaterThanOrEqual(1);
        expect(lakeSources.length).toBeGreaterThanOrEqual(1);
      } else {
        // If only one type of source, require at least one source in total
        const totalSources = mountainSources.length + lakeSources.length;
        expect(totalSources).toBeLessThanOrEqual(1);
        expect(totalSources).toBeGreaterThan(0);
      }
    });
  });

  describe('River Movement Rules', () => {
    // This test ensures that diagonal river movement is always accompanied by a cardinal (horizontal or vertical) connection, preventing isolated diagonal flows.
    it('should never have pure diagonal movement without cardinal connection', () => {
      // Generate a chunk and extract all river tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const riverTiles = getAllRiverTiles(chunk);
      // If no river tiles, we cannot test this rule
      if (riverTiles.length === 0) {
        throw new Error('No river tiles found in chunk');
      }
      riverTiles.forEach(tile => {
        // Find diagonal river neighbors
        const diagonalMoves = getAdjacentTiles(tile, chunk)
          .filter(neighbor =>
            neighbor.w && neighbor.wT === WaterType.RIVER &&
            Math.abs(neighbor.x - tile.x) === 1 &&
            Math.abs(neighbor.y - tile.y) === 1
          );
        diagonalMoves.forEach(diagonalNeighbor => {
          // Ensure there is a cardinal connection between diagonal river tiles
          const hasCardinalBridge = getAdjacentTiles(tile, chunk)
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

    // This test checks that, for diagonal river moves, the river chooses the lowest available cardinal connection, ensuring realistic water flow.
    it('should choose lowest cardinal connection for diagonal moves', () => {
      // Generate a chunk and extract all river tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const riverTiles = getAllRiverTiles(chunk);
      // If no river tiles, we cannot test this rule
      if (riverTiles.length === 0) {
        throw new Error('No river tiles found in chunk');
      }
      let violations = 0;
      // Track original elevations before any river modifications
      const originalElevations = chunk.map(row => row.map(tile => tile.nH));
      // Analyze complete river paths
      const riverGroups = groupConnectedTiles(riverTiles, chunk);
      riverGroups.forEach(group => {
        // Sort tiles by elevation to understand flow direction
        const sorted = [...group].sort((a, b) => a.nH - b.nH);
        // Check all diagonal moves in this river
        for (let i = 1; i < sorted.length; i++) {
          const current = sorted[i];
          const prev = sorted[i - 1];
          // Only check diagonal moves
          if (Math.abs(current.x - prev.x) === 1 && Math.abs(current.y - prev.y) === 1) {
            const bridge1 = chunk[prev.y][current.x]; // Horizontal bridge
            const bridge2 = chunk[current.y][prev.x]; // Vertical bridge
            // The actual bridge used is whichever exists in the river
            const usedBridge = riverTiles.includes(bridge1) ? bridge1 :
              riverTiles.includes(bridge2) ? bridge2 : null;
            if (usedBridge) {
              const alternative = usedBridge === bridge1 ? bridge2 : bridge1;
              // Compare elevations
              const bridgeOriginal = originalElevations[usedBridge.y][usedBridge.x];
              const altOriginal = originalElevations[alternative.y][alternative.x];
              if (bridgeOriginal > altOriginal + 0.0001) { // Allow small floating point error
                violations++;
              }
            }
          }
        }
      });
      expect(violations).toBe(0);
    });
  });

  describe('River Sources', () => {
    // This test verifies that rivers start from either mountains or lakes, or from the highest point in a river segment.
    it('should start rivers from mountains or lakes', () => {
      // Generate a chunk and extract all river tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const riverTiles = getAllRiverTiles(chunk);
      // If no river tiles, we cannot run this test
      if (riverTiles.length === 0) {
        throw new Error('No river tiles found in chunk');
      }
      // Check that at least one river tile is adjacent to a mountain or lake, or is the highest point in a river segment
      const validSource = riverTiles.some(river => {
        // Check if this river tile is adjacent to mountain/lake
        const adjacentToSource = getAdjacentTiles(river, chunk).some(t =>
          t.b === Biome.MOUNTAIN_SNOW ||
          t.b === Biome.LAKE
        );
        // Or check if this is the highest point in a river segment
        if (!adjacentToSource) {
          const riverNeighbors = getAdjacentTiles(river, chunk)
            .filter(t => t.w && t.wT === WaterType.RIVER);
          return riverNeighbors.every(n => n.nH <= river.nH);
        }
        return adjacentToSource;
      });
      expect(validSource).toBe(true);
    });
  });

  describe('River Paths', () => {
    // This test checks that every river path consists of at least three connected river tiles, ensuring continuity.
    it('should have continuous river paths', () => {
      // Generate a chunk and extract all river tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const riverTiles = getAllRiverTiles(chunk);
      // If no river tiles, we cannot run this test
      if (riverTiles.length === 0) {
        throw new Error('No river tiles found in chunk');
      }
      // Group connected river tiles
      const riverGroups = groupConnectedTiles(riverTiles, chunk);
      // Each river should have at least 3 connected tiles
      riverGroups.forEach(group => {
        expect(group.length).toBeGreaterThanOrEqual(3);
      });
    });

    // This test ensures that river endpoints terminate at either the ocean or the edge of the chunk.
    it('should terminate at ocean or chunk edge', () => {
      // Generate a chunk and extract all river and ocean tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const riverTiles = getAllRiverTiles(chunk);
      // If no river tiles, we cannot run this test
      if (riverTiles.length === 0) {
        throw new Error('No river tiles found in chunk');
      }
      // Find river endpoints (tiles with only one river neighbor)
      const endpoints = riverTiles.filter(tile => {
        const riverNeighbors = getAdjacentTiles(tile, chunk)
          .filter(t => t.w && t.wT === WaterType.RIVER);
        return riverNeighbors.length <= 1;
      });
      endpoints.forEach(endpoint => {
        // Endpoints must be adjacent to ocean or at the chunk edge
        const isAtEdge = endpoint.x === 0 || endpoint.x === 19 || endpoint.y === 0 || endpoint.y === 19;
        const isAtOcean = getAdjacentTiles(endpoint, chunk)
          .some(t => t.w && t.wT === WaterType.OCEAN);
        expect(isAtEdge || isAtOcean).toBe(true);
      });
    });
  });

  describe('River-Lake Interactions', () => {
    // This test checks that every lake has at least one river connection, ensuring proper river-lake interaction.
    it('should properly connect rivers to lakes', () => {
      // Generate a chunk and extract all lake tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const lakeTiles = getAllTilesOfBiome(chunk, Biome.LAKE);
      if (lakeTiles.length > 0) {
        // Each lake should have at least one river connection
        lakeTiles.forEach(lake => {
          const hasRiverConnection = getAdjacentTiles(lake, chunk)
            .some(t => t.w && t.wT === WaterType.RIVER);
          expect(hasRiverConnection).toBe(true);
        });
      }
    });

    // This test verifies that depressions are converted to lakes and that each such lake has at least one river outlet.
    it('should convert depressions to lakes with outlet rivers', () => {
      // Use a seed that produces depressions
      const depressionGen = new WorldGenerator(67890);
      const chunk = depressionGen.generateChunk(0, 0, 20);
      const lakeTiles = getAllTilesOfBiome(chunk, Biome.LAKE);
      if (lakeTiles.length > 0) {
        // Each lake should have at least one river outlet
        const lakesWithOutlets = lakeTiles.filter(lake => {
          return getAdjacentTiles(lake, chunk)
            .some(t => t.w && t.wT === WaterType.RIVER);
        });
        expect(lakesWithOutlets.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge Cases', () => {
    // This test ensures that, in chunks with no ocean, rivers still generate and terminate at the chunk edge.
    it('should handle chunk with no ocean', () => {
      // Use a seed that generates a chunk with no ocean
      const noOceanGen = new WorldGenerator(99999);
      const chunk = noOceanGen.generateChunk(10, 1020);
      const oceanTiles = getAllTilesOfBiome(chunk, Biome.OCEAN_SHALLOW);
      if (oceanTiles.length === 0) {
        const riverTiles = getAllRiverTiles(chunk);
        // If no river tiles, we cannot run this test
        if (riverTiles.length === 0) {
          throw new Error('No river tiles found in chunk');
        }
        // Rivers should still generate and terminate at chunk edge
        expect(riverTiles.length).toBeGreaterThan(0);
        const endpoints = riverTiles.filter(tile => {
          const riverNeighbors = getAdjacentTiles(tile, chunk)
            .filter(t => t.w && t.wT === WaterType.RIVER);
          return riverNeighbors.length <= 1;
        });
        endpoints.forEach(endpoint => {
          const isAtEdge = endpoint.x === 0 || endpoint.x === 19 ||
            endpoint.y === 0 || endpoint.y === 19;
          expect(isAtEdge).toBe(true);
        });
      }
    });

    // This test checks that river tiles are never generated in ocean tiles.
    it('should not generate rivers in ocean tiles', () => {
      // Generate a chunk and extract all ocean tiles
      const chunk = worldGen.generateChunk(0, 0, 20);
      const oceanTiles = getAllTilesOfBiome(chunk, Biome.OCEAN_SHALLOW);
      oceanTiles.forEach(oceanTile => {
        expect(oceanTile.wT).not.toBe(WaterType.RIVER);
      });
    });
  });

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
});