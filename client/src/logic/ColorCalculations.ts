import { Biome, ColorMap, LandTile, Tile, VegetationType, WaterTile, WaterType } from "../types/types";

export class ColorCalculations {

  static getTileColor(tile: Tile): number {
    let baseColor = 0x000000;
    if (tile.w) {
      baseColor = this.getWaterColor(tile);
    } else {
      baseColor = this.getLandColor(tile);
    }

    // Apply steepness darkening
    let adjustedColor = baseColor;
    if (!tile.w && tile.stp > 0.5) {
      adjustedColor =
       this.darkenColor(baseColor, 0.2);
    }

    return adjustedColor;
  }

  static getWaterColor(tile: WaterTile): number {
    // Depth-based water coloring
    const depthFactor = 1 - tile.nH; // Deeper water is darker

    let baseColor = 0x0000FF;
    if (tile.wT === WaterType.OCEAN) {
      if (tile.b === Biome.OCEAN_SHALLOW) {
        baseColor = ColorMap[Biome.OCEAN_SHALLOW];
      }
      else if (tile.b === Biome.OCEAN_DEEP) { 
        baseColor = ColorMap[Biome.OCEAN_DEEP];
      }
    } else if (tile.wT === WaterType.RIVER) {
      if (tile.b === Biome.RIVER) {
        baseColor = ColorMap[Biome.RIVER];
      }
    } else if (tile.wT === WaterType.LAKE) {
      if (tile.b === Biome.LAKE) {
        baseColor = ColorMap[Biome.LAKE];
      }
    }
    return this.darkenColor(baseColor, depthFactor * 0.7);
  }

  static getLandColor(tile: LandTile): number {
    // Elevation-based tinting
    const elevationTint = this.getElevationTint(tile.nH);


    // Get base color for the tile's biome
    let color = ColorMap[tile.c] || 0x000000; // Default to black if unknown biome
    // Update dynamic colors for forests and mountains
    if (tile.b === Biome.FOREST || tile.b === Biome.DENSE_FOREST) {
      color = this.getForestColor(tile);
    } else if (tile.b === Biome.MOUNTAIN) {
      color = this.getMountainColor(tile);
    }

    // Mix with elevation tint
    return color;//this.mixColors(color, elevationTint, 0.7);
  }

  static getForestColor(tile: LandTile): number {
    // Vegetation density affects forest color
    const density = tile.v;
    const baseColors: Record<VegetationType, number> = {
      [VegetationType.GRASS]: 0x7CFC00,
      [VegetationType.SHRUB]: 0x6B8E23,
      [VegetationType.DECIDUOUS]: 0x228B22,
      [VegetationType.CONIFEROUS]: 0x2E8B57,
      [VegetationType.TROPICAL]: 0x006400,
      [VegetationType.CACTUS]: 0x8B4513,
      [VegetationType.TUNDRA_VEGETATION]: 0xD2B48C,
      [VegetationType.NONE]: 0
    };
    return this.darkenColor(baseColors[tile.vT], 1 - (density * 0.5));
  }

  static getMountainColor(tile: LandTile): number {
    // Rocky appearance with snow caps
    if (tile.t < 0) { // Below freezing
      return 0xFFFFFF; // Snow
    }
    return 0xA9A9A9; // Rock
  }

  // Color utility functions
  static darkenColor(color: number, factor: number): number {
    const r = Math.max(0, ((color >> 16) & 0xFF) * (1 - factor));
    const g = Math.max(0, ((color >> 8) & 0xFF) * (1 - factor));
    const b = Math.max(0, (color & 0xFF) * (1 - factor));
    return (r << 16) + (g << 8) + b;
  }

  static mixColors(color1: number, color2: number, ratio: number): number {
    const r1 = (color1 >> 16) & 0xFF;
    const g1 = (color1 >> 8) & 0xFF;
    const b1 = color1 & 0xFF;

    const r2 = (color2 >> 16) & 0xFF;
    const g2 = (color2 >> 8) & 0xFF;
    const b2 = color2 & 0xFF;

    const r = Math.round(r1 * ratio + r2 * (1 - ratio));
    const g = Math.round(g1 * ratio + g2 * (1 - ratio));
    const b = Math.round(b1 * ratio + b2 * (1 - ratio));

    return (r << 16) + (g << 8) + b;
  }

  static getElevationTint(elevation: number): number {
    // Higher elevations get more gray/rocky
    if (elevation > 0.8) return 0xAAAAAA;
    if (elevation > 0.6) return 0xCCCCCC;
    return 0xFFFFFF; // No tint
  }

  static lightenColor(color: number, factor: number): number {
    const r = Math.min(255, ((color >> 16) & 0xFF) + (255 - ((color >> 16) & 0xFF)) * factor);
    const g = Math.min(255, ((color >> 8) & 0xFF) + (255 - ((color >> 8) & 0xFF)) * factor);
    const b = Math.min(255, (color & 0xFF) + (255 - (color & 0xFF)) * factor);
    return (r << 16) + (g << 8) + b;
  }

}