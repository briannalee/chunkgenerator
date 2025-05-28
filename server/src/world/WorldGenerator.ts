import { NoiseGenerator } from './NoiseGenerator';
import { TerrainPoint, Biome, WaterType, VegetationType, SoilType, ColorIndex } from './TerrainTypes';

export class WorldGenerator {
  private noiseGen: NoiseGenerator;
  private seaLevel: number = 0.4; // Normalized height for sea level

  constructor(seed?: number) {
    this.noiseGen = new NoiseGenerator(seed);
  }

  generateChunk(chunkX: number, chunkY: number, chunkSize: number = 10): TerrainPoint[][] {
    const terrain: TerrainPoint[][] = [];

    for (let y = 0; y < chunkSize; y++) {
      terrain[y] = [];
      for (let x = 0; x < chunkSize; x++) {
        // Calculate world coordinates
        const worldX = chunkX * chunkSize + x;
        const worldY = chunkY * chunkSize + y;

        // Generate the terrain point
        terrain[y][x] = this.generateTerrainPoint(worldX, worldY);
      }
    }

    // Post-processing: rivers, erosion, etc.
    this.postProcessChunk(terrain, chunkSize);

    return terrain;
  }

  private generateTerrainPoint(x: number, y: number): TerrainPoint {
    // Generate base height using domain-warped noise
    const height = this.noiseGen.generateHeight(x, y);
    const normalizedHeight = (height + 1) * 0.5; // Convert from [-1,1] to [0,1]

    // Calculate steepness based on neighboring heights
    const h1 = this.noiseGen.generateHeight(x + 1, y);
    const h2 = this.noiseGen.generateHeight(x, y + 1);
    const steepness = Math.min(1, (Math.abs(height - h1) + Math.abs(height - h2)) * 5);

    // Determine if it's water
    const isWater = normalizedHeight < this.seaLevel;

    // Generate temperature (affected by height and latitude)
    const temperature = this.noiseGen.generateTemperature(x, y, normalizedHeight);

    // Generate precipitation (affected by temperature and terrain)
    const precipitation = this.noiseGen.generatePrecipitation(x, y, normalizedHeight, temperature);


    // Create the base terrain point
    const point: TerrainPoint = {
      x,
      y,
      h: height,
      nH: normalizedHeight,
      w: isWater,
      t: temperature,
      p: precipitation,
      stp: steepness,
      b: Biome.GRASSLAND, // Default, will be overridden
      c: ColorIndex.GRASSLAND, // Default color index, will be overridden
      _possibleBeach: false
    };

    // Determine biome and other properties based on the generated data
    this.assignTerrainProperties(point);

    return point;
  }

  private assignTerrainProperties(point: TerrainPoint): void {
    // Handle water tiles
    if (point.w) {
      if (point.nH < this.seaLevel - 0.15) {
        point.b = Biome.OCEAN_DEEP;
        point.c = ColorIndex.OCEAN_DEEP;
      } else {
        point.b = Biome.OCEAN_SHALLOW;
        point.c = ColorIndex.OCEAN_SHALLOW;
      }
      point.wT = WaterType.OCEAN;
      return;
    }

    // Handle land tiles

    // Determine if it's a cliff
    point.iC = point.stp > 0.7 && point.nH > this.seaLevel;
    const isPotentialBeach = point.nH < this.seaLevel + 0.05; // Slightly more generous elevation range

    if (isPotentialBeach) {
      // We'll check neighbors during post-processing to confirm beach status
      point._possibleBeach = true;
    }

    // Handle cliffs
    if (point.iC) {
      point.b = Biome.CLIFF;
      point.c = ColorIndex.CLIFF;
      point.sT = SoilType.ROCK;
      point.v = 0.1;
      point.vT = VegetationType.SHRUB;
      return;
    }

    // Handle mountains
    if (point.nH > 0.75) {
      if (point.t < 0.2) {
        point.b = Biome.MOUNTAIN_SNOW;
        point.c = ColorIndex.MOUNTAIN_SNOW;
        point.sT = SoilType.SNOW;
        point.v = 0;
        point.vT = VegetationType.NONE; // No vegetation in snow

      } else {
        point.b = Biome.MOUNTAIN;
        point.c = ColorIndex.MOUNTAIN;
        point.sT = SoilType.ROCK;
        point.v = 0.2;
        point.vT = VegetationType.SHRUB;
      }
      return;
    }

    // Handle other biomes based on temperature and precipitation

    // Desert (hot and dry)
    if (point.t > 0.7 && point.p < 0.3) {
      point.b = Biome.DESERT;
      point.c = ColorIndex.DESERT;
      point.sT = SoilType.SAND;
      point.v = 0.1;
      point.vT = VegetationType.CACTUS;
      return;
    }

    // Tundra (cold and moderate precipitation)
    if (point.t < 0.3) {
      if (point.t < 0.15) {
        point.b = Biome.SNOW;
        point.c = ColorIndex.SNOW;
        point.sT = SoilType.SNOW;
        point.v = 0;
        point.vT = VegetationType.NONE; // No vegetation in snow
      } else {
        point.b = Biome.TUNDRA;
        point.c = ColorIndex.TUNDRA;
        point.sT = SoilType.DIRT;
        point.v = 0.3;
        point.vT = VegetationType.TUNDRA_VEGETATION;
      }
      return;
    }

    // Savanna (warm and moderate precipitation)
    if (point.t > 0.6 && point.p >= 0.3 && point.p < 0.5) {
      point.b = Biome.SAVANNA;
      point.c = ColorIndex.SAVANNA;
      point.sT = SoilType.DIRT;
      point.v = 0.4;
      point.vT = VegetationType.GRASS;
      return;
    }

    // Jungle (hot and wet)
    if (point.t > 0.7 && point.p > 0.6) {
      point.b = Biome.JUNGLE;
      point.c = ColorIndex.JUNGLE;
      point.sT = SoilType.CLAY;
      point.v = 0.9;
      point.vT = VegetationType.TROPICAL;
      return;
    }

    // Forest variations
    if (point.p > 0.5) {
      if (point.p > 0.7) {
        point.b = Biome.DENSE_FOREST;
        point.c = ColorIndex.DENSE_FOREST;
        point.v = 0.8;
      } else {
        point.b = Biome.FOREST;
        point.c = ColorIndex.FOREST;
        point.v = 0.6;
      }

      // Determine forest type based on temperature
      if (point.t < 0.4) {
        point.vT = VegetationType.CONIFEROUS;
      } else {
        point.vT = VegetationType.DECIDUOUS;
      }

      point.sT = SoilType.DIRT;
      return;
    }

    // Grassland (default)
    point.b = Biome.GRASSLAND;
    point.c = ColorIndex.GRASSLAND;
    point.sT = SoilType.DIRT;
    point.v = 0.5;
    point.vT = VegetationType.GRASS;
  }

  private postProcessChunk(terrain: TerrainPoint[][], chunkSize: number): void {
    // First pass: Identify true beaches (potential beaches adjacent to ocean)
    for (let y = 0; y < chunkSize; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const point = terrain[y][x];

        if (point._possibleBeach) {
          // Check 4-directional neighbors for ocean water
          let isRealBeach = false;

          // Check neighbors (up, down, left, right)
          const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
          for (const [dx, dy] of directions) {
            const nx = x + dx;
            const ny = y + dy;

            if (nx >= 0 && nx < chunkSize && ny >= 0 && ny < chunkSize) {
              const neighbor = terrain[ny][nx];
              if (neighbor.w && neighbor.wT === WaterType.OCEAN) {
                isRealBeach = true;
                break;
              }
            }
          }

          if (isRealBeach) {
            point.b = Biome.BEACH;
            point.c = ColorIndex.BEACH;
            point.sT = SoilType.SAND;
            point.v = 0.1;
            point.vT = VegetationType.GRASS;
          }
          delete point._possibleBeach;
        }
      }
    }


    // Simple river generation (very basic)
    const shouldHaveRiver = Math.random() < 0.3; // 30% chance for a chunk to have a river

    if (shouldHaveRiver) {
      // Oceans shouldn't have rivers
      const hasOcean = terrain.some(row => row.some(point => point.w && point.wT === WaterType.OCEAN));
      if (hasOcean) return; // Skip river generation if there's an ocean
      const riverStartX = Math.floor(Math.random() * chunkSize);
      let x = riverStartX;

      for (let y = 0; y < chunkSize; y++) {
        // Make a winding river
        x = Math.max(0, Math.min(chunkSize - 1, x + Math.floor(Math.random() * 3) - 1));

        const point = terrain[y][x];
        point.w = true;
        point.wT = WaterType.RIVER;
        point.b = Biome.RIVER;
        point.c = ColorIndex.RIVER;
        // Remove non-water properties
        delete point.sT;
        delete point.v;
        delete point.vT;

        // Riverbanks
        if (x > 0) {
          const leftBank = terrain[y][x - 1];
          if (!leftBank.w) {
            leftBank.sT = SoilType.DIRT;
            leftBank.v = 0.6;
            leftBank.vT = VegetationType.GRASS;
          }
        }

        if (x < chunkSize - 1) {
          const rightBank = terrain[y][x + 1];
          if (!rightBank.w) {
            rightBank.sT = SoilType.DIRT;
            rightBank.v = 0.6;
            rightBank.vT = VegetationType.GRASS;
          }
        }
      }
    }
  }
}