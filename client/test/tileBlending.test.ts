import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TileBlending } from "../src/logic/TileBlending";
import { ColorCalculations } from "../src/logic/ColorCalculations";
import { INetworkAdapter } from "../src/network/INetworkAdapter";
import { NetworkFactory } from "../src/network/NetworkFactory";
import { WaterType, Biome, SoilType, LandTile, WaterTile, BaseTile, VegetationType, ColorIndex } from "../src/types/types";
import { TileNormalizer } from "../src/logic/NormalizeTiles";

describe("TileBlending", () => {

  let adapter: INetworkAdapter;
  let testChunks: any[] = [];
  let tileNormalizer: TileNormalizer;

  // Define hardcoded test chunk coordinates for coverage of various map areas
  let chunkCoordinates = [
    { x: 0, y: 0 },   // Origin
  ];

  /* Randomly generated chunk coordinates for additional coverage
  for (let i = 0; i < 5; i++) {
    chunkCoordinates.push({
      x: Math.floor(Math.random() * 5000) - 2500,
      y: Math.floor(Math.random() * 5000) - 2500
    });
  }*/

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
            data.chunk.tiles = tileNormalizer.NormalizeTiles(data.chunk.tiles);
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



  describe("shouldBlendWithNeighbors", () => {
    const baseTile = { b: 3, w: false, iC: false };
    it("returns false if tile biome is not blendable", () => {
      expect(TileBlending.shouldBlendWithNeighbors({ ...baseTile, b: 1 }, {})).toBe(false);
    });
    it("returns true if neighbor is blendable and different biome", () => {
      const neighbors = { north: { b: 4, w: false, iC: false } };
      expect(TileBlending.shouldBlendWithNeighbors(baseTile, neighbors)).toBe(true);
    });
    it("returns false if all neighbors are same biome", () => {
      const neighbors = { north: { b: 3, w: false, iC: false } };
      expect(TileBlending.shouldBlendWithNeighbors(baseTile, neighbors)).toBe(false);
    });
  });

  describe("calculateBlendedColor", () => {
    const baseTile = { b: 3, w: false, iC: false };
    const neighborTile = { b: 4, w: false, iC: false };
    const baseColor = 0x00ff00;
    const neighborColor = 0x0000ff;

    beforeAll(() => {
      vi.spyOn(ColorCalculations, "getTileColor").mockImplementation((tile) => {
        if (tile === neighborTile) return neighborColor;
        return baseColor;
      });
      vi.spyOn(ColorCalculations, "mixColors").mockImplementation((c1, c2, ratio) => {
        return ratio < 1 ? c2 : c1;
      });
    });

    afterAll(() => {
      vi.restoreAllMocks();
    });

    it("returns baseColor if not near edge", () => {
      const neighbors = {
        north: neighborTile,
        south: neighborTile,
        east: neighborTile,
        west: neighborTile
      };
      const color = TileBlending.calculateBlendedColor(baseTile, neighbors, 4, 4, 8, baseColor);
      expect(color).toBe(baseColor);
    });

    it("blends with north neighbor if near north edge", () => {
      const neighbors = { north: neighborTile };
      const color = TileBlending.calculateBlendedColor(baseTile, neighbors, 4, 0, 8, baseColor);
      expect(color).toBe(neighborColor);
    });

    it("blends with south neighbor if near south edge", () => {
      const neighbors = { south: neighborTile };
      const color = TileBlending.calculateBlendedColor(baseTile, neighbors, 4, 7, 8, baseColor);
      expect(color).toBe(neighborColor);
    });

    it("blends with east neighbor if near east edge", () => {
      const neighbors = { east: neighborTile };
      const color = TileBlending.calculateBlendedColor(baseTile, neighbors, 7, 4, 8, baseColor);
      expect(color).toBe(neighborColor);
    });

    it("blends with west neighbor if near west edge", () => {
      const neighbors = { west: neighborTile };
      const color = TileBlending.calculateBlendedColor(baseTile, neighbors, 0, 4, 8, baseColor);
      expect(color).toBe(neighborColor);
    });
  });

  describe("chunk border blending", () => {
    it("blends with neighbor chunk border tile", () => {
      const baseTile = { b: 3, w: false, iC: false };
      const neighborTile = { b: 4, w: false, iC: false };
      const baseColor = 0x00ff00;
      const neighborColor = 0x0000ff;

      vi.spyOn(ColorCalculations, "getTileColor").mockImplementation((tile) => {
        if (tile === neighborTile) return neighborColor;
        return baseColor;
      });

      vi.spyOn(ColorCalculations, "mixColors").mockImplementation((c1, c2, ratio) => {
        return ratio < 1 ? c2 : c1;
      });

      const neighbors = { east: neighborTile };
      const color = TileBlending.calculateBlendedColor(baseTile, neighbors, 7, 4, 8, baseColor);
      expect(color).toBe(neighborColor);

      vi.restoreAllMocks();
    });
  });

  describe("TileBlending with Real Data", () => {

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

          expect(shouldBlend).toBe(hasDifferentBiomeNeighbor);
        });
      });
    });

    it("should produce a blended color when on chunk edge with blendable neighbors", () => {
      testChunks.forEach((chunkData) => {
        const { tiles } = chunkData.chunk;
        tiles.forEach((tile: any) => {
          const neighbors = getAdjacentTiles(tile, tiles);
          const neighborMap = {
            north: neighbors.north,
            south: neighbors.south,
            east: neighbors.east,
            west: neighbors.west,
          };

          const sx = tile.x % 8;
          const sy = tile.y % 8;
          const baseColor = tile.c;
          const blendedColor = TileBlending.calculateBlendedColor(tile, neighborMap, sx, sy, 8, baseColor);

          const shouldBlend = TileBlending.shouldBlendWithNeighbors(tile, neighborMap);
          if (shouldBlend) {
            if (shouldBlend && blendedColor === baseColor) {
              const neighborSummary = Object.entries(neighborMap).reduce((acc, [dir, tile]) => {
                if (tile) {
                  acc[dir] = {
                    x: tile.x,
                    y: tile.y,
                    b: tile.b,
                    w: tile.w,
                    iC: tile.iC
                  };
                } else {
                  acc[dir] = null;
                }
                return acc;
              }, {} as Record<string, any>);

              console.warn(`Tile at (${tile.x}, ${tile.y}) failed to blend chunk edges. Me:`, JSON.stringify(tile), "Neighbors: ", JSON.stringify(neighborSummary, null, 2));
            }
            expect(blendedColor).not.toBe(baseColor);
          }
        });
      });
    });

    it("should blend intra-chunk tiles with different blendable neighbors", () => {
      testChunks.forEach((chunkData) => {
        const tiles = chunkData.chunk.tiles;
        const edgeThreshold = 2;
        const subTilesPerSide = 8;

        tiles.forEach((tile: any) => {

          const sx = tile.x % 8;
          const sy = tile.y % 8;
          if (sx === 0 || sx === 7 || sy === 0 || sy === 7) return; // skip edge

          const neighbors = getAdjacentTiles(tile, tiles);
          const neighborMap = {
            north: neighbors.north,
            south: neighbors.south,
            east: neighbors.east,
            west: neighbors.west,
          };
          const baseColor = tile.c;
          const shouldBlend = TileBlending.shouldBlendWithNeighbors(tile, neighborMap);
          const blendedColor = TileBlending.calculateBlendedColor(tile, neighborMap, sx, sy, 8, baseColor);
          const nearEdge =
            sx < edgeThreshold || sx >= subTilesPerSide - edgeThreshold ||
            sy < edgeThreshold || sy >= subTilesPerSide - edgeThreshold;

          if (shouldBlend && nearEdge) {
            if (blendedColor === baseColor) {
              // log debug info
              console.warn("Blending failed at edge tile", { tile, sx, sy, neighborMap });
            }
            expect(blendedColor).not.toBe(baseColor);
          }
        });
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