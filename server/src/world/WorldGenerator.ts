import { BiomeResourceDensity, BiomeResourceSettings, BiomeResourceProbabilities, ResourceNode, ResourceType, ResourceHardnessRange, ResourceRespawnRange, ResourceAmountRange, ResourceAmountBiomeMultipliers } from 'shared/ResourceTypes';
import { PriorityQueue } from '../pathfinding/PriorityQueue';
import { NoiseGenerator } from './NoiseGenerator';
import { Biome, WaterType, VegetationType, SoilType, ColorIndex } from 'shared/TerrainTypes';
import { TerrainPoint } from 'shared/TileTypes';
import { Random } from '../utilities/Random';

export class WorldGenerator {
  private noiseGen: NoiseGenerator;
  private seaLevel: number = 0.3; // Normalized height for sea level
  private riverThreshold: number = 0.05;

  // Persistent caches that don't clear between chunks
  private heightCache: Map<string, number> = new Map();
  private temperatureCache: Map<string, number> = new Map();
  private precipitationCache: Map<string, number> = new Map();

  // Cache size limits to prevent memory bloat
  private readonly MAX_CACHE_SIZE = 10000;

  // World seed
  private seed: number;

  constructor(seed: number = 12345) {
    this.noiseGen = new NoiseGenerator(seed);
    this.seed = seed;
  }

  generateChunk(chunkX: number, chunkY: number, chunkSize: number = 10): TerrainPoint[][] {
    const terrain: TerrainPoint[][] = [];

    // Pre-generate all coordinates for batch processing
    const coordinates: Array<{ x: number, y: number, worldX: number, worldY: number }> = [];
    for (let y = 0; y < chunkSize; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const worldX = chunkX * chunkSize + x;
        const worldY = chunkY * chunkSize + y;
        coordinates.push({ x, y, worldX, worldY });
      }
    }

    // Batch generate heights with extended area for neighbor calculations
    this.batchGenerateHeights(coordinates, chunkSize);

    // Batch generate temperature and precipitation
    this.batchGenerateClimate(coordinates);

    // Generate terrain points using cached values
    for (let y = 0; y < chunkSize; y++) {
      terrain[y] = [];
      for (let x = 0; x < chunkSize; x++) {
        const worldX = chunkX * chunkSize + x;
        const worldY = chunkY * chunkSize + y;
        terrain[y][x] = this.generateTerrainPointFast(worldX, worldY);
      }
    }

    this.postProcessChunk(terrain, chunkSize);
    this.generateResources(terrain, chunkSize);

    this.manageCacheSize(); // Prevent memory bloat
    return terrain;
  }

  generateTerrainLine(
    fixedCoord: number,              // worldY for row, worldX for column
    startCoord: number,              // starting worldX for row, worldY for column
    chunkSize: number = 10,
    direction: 'row' | 'column' = 'row'
  ): TerrainPoint[] {
    const terrainLine: TerrainPoint[] = [];

    // Prepare coordinates
    const coordinates: Array<{ x: number, y: number, worldX: number, worldY: number }> = [];

    for (let i = 0; i < chunkSize; i++) {
      const worldX = direction === 'row' ? startCoord + i : fixedCoord;
      const worldY = direction === 'column' ? startCoord + i : fixedCoord;

      coordinates.push({ x: direction === 'row' ? i : 0, y: direction === 'column' ? i : 0, worldX, worldY });
    }

    // Batch generate height and climate data
    this.batchGenerateHeights(coordinates, chunkSize);
    this.batchGenerateClimate(coordinates);

    // Generate terrain points
    for (let i = 0; i < chunkSize; i++) {
      const worldX = direction === 'row' ? startCoord + i : fixedCoord;
      const worldY = direction === 'column' ? startCoord + i : fixedCoord;

      terrainLine[i] = this.generateTerrainPointFast(worldX, worldY);
    }

    // Wrap in 2D array to preserve post-process compatibility
    const terrainWrapped = direction === 'row'
      ? [terrainLine]                       // single row
      : terrainLine.map(pt => [pt]);       // single column as 2D

    // Skip post-processing for single lines TODO: consider if needed
    this.manageCacheSize();

    return terrainLine;
  }

  generateTerrainPoint(
    worldX: number,
    worldY: number
  ): TerrainPoint {
    // Prepare coordinate array with just one point
    const coordinates = [{ x: 0, y: 0, worldX, worldY }];

    // Generate height and climate data for the single point
    this.batchGenerateHeights(coordinates, 1);
    this.batchGenerateClimate(coordinates);

    // Generate and return the terrain point
    const terrainPoint = this.generateTerrainPointFast(worldX, worldY);

    this.manageCacheSize(); // Optional: manage cache if needed

    return terrainPoint;
  }

  private cacheHeight(x: number, y: number, height: number): void {
    this.heightCache.set(`${x},${y}`, height);
  }

  private getCachedHeight(x: number, y: number): number {
    const cached = this.heightCache.get(`${x},${y}`);
    if (cached === undefined) {
      // Fallback if not in cache (for edge cases)
      const height = this.noiseGen.generateHeight(x, y);
      this.cacheHeight(x, y, height);
      return height;
    }
    return cached;
  }

  private batchGenerateHeights(coordinates: Array<{ x: number, y: number, worldX: number, worldY: number }>, chunkSize: number): void {
    // Generate heights for chunk area plus neighbors for steepness calculation
    const extendedCoords = new Set<string>();

    // Add main coordinates and their neighbors
    for (const coord of coordinates) {
      extendedCoords.add(`${coord.worldX},${coord.worldY}`);
      extendedCoords.add(`${coord.worldX + 1},${coord.worldY}`);
      extendedCoords.add(`${coord.worldX},${coord.worldY + 1}`);
    }

    // Batch generate all heights
    for (const coordStr of extendedCoords) {
      const [x, y] = coordStr.split(',').map(Number);
      if (!this.heightCache.has(coordStr)) {
        const height = this.noiseGen.generateHeight(x, y);
        this.heightCache.set(coordStr, height);
      }
    }
  }

  private batchGenerateClimate(coordinates: Array<{ x: number, y: number, worldX: number, worldY: number }>): void {
    // Batch generate temperature and precipitation for all coordinates
    for (const coord of coordinates) {
      const key = `${coord.worldX},${coord.worldY}`;

      if (!this.temperatureCache.has(key)) {
        const height = this.heightCache.get(key)!;
        const normalizedHeight = (height + 1) * 0.5;
        const temperature = this.noiseGen.generateTemperature(coord.worldX, coord.worldY, normalizedHeight);
        this.temperatureCache.set(key, temperature);
      }

      if (!this.precipitationCache.has(key)) {
        const height = this.heightCache.get(key)!;
        const normalizedHeight = (height + 1) * 0.5;
        const temperature = this.temperatureCache.get(key)!;
        const precipitation = this.noiseGen.generatePrecipitation(coord.worldX, coord.worldY, normalizedHeight, temperature);
        this.precipitationCache.set(key, precipitation);
      }
    }
  }

  private generateTerrainPointFast(x: number, y: number): TerrainPoint {
    // Use cached values for faster generation
    const height = this.getCachedHeight(x, y);
    const h1 = this.getCachedHeight(x + 1, y);
    const h2 = this.heightCache.get(`${x},${y + 1}`)!;
    const temperature = this.temperatureCache.get(`${x},${y}`)!;
    const precipitation = this.precipitationCache.get(`${x},${y}`)!;

    const normalizedHeight = (height + 1) * 0.5;
    const steepness = Math.min(1, (Math.abs(height - h1) + Math.abs(height - h2)) * 5);
    let isWater = normalizedHeight < this.seaLevel;

    // Calculate base height (original height before any river carving)
    const baseHeight = this.noiseGen.fbm(
      x * 0.01,
      y * 0.01,
      4,  // octaves
      2.0, // lacunarity
      0.5  // persistence
    );

    // Get river value using base height
    const riverValue = this.noiseGen.generateRiverMap(x, y, baseHeight);
    if (riverValue >= this.riverThreshold) isWater = true;

    const point: TerrainPoint = {
      x,
      y,
      h: height,
      nH: normalizedHeight,
      w: isWater,
      t: temperature,
      p: precipitation,
      stp: steepness,
      b: Biome.GRASSLAND,
      c: ColorIndex.GRASSLAND,
      _possibleBeach: false,
      rV: riverValue
    };

    this.assignTerrainProperties(point);
    return point;
  }

  private manageCacheSize(): void {
    // Prevent memory bloat by clearing oldest entries when cache gets too large
    if (this.heightCache.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.heightCache.entries());
      const toDelete = entries.slice(0, Math.floor(this.MAX_CACHE_SIZE * 0.3));
      for (const [key] of toDelete) {
        this.heightCache.delete(key);
      }
    }

    if (this.temperatureCache.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.temperatureCache.entries());
      const toDelete = entries.slice(0, Math.floor(this.MAX_CACHE_SIZE * 0.3));
      for (const [key] of toDelete) {
        this.temperatureCache.delete(key);
      }
    }

    if (this.precipitationCache.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.precipitationCache.entries());
      const toDelete = entries.slice(0, Math.floor(this.MAX_CACHE_SIZE * 0.3));
      for (const [key] of toDelete) {
        this.precipitationCache.delete(key);
      }
    }
  }

  private assignTerrainProperties(point: TerrainPoint): void {
    if (point.wT === WaterType.LAKE) {
      point.b = Biome.LAKE;
      point.c = ColorIndex.LAKE;
      return;
    }
    // Handle water tiles
    if (point.w ) {
      // Use the river value to check if this water tile is a river
      if (point.rV && point.rV >= this.riverThreshold) {
        point.b = Biome.RIVER;
        point.w = true;
        point.c = ColorIndex.RIVER;
        point.wT = WaterType.RIVER;
      } else { // Otherwise, it's an ocean
        if (point.nH < this.seaLevel - 0.15) {
          point.b = Biome.OCEAN_DEEP;
          point.c = ColorIndex.OCEAN_DEEP;
        } else {
          point.b = Biome.OCEAN_SHALLOW;
          point.c = ColorIndex.OCEAN_SHALLOW;
        }
        point.wT = WaterType.OCEAN;
      }
      return;
    }

    // Handle land tiles

    // Determine if it's a cliff
    point.iC = point.stp > 0.7 && point.nH > this.seaLevel;
    const isPotentialBeach = point.nH < this.seaLevel + 0.05;

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
      if (point.t < 0.35) {
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
    if (point.t < 0.2) {
      if (point.t < 0.05) {
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
  }



  private setAsRiver(point: TerrainPoint): void {
    // Only convert non-ocean tiles
    if (point.w && point.wT === WaterType.OCEAN) return;

    point.w = true;
    point.wT = WaterType.RIVER;
    point.b = Biome.RIVER;
    point.c = ColorIndex.RIVER;
    // Remove non-water properties
    delete point.sT;
    delete point.v;
    delete point.vT;
  }

  private setAsLake(point: TerrainPoint): void {
    point.w = true;
    point.wT = WaterType.LAKE;
    point.b = Biome.LAKE;
    point.c = ColorIndex.LAKE;
    // Remove non-water properties
    delete point.sT;
    delete point.v;
    delete point.vT;
  }

  private generateResources(terrain: TerrainPoint[][], chunkSize: number): void {
    const chunkX = Math.floor(terrain[0][0].x / chunkSize);
    const chunkY = Math.floor(terrain[0][0].y / chunkSize);
    const rng = new Random(this.getChunkSeed(chunkX, chunkY));

    // Place guaranteed resources for forest/jungle/dense forest tiles and lakes/rivers first
    for (let y = 0; y < chunkSize; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const tile = terrain[y][x];

        if (tile.r) continue; // Skip if resource already assigned

        if (tile.b === Biome.LAKE || tile.b === Biome.RIVER) {
          this.assignResourceToTile(tile, ResourceType.Water, rng);
          continue; // Don't skip this tile just because of cliff/steepness
        }

        if (tile.iC || tile.stp > BiomeResourceSettings.STEEP_CUTOFF) continue; // Skip cliffs and steep tiles

        if (
          tile.b === Biome.FOREST ||
          tile.b === Biome.JUNGLE ||
          tile.b === Biome.DENSE_FOREST
        ) {
          const probabilities = BiomeResourceProbabilities[tile.b];
          if (!probabilities) throw new Error(`Missing guaranteed resource probabilities for biome: ${Biome[tile.b]}`);

          // Guaranteed wood, occasionally coal or iron
          let resourceType: ResourceType = ResourceType.Wood;
          const roll = rng.next();

          for (const [type, threshold] of probabilities) {
            if (roll < threshold) {
              resourceType = type;
              break;
            }
          }

          this.assignResourceToTile(tile, resourceType, rng);
        }
      }
    }

    // Now place random resources for other biomes using previous logic
    const resourceDensity = this.calculateResourceDensity(terrain, chunkSize);
    const resourceCount = Math.floor(rng.next() * BiomeResourceSettings.MAX_MULTIPLIER * resourceDensity) + BiomeResourceSettings.MIN;

    for (let i = 0; i < resourceCount; i++) {
      const position = this.findResourcePosition(terrain, chunkSize, rng);
      if (!position) continue;

      const { x, y } = position;
      const tile = terrain[y][x];
      if (tile.r) continue; // Skip if already has resource

      const resourceType = this.determineResourceType(tile, rng);
      if (!resourceType) continue;

      this.assignResourceToTile(tile, resourceType, rng);
    }
  }

  // Helper method to assign resource node to a tile
  private assignResourceToTile(tile: TerrainPoint, type: ResourceType, rng: Random): void {
    const resourceNode: ResourceNode = {
      type,
      amount: this.getResourceAmount(type, tile, rng),
      remaining: 0,
      hardness: this.getResourceHardness(type, tile, rng),
      x: tile.x,
      y: tile.y,
      respawnTime: this.getRespawnTime(type, rng),
    };
    resourceNode.remaining = resourceNode.amount;
    tile.r = resourceNode;
  }

  private getChunkSeed(chunkX: number, chunkY: number): number {
    // Create a deterministic seed for this chunk
    return this.seed + chunkX * 49632 + chunkY * 325176;
  }

  private calculateResourceDensity(terrain: TerrainPoint[][], chunkSize: number): number {
    let density = 0;
    let count = 0;

    for (let y = 0; y < chunkSize; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const tile = terrain[y][x];

        // Add density based on biome
        density += this.getBiomeResourceDensity(tile.b);
        count++;
      }
    }

    return count > 0 ? density / count : 0;
  }

  private getBiomeResourceDensity(biome: Biome): number {
    return BiomeResourceDensity[biome] ?? 0.5;
  }

  private findResourcePosition(terrain: TerrainPoint[][], chunkSize: number, rng: Random): { x: number, y: number } | null {
    const maxAttempts = 20;
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      const x = Math.floor(rng.next() * chunkSize);
      const y = Math.floor(rng.next() * chunkSize);
      const tile = terrain[y][x];

      if (tile.r || tile.iC || tile.stp > BiomeResourceSettings.STEEP_CUTOFF || tile.w) continue;

      return { x, y };
    }

    // Fallback linear scan
    for (let y = 0; y < chunkSize; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const tile = terrain[y][x];
        if (!tile.r && !tile.iC && tile.stp <= BiomeResourceSettings.STEEP_CUTOFF && !tile.w) {
          return { x, y };
        }
      }
    }
    return null;
  }

  private determineResourceType(tile: TerrainPoint, rng: Random): ResourceType | null {
    // Skip guaranteed biomes handled elsewhere
    if (
      tile.b === Biome.FOREST ||
      tile.b === Biome.JUNGLE ||
      tile.b === Biome.DENSE_FOREST ||
      tile.b === Biome.LAKE ||
      tile.b === Biome.RIVER
    ) {
      return null;
    }

    const probabilities = BiomeResourceProbabilities[tile.b];
    if (!probabilities) return null; // No mapping, no resource

    const rand = rng.next();

    for (const [resource, threshold] of probabilities) {
      if (rand < threshold) return resource;
    }

    return null; // Fallback, should never hit due to cumulative thresholds
  }

  private getResourceAmount(type: ResourceType, tile: TerrainPoint, rng: Random): number {
    const [min, max] = ResourceAmountRange[type];
    let amount = Math.floor(min + rng.next() * (max - min));

    const biomeMultipliers = ResourceAmountBiomeMultipliers[tile.b];
    const multiplier = biomeMultipliers?.[type] ?? 1;

    return Math.floor(amount * multiplier);
  }

  private getResourceHardness(type: ResourceType, tile: TerrainPoint, rng: Random): number {
    const [min, max] = ResourceHardnessRange[type];
    let hardness = min + rng.next() * (max - min);

    if (tile.stp > BiomeResourceSettings.STEEP_HARDNESS_CUTOFF) {
      hardness += BiomeResourceSettings.STEEP_HARDNESS_DIFFICULTY;
    }

    return Math.min(1, Math.max(0, hardness));
  }

  private getRespawnTime(type: ResourceType, rng: Random): number | undefined {
    const range = ResourceRespawnRange[type];
    if (!range) return undefined;

    const [min, max] = range;
    return min + Math.floor(rng.next() * (max - min));
  }
}