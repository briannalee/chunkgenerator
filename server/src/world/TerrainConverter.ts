import { TerrainPoint, Biome } from './TerrainTypes';

export interface SimpleTile {
  x: number;
  y: number;
  type: string;
}

export class TerrainConverter {
  // Convert our detailed terrain data to the simplified format expected by the client
  static convertToSimpleTiles(terrain: TerrainPoint[][]): SimpleTile[] {
    const tiles: SimpleTile[] = [];
    
    for (let y = 0; y < terrain.length; y++) {
      for (let x = 0; x < terrain[y].length; x++) {
        const point = terrain[y][x];
        tiles.push({
          x,
          y,
          type: this.terrainTypeToString(point)
        });
      }
    }
    
    return tiles;
  }
  
  private static terrainTypeToString(point: TerrainPoint): string {
    // Map our detailed terrain types to the simple types expected by the client
    switch (point.b) {
      case Biome.OCEAN_DEEP:
      case Biome.OCEAN_SHALLOW:
      case Biome.RIVER:
      case Biome.LAKE:
        return "water";
        
      case Biome.BEACH:
      case Biome.DESERT:
        return "desert";
        
      case Biome.GRASSLAND:
      case Biome.SAVANNA:
        return "grass";
        
      case Biome.FOREST:
      case Biome.DENSE_FOREST:
      case Biome.JUNGLE:
        return "forest";
        
      case Biome.MOUNTAIN:
      case Biome.MOUNTAIN_SNOW:
      case Biome.CLIFF:
        return "rock";
        
      default:
        return "grass"; // Default fallback
    }
  }
}