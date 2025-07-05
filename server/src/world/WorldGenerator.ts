import { BiomeResourceDensity, BiomeResourceSettings, BiomeResourceProbabilities, ResourceNode, ResourceType, ResourceHardnessRange, ResourceRespawnRange, ResourceAmountRange, ResourceAmountBiomeMultipliers } from 'shared/ResourceTypes';
import { PriorityQueue } from '../pathfinding/PriorityQueue';
import { NoiseGenerator } from './NoiseGenerator';
import { Biome, WaterType, VegetationType, SoilType, ColorIndex } from 'shared/TerrainTypes';
import { TerrainPoint } from 'shared/TileTypes';
import { Random } from '../utilities/Random';

export class WorldGenerator {
  private noiseGen: NoiseGenerator;
  private seaLevel: number = 0.4; // Normalized height for sea level

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
    const isWater = normalizedHeight < this.seaLevel;

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
      _possibleBeach: false
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

    // River generation
    this.generateRivers(terrain, chunkSize);
  }

  private generateRivers(terrain: TerrainPoint[][], chunkSize: number): void {
    const hasOcean = terrain.some(row => row.some(p => p.w && p.wT === WaterType.OCEAN));

    // Process incoming rivers first
    this.processIncomingRivers(terrain, chunkSize, hasOcean);

    // Find and process mountain sources
    this.processMountainSources(terrain, chunkSize, hasOcean);

    // Find and process lake sources
    this.processLakeSources(terrain, chunkSize, hasOcean);

  }

  private processIncomingRivers(terrain: TerrainPoint[][], chunkSize: number, hasOcean: boolean): void {
    const incomingRivers: { x: number, y: number }[] = [];

    // Check top edge (y = 0)
    for (let x = 0; x < chunkSize; x++) {
      if (terrain[0][x].w && terrain[0][x].wT === WaterType.RIVER) {
        incomingRivers.push({ x, y: 0 });
      }
    }

    // Check left edge (x = 0)
    for (let y = 0; y < chunkSize; y++) {
      if (terrain[y][0].w && terrain[y][0].wT === WaterType.RIVER) {
        incomingRivers.push({ x: 0, y });
      }
    }

    // Continue incoming rivers
    for (const river of incomingRivers) {
      this.generateRiverPathAStar(terrain, chunkSize, river.x, river.y, hasOcean);
    }
  }

  private processMountainSources(terrain: TerrainPoint[][], chunkSize: number, hasOcean: boolean): void {
    let mountainSourceFound = false;

    for (let y = 0; y < chunkSize && !mountainSourceFound; y++) {
      for (let x = 0; x < chunkSize && !mountainSourceFound; x++) {
        if (terrain[y][x].b === Biome.MOUNTAIN_SNOW) {
          // Find lowest adjacent non-mountain tile
          const startPoint = this.findRiverStartFromMountain(terrain, x, y, chunkSize);
          if (startPoint) {
            mountainSourceFound = true;
            this.generateRiverPathAStar(terrain, chunkSize, startPoint.x, startPoint.y, hasOcean);
          }
        }
      }
    }
  }

  private findRiverStartFromMountain(terrain: TerrainPoint[][], x: number, y: number, chunkSize: number): { x: number, y: number } | null {
    const directions = [
      [0, 1], [1, 0], [0, -1], [-1, 0],  // Cardinal directions
      [1, 1], [1, -1], [-1, 1], [-1, -1]  // Diagonal directions
    ];

    let bestStart: { x: number, y: number, height: number } | null = null;

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < chunkSize && ny >= 0 && ny < chunkSize) {
        const tile = terrain[ny][nx];
        if (tile.b !== Biome.MOUNTAIN_SNOW && !tile.w) {
          if (!bestStart || tile.nH < bestStart.height) {
            bestStart = { x: nx, y: ny, height: tile.nH };
          }
        }
      }
    }

    return bestStart;
  }
  private processLakeSources(terrain: TerrainPoint[][], chunkSize: number, hasOcean: boolean): void {
    const visited = new Set<string>();

    for (let y = 0; y < chunkSize; y++) {
      for (let x = 0; x < chunkSize; x++) {
        const key = `${x},${y}`;
        if (visited.has(key)) continue;

        const tile = terrain[y][x];
        if (tile.b === Biome.LAKE && (!tile.w || tile.wT !== WaterType.RIVER)) {
          // Find all connected lake tiles
          const lakeTiles = this.floodFillLake(terrain, x, y, chunkSize);

          // Mark all as visited
          lakeTiles.forEach(t => visited.add(`${t.x},${t.y}`));

          // Only process lakes above a certain size
          if (lakeTiles.length >= 3) {
            this.processLake(terrain, lakeTiles, chunkSize, hasOcean);
          }
        }
      }
    }
  }

  private floodFillLake(terrain: TerrainPoint[][], startX: number, startY: number, chunkSize: number): { x: number, y: number }[] {
    const tiles: { x: number, y: number }[] = [];
    const queue = [{ x: startX, y: startY }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const key = `${current.x},${current.y}`;

      if (visited.has(key)) continue;
      visited.add(key);

      const tile = terrain[current.y][current.x];
      if (tile.b === Biome.LAKE && (!tile.w || tile.wT !== WaterType.RIVER)) {
        tiles.push(current);

        // Check 4-directional neighbors
        const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        for (const [dx, dy] of directions) {
          const nx = current.x + dx;
          const ny = current.y + dy;

          if (nx >= 0 && nx < chunkSize && ny >= 0 && ny < chunkSize) {
            queue.push({ x: nx, y: ny });
          }
        }
      }
    }

    return tiles;
  }
  private processLake(terrain: TerrainPoint[][], lakeTiles: { x: number, y: number }[], chunkSize: number, hasOcean: boolean): void {
    // Find potential outlets (lake edge tiles adjacent to lower land)
    const outlets: { x: number, y: number, height: number }[] = [];

    for (const tile of lakeTiles) {

      const isEdge = this.isLakeEdgeTile(terrain, tile.x, tile.y, chunkSize);
      if (isEdge) {
        const lowestNeighbor = this.getLowestAdjacentLand(terrain, tile.x, tile.y, chunkSize);
        if (lowestNeighbor) {
          outlets.push({
            x: tile.x,
            y: tile.y,
            height: lowestNeighbor.height
          });
        }
      }
    }

    // Sort outlets by height (lowest first)
    outlets.sort((a, b) => a.height - b.height);

    // Process the best outlet (if any)
    if (outlets.length > 0) {
      const bestOutlet = outlets[0];
      const riverStart = this.getLowestAdjacentLand(terrain, bestOutlet.x, bestOutlet.y, chunkSize);

      if (riverStart) {
        // First convert the lake edge tile to river
        this.setAsRiver(terrain[bestOutlet.y][bestOutlet.x]);

        // Then generate river from the land tile
        const path = this.findDownhillPath(terrain, riverStart.x, riverStart.y, chunkSize);

        // Only create the river if it has a valid path
        if (path.length > 1) {
          this.createRiver(terrain, path);
        } else {
          // If no path found, revert the outlet
          this.setAsLake(terrain[bestOutlet.y][bestOutlet.x]);
        }
      }
    }
  }

  private findDownhillPath(terrain: TerrainPoint[][], startX: number, startY: number, chunkSize: number): { x: number, y: number }[] {
    const path: { x: number, y: number }[] = [];
    let currentX = startX;
    let currentY = startY;
    const visited = new Set<string>();

    while (true) {
      const key = `${currentX},${currentY}`;
      if (visited.has(key)) break;
      visited.add(key);

      path.push({ x: currentX, y: currentY });

      const currentTile = terrain[currentY][currentX];

      // Stop if we reach water (but not lake)
      if (currentTile.w && currentTile.wT !== WaterType.LAKE) {
        break;
      }

      // Find the lowest neighbor
      const lowest = this.getLowestAdjacent(terrain, currentX, currentY, chunkSize);

      // Stop if no lower neighbor or we're at the edge
      if (!lowest || lowest.height >= currentTile.nH) {
        break;
      }

      currentX = lowest.x;
      currentY = lowest.y;
    }


    return path;
  }

  private getLowestAdjacent(terrain: TerrainPoint[][], x: number, y: number, chunkSize: number): { x: number, y: number, height: number } | null {
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    let lowest: { x: number, y: number, height: number } | null = null;

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < chunkSize && ny >= 0 && ny < chunkSize) {
        const neighbor = terrain[ny][nx];
        const height = neighbor.nH;

        // Skip if it's higher than current
        if (height >= terrain[y][x].nH) continue;

        if (!lowest || height < lowest.height) {
          lowest = { x: nx, y: ny, height };
        }
      }
    }

    return lowest;
  }

  private getLowestAdjacentLand(terrain: TerrainPoint[][], x: number, y: number, chunkSize: number): { x: number, y: number, height: number } | null {
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let lowest: { x: number, y: number, height: number } | null = null;

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < chunkSize && ny >= 0 && ny < chunkSize) {
        const neighbor = terrain[ny][nx];

        // Skip water tiles (unless they're ocean)
        if (neighbor.w && neighbor.wT !== WaterType.OCEAN) continue;

        const height = neighbor.nH;
        if (!lowest || height < lowest.height) {
          lowest = { x: nx, y: ny, height };
        }
      }
    }

    return lowest;
  }


  private findLakeOutlet(terrain: TerrainPoint[][], lake: { tiles: { x: number, y: number }[] }, chunkSize: number): { x: number, y: number } | null {
    // First, find the lowest edge tile of the lake
    let lowestEdgeTile: { x: number, y: number, height: number } | null = null;

    for (const tile of lake.tiles) {
      // Check if this is an edge tile (has non-lake neighbor)
      const isEdge = this.isLakeEdgeTile(terrain, tile.x, tile.y, chunkSize);
      if (isEdge) {
        const height = terrain[tile.y][tile.x].nH;
        if (!lowestEdgeTile || height < lowestEdgeTile.height) {
          lowestEdgeTile = { x: tile.x, y: tile.y, height };
        }
      }
    }

    if (!lowestEdgeTile) return null;

    // Now find the lowest adjacent land tile to be the outlet
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let bestOutlet: { x: number, y: number, height: number } | null = null;

    for (const [dx, dy] of directions) {
      const nx = lowestEdgeTile.x + dx;
      const ny = lowestEdgeTile.y + dy;

      if (nx >= 0 && nx < chunkSize && ny >= 0 && ny < chunkSize) {
        const neighbor = terrain[ny][nx];
        if (!neighbor.w || neighbor.wT !== WaterType.LAKE) {
          if (!bestOutlet || neighbor.nH < bestOutlet.height) {
            bestOutlet = { x: nx, y: ny, height: neighbor.nH };
          }
        }
      }
    }

    return bestOutlet;
  }

  private isLakeEdgeTile(terrain: TerrainPoint[][], x: number, y: number, chunkSize: number): boolean {
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];

    for (const [dx, dy] of directions) {
      const nx = x + dx;
      const ny = y + dy;

      if (nx >= 0 && nx < chunkSize && ny >= 0 && ny < chunkSize) {
        const neighbor = terrain[ny][nx];
        if (!neighbor.w || neighbor.wT !== WaterType.LAKE) {
          return true;
        }
      }
    }

    return false;
  }
  private generateRiverPathAStar(terrain: TerrainPoint[][], chunkSize: number, startX: number, startY: number, hasOcean: boolean): void {
    const startTile = terrain[startY][startX];

    // Don't start in ocean or existing rivers
    if (startTile.w && (startTile.wT === WaterType.OCEAN || startTile.wT === WaterType.RIVER)) {
      return;
    }

    // First try normal path to ocean
    const normalPath = this.findPathToOcean(terrain, chunkSize, startX, startY, hasOcean);
    if (normalPath.length > 0) {
      this.createRiver(terrain, normalPath);
      return;
    }

    // If no path found, handle depression
    this.handleDepression(terrain, chunkSize, startX, startY, hasOcean);
  }

  private findPathToOcean(terrain: TerrainPoint[][], chunkSize: number, startX: number, startY: number, hasOcean: boolean): { x: number, y: number }[] {
    const openSet = new PriorityQueue<{ x: number, y: number, cost: number }>(
      (a, b) => a.cost < b.cost
    );
    const cameFrom = new Map<string, { x: number, y: number }>();
    const gScore = new Map<string, number>();
    const closedSet = new Set<string>();

    // Initialize
    const startKey = `${startX},${startY}`;
    gScore.set(startKey, 0);
    openSet.enqueue({
      x: startX,
      y: startY,
      cost: this.heuristic(startX, startY, terrain, chunkSize, hasOcean)
    });

    while (!openSet.isEmpty()) {
      const current = openSet.dequeue();
      const currentKey = `${current.x},${current.y}`;
      const currentTile = terrain[current.y][current.x];

      // Check if reached ocean
      if (currentTile.w && currentTile.wT === WaterType.OCEAN) {
        return this.reconstructPath(cameFrom, current);
      }

      closedSet.add(currentKey);

      for (const neighbor of this.getFlowNeighbors(current.x, current.y, chunkSize, terrain)) {
        const neighborKey = `${neighbor.x},${neighbor.y}`;
        const neighborTile = terrain[neighbor.y][neighbor.x];

        // Skip if already evaluated, is MOUNTAIN_SNOW, or existing water (except ocean and lakes)
        if (closedSet.has(neighborKey) ||
          neighborTile.b === Biome.MOUNTAIN_SNOW ||
          (neighborTile.w && neighborTile.wT !== WaterType.OCEAN && neighborTile.wT !== WaterType.LAKE)) {
          continue;
        }

        const moveCost = this.calculateMoveCost(
          current.x, current.y,
          neighbor.x, neighbor.y,
          terrain
        );

        const tentativeGScore = gScore.get(currentKey)! + moveCost;

        if (!gScore.has(neighborKey) || tentativeGScore < gScore.get(neighborKey)!) {
          cameFrom.set(neighborKey, current);
          gScore.set(neighborKey, tentativeGScore);

          if (!openSet.contains({ x: neighbor.x, y: neighbor.y }, (a, b) => a.x === b.x && a.y === b.y)) {
            openSet.enqueue({
              x: neighbor.x,
              y: neighbor.y,
              cost: tentativeGScore + this.heuristic(neighbor.x, neighbor.y, terrain, chunkSize, hasOcean)
            });
          }
        }
      }
    }

    return []; // No path found
  }

  private handleDepression(terrain: TerrainPoint[][], chunkSize: number, x: number, y: number, hasOcean: boolean): void {
    const visited = new Set<string>();
    const queue: { x: number, y: number }[] = [{ x, y }];
    const depressionTiles: { x: number, y: number }[] = [];
    let lowestOutlet: { x: number, y: number, height: number } | null = null;
    const startHeight = terrain[y][x].nH;

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentKey = `${current.x},${current.y}`;
      const currentTile = terrain[current.y][current.x];

      // Skip if already visited, is ocean, or is MOUNTAIN_SNOW
      if (visited.has(currentKey)) continue;
      if (currentTile.w && currentTile.wT === WaterType.OCEAN) continue;
      if (currentTile.b === Biome.MOUNTAIN_SNOW) continue;

      visited.add(currentKey);
      depressionTiles.push(current);

      // Check all neighbors
      for (const neighbor of this.getFlowNeighbors(current.x, current.y, chunkSize, terrain)) {
        const neighborKey = `${neighbor.x},${neighbor.y}`;
        const neighborTile = terrain[neighbor.y][neighbor.x];
        const neighborHeight = neighborTile.nH;

        // Skip MOUNTAIN_SNOW neighbors
        if (neighborTile.b === Biome.MOUNTAIN_SNOW) continue;

        if (!visited.has(neighborKey)) {
          if (neighborHeight < startHeight) {
            // Only consider non-lake tiles as potential outlets
            if (!neighborTile.w || neighborTile.wT === WaterType.OCEAN) {
              if (!lowestOutlet || neighborHeight < lowestOutlet.height) {
                lowestOutlet = {
                  x: neighbor.x,
                  y: neighbor.y,
                  height: neighborHeight
                };
              }
            }
          } else {
            queue.push(neighbor);
          }
        }
      }
    }

    // Only create lake if we have valid tiles
    if (depressionTiles.length > 0) {

      // Create lake in depression (but not at the outlet)
      for (const tile of depressionTiles) {
        // Don't convert the outlet to a lake - leave it as land so river can flow from it
        if (lowestOutlet && tile.x === lowestOutlet.x && tile.y === lowestOutlet.y) {
          continue;
        }
        this.setAsLake(terrain[tile.y][tile.x]);
      }

      // Continue river from outlet if found
      if (lowestOutlet) {
        // Create a river tile at the outlet first
        this.setAsRiver(terrain[lowestOutlet.y][lowestOutlet.x]);
        // Then continue the river from there
        this.generateRiverPathAStar(terrain, chunkSize, lowestOutlet.x, lowestOutlet.y, hasOcean);
      }
    }
  }
  private reconstructPath(cameFrom: Map<string, { x: number, y: number }>, end: { x: number, y: number }): { x: number, y: number }[] {
    const path: { x: number, y: number }[] = [];
    let current: { x: number, y: number } | undefined = end;

    while (current) {
      path.unshift(current);
      const currentKey = `${current.x},${current.y}`;
      current = cameFrom.get(currentKey);
    }

    return path;
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

  private getFlowNeighbors(x: number, y: number, chunkSize: number, terrain: TerrainPoint[][]): { x: number, y: number }[] {
    const directions = [
      [0, 1], [1, 0], [0, -1], [-1, 0],  // Cardinal directions
      [1, 1], [1, -1], [-1, 1], [-1, -1]  // Diagonal directions
    ];

    return directions
      .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
      .filter(pos =>
        pos.x >= 0 && pos.x < chunkSize &&
        pos.y >= 0 && pos.y < chunkSize
      )
      .sort((a, b) => terrain[a.y][a.x].nH - terrain[b.y][b.x].nH); // Prefer lower elevations
  }


  private calculateMoveCost(x1: number, y1: number, x2: number, y2: number, terrain: TerrainPoint[][]): number {
    // Base cost is elevation delta (river wants to flow downhill)
    const heightDiff = terrain[y2][x2].nH - terrain[y1][x1].nH;
    let cost = heightDiff > 0 ? heightDiff * 10 : Math.abs(heightDiff); // Penalize going uphill more

    // Add direction penalty
    const isDiagonal = x1 !== x2 && y1 !== y2;
    if (isDiagonal) {
      cost += 0.5; // Slight penalty for diagonal movement
    }

    return cost;
  }

  private createRiver(terrain: TerrainPoint[][], path: { x: number, y: number }[]): void {
    for (let i = 0; i < path.length; i++) {
      const point = path[i];
      const tile = terrain[point.y][point.x];

      // Don't convert oceans or MOUNTAIN_SNOW to rivers
      if ((tile.w && tile.wT === WaterType.OCEAN) || tile.b === Biome.MOUNTAIN_SNOW) continue;

      this.setAsRiver(tile);

      // Handle diagonal moves
      if (i > 0) {
        const prev = path[i - 1];
        if (prev.x !== point.x && prev.y !== point.y) {
          // Connect via the lower elevation cardinal direction
          const cardinalOptions = [
            { x: prev.x, y: point.y },
            { x: point.x, y: prev.y }
          ];

          let lowestTile = null;
          let lowestHeight = Infinity;

          for (const opt of cardinalOptions) {
            const t = terrain[opt.y][opt.x];
            if (!t.w && t.b !== Biome.MOUNTAIN_SNOW && t.nH < lowestHeight) {
              lowestHeight = t.nH;
              lowestTile = t;
            }
          }

          if (lowestTile) {
            this.setAsRiver(lowestTile);
          }
        }
      }
    }
  }

  private heuristic(x: number, y: number, terrain: TerrainPoint[][], chunkSize: number, hasOcean: boolean): number {
    // If ocean exists in this chunk, prioritize paths toward ocean
    if (hasOcean) {
      // Find nearest ocean tile (simplified - could be optimized)
      let minDistance = Infinity;
      for (let oy = 0; oy < chunkSize; oy++) {
        for (let ox = 0; ox < chunkSize; ox++) {
          if (terrain[oy][ox].w && terrain[oy][ox].wT === WaterType.OCEAN) {
            const dist = Math.abs(x - ox) + Math.abs(y - oy); // Manhattan distance
            if (dist < minDistance) minDistance = dist;
          }
        }
      }
      return minDistance;
    }

    // Otherwise, just use height as heuristic (lower is better)
    return terrain[y][x].nH;
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