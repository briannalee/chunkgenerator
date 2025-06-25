import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TileBlending } from "../src/logic/TileBlending";
import { ColorCalculations } from "../src/logic/ColorCalculations";
import { INetworkAdapter } from "../src/network/INetworkAdapter";
import { NetworkFactory } from "../src/network/NetworkFactory";;
import { TileNormalizer } from "../src/logic/NormalizeTiles";
import { GameLogic } from "../src/logic/GameLogic";

// This test suite validates the tile blending logic in a live, multi-chunk environment.
// It covers edge cases, intra-chunk blending, chunk borders, and corner blending for a variety of chunk coordinates.
describe("Tile Blending Live", () => {

  let testChunks: any[] = [];
  let gameLogic: GameLogic;

  // Define hardcoded test chunk coordinates for coverage of various map areas
  let chunkCoordinates = [
    { x: 0, y: 0 },   // Origin
    { x: 5, y: 5 },   // Distant chunk
    { x: -3, y: 2 },  // Negative coordinates
    { x: 10, y: -7 }, // Mixed coordinates
    { x: 0, y: 15 }   // Far chunk
  ];

  // Randomly generated chunk coordinates for additional coverage
  for (let i = 0; i < 15; i++) {
    chunkCoordinates.push({
      x: Math.floor(Math.random() * 5000) - 2500,
      y: Math.floor(Math.random() * 5000) - 2500
    });
  }


  beforeAll(async () => {
    gameLogic = new GameLogic();
    await gameLogic.connect();

    // Request each chunk
    await Promise.all(
      chunkCoordinates.flatMap(({ x, y }) => [
        gameLogic.requestChunk(x, y, "chunk"),
      ])
    );

    // Wait for all chunk requests to be processed
    await new Promise(resolve => setTimeout(resolve, 500)); // crude sync delay to ensure all requests are processed

    await new Promise(r => setTimeout(r, 500)); // crude sync delay

    // Gather all loaded chunks with their borders for testing
    for (const coord of chunkCoordinates) {
      const chunk = await gameLogic.getChunkWithBorders(coord.x, coord.y);
      if (chunk) {
        testChunks.push({ chunk });
      } else {
        console.warn(`Chunk (${coord.x}, ${coord.y}) or its neighbors failed to load`);
      }
    }
    expect(testChunks.length).toBeGreaterThan(0);
  }, 30000);

  // Cleanup: disconnect after all tests
  afterAll(async () => {
    await gameLogic.disconnect();
  });


  // Test 1: Checks that tiles are only marked as blendable if they have at least one neighbor with a different biome that is blendable.
  it("should correctly identify blendable tiles with different neighboring biomes", () => {
    testChunks.forEach((chunkData) => {
      const tiles = chunkData.chunk.tiles;

      tiles.forEach((tile: any) => {

        const neighbors = getAdjacentTiles(tile, tiles);
        const neighborMap = {
          north: neighbors.north,
          south: neighbors.south,
          east: neighbors.east,
          west: neighbors.west,
        };

        const shouldBlend = TileBlending.shouldBlendWithNeighbors(tile, neighborMap);
        const hasDifferentBiomeNeighbor = Object.values(neighborMap)
          .filter(n => n)
          .some(n => n.b !== tile.b && TileBlending.canBlendBiomes(tile.b, n.b));

        // The tile should be blendable if and only if it has a blendable neighbor with a different biome
        expect(shouldBlend).toBe(hasDifferentBiomeNeighbor);
      });
    });
  });

  // Test 2: Ensures that edge tiles (on the border of a chunk) produce a blended color if they have blendable neighbors, including across chunk borders.
  it("should produce a blended color when on chunk edge with blendable neighbors", async () => {
    for (const chunkData of testChunks) {
      const chunkWithBorders = await gameLogic.getChunkWithBorders(chunkData.chunk.x, chunkData.chunk.y);
      expect(chunkWithBorders).toBeDefined();
      if (!chunkWithBorders) continue;

      const { tiles } = chunkWithBorders;
      tiles.forEach((tile: any) => {
        const neighbors = getAdjacentTiles(tile, tiles); // now using all available tiles
        const neighborMap = {
          north: neighbors.north,
          south: neighbors.south,
          east: neighbors.east,
          west: neighbors.west,
        };

        const { localX, localY } = getLocalTileCoords(tile, chunkData.chunk.x, chunkData.chunk.y);

        if (localX < 0 || localX > 9 || localY < 0 || localY > 9) return; // filter out border padding
        if (localX !== 0 && localX !== 9 && localY !== 0 && localY !== 9) return; // only true edge

        const baseColor = tile.c;
        const blendedColor = TileBlending.calculateBlendedColor(tile, neighborMap, tile.x, tile.y, 8, baseColor);
        const shouldBlend = TileBlending.shouldBlendWithNeighbors(tile, neighborMap);

        // If blending is expected but the color did not change, log a warning for debugging
        if (shouldBlend && blendedColor === baseColor) {
          const neighborSummary = Object.entries(neighborMap).reduce((acc, [dir, t]) => {
            acc[dir] = t ? {
              x: t.x,
              y: t.y,
              b: t.b,
              w: t.w,
              iC: t.iC
            } : null;
            return acc;
          }, {} as Record<string, any>);

          console.warn(`Tile at (${tile.x}, ${tile.y}) in chunk (${chunkData.chunk.x}, ${chunkData.chunk.y}) failed to blend chunk edges. Me:`, JSON.stringify(tile), "Neighbors: ", JSON.stringify(neighborSummary, null, 2));
        }

        // If the tile should blend, the color must be different from the base color
        if (shouldBlend) {
          expect(blendedColor).not.toBe(baseColor);
        }
      });
    }
  });

  // Test 3: Validates that intra-chunk (non-edge) tiles blend at the edges of their sub-tiles, but not at the center.
  it("should blend intra-chunk tiles with different blendable neighbors", () => {
    testChunks.forEach((chunkData) => {
      const tiles = chunkData.chunk.tiles;
      const edgeThreshold = 2;
      const subTilesPerSide = 8;

      tiles.forEach((tile: any) => {

        const { localX, localY } = getLocalTileCoords(tile, chunkData.chunk.x, chunkData.chunk.y);
        if (localX < 1 || localX > 8 || localY < 1 || localY > 8) return; // skip edges and borders

        const neighbors = getAdjacentTiles(tile, tiles);
        const neighborMap = {
          north: neighbors.north,
          south: neighbors.south,
          east: neighbors.east,
          west: neighbors.west,
        };
        const baseColor = tile.c;
        const shouldBlend = TileBlending.shouldBlendWithNeighbors(tile, neighborMap);
        // Sample points: corners, edges, and center of the tile's sub-tile grid
        const samplePoints = [
          { sx: 0, sy: 0 },
          { sx: 4, sy: 0 },
          { sx: 7, sy: 0 },
          { sx: 4, sy: 4 },
          { sx: 0, sy: 7 },
          { sx: 7, sy: 7 },
        ];

        samplePoints.forEach(({ sx, sy }) => {
          const blendedColor = TileBlending.calculateBlendedColor(tile, neighborMap, sx, sy, 8, baseColor);

          if (sx === 4 && sy === 4) {
            // Center point: should never blend, must match base color
            expect(blendedColor).toBe(baseColor);
          } else {
            // Edge/corner points: should blend if blending is expected
            if (shouldBlend) {
              if (blendedColor === baseColor) {
                // log debug info
                console.warn(`Blending failed intra-chunk tile. Chunk: X ${chunkData.chunk.x} Y ${chunkData.chunk.y} Tile: X ${tile.x} Y ${tile.y}`, { tile, neighborMap });
              }
              expect(blendedColor).not.toBe(baseColor);
            }
          }
        });
      });
    });
  });

  // Test 4: Checks that corner tiles blend correctly when they have blendable neighbors in both relevant directions (e.g., north+west for top-left).
  it("should handle corner tiles with blending from multiple directions", () => {
    testChunks.forEach((chunkData) => {
      const tiles = chunkData.chunk.tiles;
      // Find the four corner tiles of the chunk
      const cornerTiles = tiles.filter((tile: any) => {
        const { localX, localY } = getLocalTileCoords(tile, chunkData.chunk.x, chunkData.chunk.y);
        return (localX === 0 && localY === 0) || // top-left
          (localX === 9 && localY === 0) || // top-right
          (localX === 0 && localY === 9) || // bottom-left
          (localX === 9 && localY === 9);   // bottom-right
      });

      cornerTiles.forEach((tile: any) => {
        const neighbors = getAdjacentTiles(tile, tiles);
        const neighborMap = {
          north: neighbors.north,
          south: neighbors.south,
          east: neighbors.east,
          west: neighbors.west,
        };

        // Check if this is a true corner case (has neighbors in both relevant directions)
        const isCornerCase =
          (tile.x === chunkData.chunk.x * 10 && tile.y === chunkData.chunk.y * 10 && neighbors.east && neighbors.south) || // top-left
          (tile.x === chunkData.chunk.x * 10 + 9 && tile.y === chunkData.chunk.y * 10 && neighbors.west && neighbors.south) || // top-right
          (tile.x === chunkData.chunk.x * 10 && tile.y === chunkData.chunk.y * 10 + 9 && neighbors.east && neighbors.north) || // bottom-left
          (tile.x === chunkData.chunk.x * 10 + 9 && tile.y === chunkData.chunk.y * 10 + 9 && neighbors.west && neighbors.north); // bottom-right

        if (isCornerCase) {
          const baseColor = tile.c;
          const blendedColor = TileBlending.calculateBlendedColor(tile, neighborMap, 0, 0, 8, baseColor);

          // Should blend if at least two different biome neighbors
          const shouldBlend = Object.values(neighborMap)
            .filter(n => n && TileBlending.canBlendBiomes(tile.b, n.b))
            .length >= 2;

          if (shouldBlend) {
            expect(blendedColor).not.toBe(baseColor);
          }
        }
      });
    });
  });
});

/**
 * Get adjacent tiles (8-directional) for a given tile based on (x, y) position.
 * @param tile - The reference tile.
 * @param tiles - Flat array of all tiles in the same chunk (or combined chunks if cross-border).
 * @returns An object mapping direction names to neighboring tiles, or `undefined` if not present.
 */
function getAdjacentTiles(tile: { x: number; y: number }, tiles: Array<{ x: number; y: number }>) {
  const neighbors: Record<
    'north' | 'south' | 'east' | 'west' | 'northeast' | 'northwest' | 'southeast' | 'southwest',
    any | undefined
  > = {
    north: undefined,
    south: undefined,
    east: undefined,
    west: undefined,
    northeast: undefined,
    northwest: undefined,
    southeast: undefined,
    southwest: undefined
  };

  const posMap = new Map<string, any>();
  for (const t of tiles) {
    posMap.set(`${t.x},${t.y}`, t);
  }

  const offsets = {
    north: [0, -1],
    south: [0, 1],
    east: [1, 0],
    west: [-1, 0],
    northeast: [1, -1],
    northwest: [-1, -1],
    southeast: [1, 1],
    southwest: [-1, 1]
  };

  for (const dir in offsets) {
    const [dx, dy] = offsets[dir as keyof typeof offsets];
    const neighbor = posMap.get(`${tile.x + dx},${tile.y + dy}`);
    neighbors[dir as keyof typeof neighbors] = neighbor;
  }

  return neighbors;
}

/**
 * Gets the local coordinates of a tile within a chunk.
 * This is used to determine the tile's position relative to its chunk.
 * @param tile - The tile to get local coordinates for.
 * @param chunkX - The chunk's x coordinate.
 * @param chunkY - The chunk's y coordinate.
 * @returns - An object containing localX and localY coordinates of the tile within the chunk.
 */
function getLocalTileCoords(tile: { x: number; y: number }, chunkX: number, chunkY: number) {
  return {
    localX: tile.x - chunkX * 10,
    localY: tile.y - chunkY * 10,
  };
}