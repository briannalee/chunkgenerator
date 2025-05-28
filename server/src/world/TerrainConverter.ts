import { TerrainPoint, TerrainType } from './TerrainTypes';

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
      case TerrainType.OCEAN_DEEP:
      case TerrainType.OCEAN_SHALLOW:
      case TerrainType.RIVER:
      case TerrainType.LAKE:
        return "water";
        
      case TerrainType.BEACH:
      case TerrainType.DESERT:
        return "desert";
        
      case TerrainType.GRASSLAND:
      case TerrainType.SAVANNA:
        return "grass";
        
      case TerrainType.FOREST:
      case TerrainType.DENSE_FOREST:
      case TerrainType.JUNGLE:
        return "forest";
        
      case TerrainType.MOUNTAIN:
      case TerrainType.MOUNTAIN_SNOW:
      case TerrainType.CLIFF:
        return "rock";
        
      default:
        return "grass"; // Default fallback
    }
  }
}