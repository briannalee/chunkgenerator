import { describe, beforeAll, afterAll, it, expect } from "vitest";
import { INetworkAdapter } from "../src/network/INetworkAdapter";
import { NetworkFactory } from "../src/network/NetworkFactory";
import { WaterType, Biome, SoilType, LandTile, WaterTile, BaseTile, VegetationType, ColorIndex } from "../src/types/types";
import {TileNormalizer } from "../src/logic/NormalizeTiles";

// Main test suite for terrain quality
describe('Terrain Quality Tests', () => {
  let adapter: INetworkAdapter;
  let testChunks: any[] = [];
  let tileNormalizer: TileNormalizer;

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


  describe('Tile Normalization', () => {
    it('should correctly normalize land tiles from array format', () => {
      const arrayTile = [1, 2, 0.5, 0.6, 0, 0.3, 0.4, 0.2, Biome.FOREST, ColorIndex.FOREST, 0, WaterType.OCEAN, 0.7, VegetationType.DECIDUOUS, SoilType.CLAY];
      const normalized = tileNormalizer.NormalizeTile(arrayTile);

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
      const normalized = tileNormalizer.NormalizeTile(arrayTile);

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
        sT: SoilType.PEAT
      };
      const normalized = tileNormalizer.NormalizeTile(objectTile);
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
        wT: WaterType.RIVER
      };
      const normalized = tileNormalizer.NormalizeTile(objectTile);
      expect(normalized).toBe(objectTile);
    });

    it('should properly type cast enum values', () => {
      const arrayTile = [1, 2, 0.5, 0.6, 0, 0.3, 0.4, 0.2, 11 /* Biome.MOUNTAIN */, ColorIndex.MOUNTAIN, 1, 2 /* WaterType.RIVER */, 0.7, 1 /* VegetationType.GRASS */, 0 /* SoilType.SAND */];
      const normalized = tileNormalizer.NormalizeTile(arrayTile);

      // Verify enum values are properly cast
      expect(normalized.b).toBe(Biome.MOUNTAIN);
      if (!normalized.w) {
        expect(normalized.vT).toBe(VegetationType.GRASS);
        expect(normalized.sT).toBe(SoilType.SAND);
      }
    });
  });
});