import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TileBlending } from "../logic/TileBlending";
import { ColorCalculations } from "../logic/ColorCalculations";
import { ColorIndex } from 'shared/TerrainTypes';
import { BaseTile, LandTile, Tile } from 'shared/TileTypes';

describe("TileBlending", () => {

  describe("shouldBlendWithNeighbors", () => {
    const baseTile = {
      x: 0, y: 0, h: 0, nH: 0, t: 0, p: 0, stp: 0, c: 0,
      b: 3, w: false,
      v: 0, vT: 0, sT: 0, iC: false, r: []
    } as LandTile;
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
    const baseTile = {
      x: 0, y: 0, h: 0, nH: 0, t: 0, p: 0, stp: 0, c: 0,
      b: 3, w: false,
      v: 0, vT: 0, sT: 0, iC: false
    } as LandTile;
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
      const baseTile = {
  x: 0, y: 0, h: 0, nH: 0, t: 0, p: 0, stp: 0, c: 0,
  b: 3, w: false,
  v: 0, vT: 0, sT: 0, iC: false
} as LandTile;
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

    it("should blend based on diagonal neighbors if biome differs - manual chunks", () => {
      // Define the center tile (e.g. bottom-right corner of a chunk)
      const tile: Tile = {
        x: 9,
        y: 9,
        h: 0.3,
        nH: 0.4,
        t: 0,
        p: 0.2,
        stp: 0.1,
        b: 1, // biome 1
        c: ColorIndex.GRASSLAND, // base color
        iC: false,
        w: false,
        v: 0,
        vT: 0,
        sT: 0,
      };

      // Define diagonal neighbors with different biomes
      const neighborMap = {
        north: null,
        south: null,
        east: null,
        west: null,
        // Diagonal neighbors
        northwest: {
          ...tile,
          x: 8,
          y: 8,
          b: 2, // different biome
          c: ColorIndex.BEACH,
        },
        northeast: {
          ...tile,
          x: 10,
          y: 8,
          b: 3,
          c: ColorIndex.FOREST
        },
        southwest: {
          ...tile,
          x: 8,
          y: 10,
          b: 4,
          c: ColorIndex.DESERT
        },
        southeast: {
          ...tile,
          x: 10,
          y: 10,
          b: 5,
          c: ColorIndex.JUNGLE
        },
      };

      const baseColor = tile.c;

      // Simulate corner blending with distance to edge
      const sx = 7; // near edge in sub-tile space
      const sy = 7;
      const subTilesPerSide = 8;

      const blendedColor = TileBlending.calculateBlendedColor(
        tile,
        neighborMap,
        sx,
        sy,
        subTilesPerSide,
        baseColor
      );

      // Must be different if diagonal blending is working
      expect(blendedColor).not.toBe(baseColor);
    });
  });
});