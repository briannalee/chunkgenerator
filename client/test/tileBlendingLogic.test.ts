import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { TileBlending } from "../src/logic/TileBlending";
import { ColorCalculations } from "../src/logic/ColorCalculations";
import { INetworkAdapter } from "../src/network/INetworkAdapter";
import { NetworkFactory } from "../src/network/NetworkFactory";;
import { TileNormalizer } from "../src/logic/NormalizeTiles";
import { GameLogic } from "../src/logic/GameLogic";

describe("TileBlending", () => {

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
});