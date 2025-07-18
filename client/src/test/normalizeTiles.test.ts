import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { Biome, ColorIndex, SoilType, VegetationType, WaterType } from "shared/TerrainTypes";
// @ts-ignore
import { LandTile, WaterTile } from "shared/TileTypes";
import {TileNormalizer } from "../logic/NormalizeTiles";

// Main test suite for terrain quality
describe('Tile Normalization Tests', () => {
  let tileNormalizer: TileNormalizer;

  // Setup: connect to the network and load test chunks before running tests
  beforeAll(async () => {
    tileNormalizer = new TileNormalizer();
  }, 30000);

  describe('Tile Normalization', () => {
    it('should correctly normalize land tiles from array format', () => {
      const arrayTile = [1, 2, 0.5, 0.6, 0, 0.3, 0.4, 0.2, Biome.FOREST, ColorIndex.FOREST, 0, WaterType.OCEAN, 0.7, VegetationType.DECIDUOUS, SoilType.CLAY];
      const normalized = TileNormalizer.NormalizeTile(arrayTile);

      expect(normalized).toEqual({
        x: 1,
        y: 2,
        h: 0.5,
        nH: 0.6,
        w: false,
        t: 0.3,
        p: 0.4,
        stp: 0.2,
        b: Biome.FOREST,
        c: ColorIndex.FOREST,
        iC: false,
        v: 0.7,
        vT: VegetationType.DECIDUOUS,
        sT: SoilType.CLAY
      } as LandTile);
    });

    it('should correctly normalize water tiles from array format', () => {
      const arrayTile = [1, 2, 0.2, 0.3, 1, 0.4, 0.5, 0.1, Biome.OCEAN_DEEP, ColorIndex.OCEAN_DEEP, 0, WaterType.LAKE];
      const normalized = TileNormalizer.NormalizeTile(arrayTile);

      expect(normalized).toEqual({
        x: 1,
        y: 2,
        h: 0.2,
        nH: 0.3,
        w: true,
        t: 0.4,
        p: 0.5,
        stp: 0.1,
        b: Biome.OCEAN_DEEP,
        c: ColorIndex.OCEAN_DEEP,
        wT: WaterType.LAKE
      } as WaterTile);
    });

    it('should leave object-format land tiles unchanged', () => {
      const objectTile: LandTile = {
        x: 1,
        y: 2,
        h: 0.5,
        nH: 0.6,
        w: false,
        t: 0.3,
        p: 0.4,
        stp: 0.2,
        b: Biome.GRASSLAND,
        c: ColorIndex.GRASSLAND,
        iC: false,
        v: 0.7,
        vT: VegetationType.GRASS,
        sT: SoilType.PEAT,
      };
      const normalized = TileNormalizer.NormalizeTile(objectTile);
      expect(normalized).toBe(objectTile);
    });

    it('should leave object-format water tiles unchanged', () => {
      const objectTile: WaterTile = {
        x: 1,
        y: 2,
        h: 0.2,
        nH: 0.3,
        w: true,
        t: 0.4,
        p: 0.5,
        stp: 0.1,
        b: Biome.OCEAN_SHALLOW,
        c: ColorIndex.OCEAN_SHALLOW,
        wT: WaterType.RIVER,
      };
      const normalized = TileNormalizer.NormalizeTile(objectTile);
      expect(normalized).toBe(objectTile);
    });

    it('should properly type cast enum values', () => {
      const arrayTile = [1, 2, 0.5, 0.6, 0, 0.3, 0.4, 0.2, 11 /* Biome.MOUNTAIN */, ColorIndex.MOUNTAIN, 1, 2 /* WaterType.RIVER */, 0.7, 1 /* VegetationType.GRASS */, 0 /* SoilType.SAND */];
      const normalized = TileNormalizer.NormalizeTile(arrayTile);

      // Verify enum values are properly cast
      expect(normalized.b).toBe(Biome.MOUNTAIN);
      if (!normalized.w) {
        expect(normalized.vT).toBe(VegetationType.GRASS);
        expect(normalized.sT).toBe(SoilType.SAND);
      }
    });
  });
});