import { Tile } from "shared/TileTypes";
import { ColorCalculations } from "./ColorCalculations";

export class TileBlending {
  static canBlendBiomes(biome1: number, biome2: number): boolean {

    // Define which biomes can blend with each other
    const blendableGroups = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
    ];

    return blendableGroups.some(group =>
      group.includes(biome1) && group.includes(biome2)
    );
  }

  static shouldBlendWithNeighbors(tile: Tile, neighbors: any): boolean {
    // Check if any neighbor has a different biome that should blend
    const blendableBiomes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

    if (!blendableBiomes.includes(tile.b)) return false;

    return Object.values(neighbors).some((neighbor: any) =>
      neighbor &&
      neighbor.b !== tile.b &&
      blendableBiomes.includes(neighbor.b)
    );
  }

  static calculateBlendedColor(tile: Tile, neighbors: any, sx: number, sy: number, subTilesPerSide: number, baseColor: number): number {
    const edgeThreshold = 3; // How close to edge before blending starts
    const maxBlend = 0.4; // Maximum blend factor

    let blendFactor = 0;
    let neighborColor = baseColor;

    // Check distance from each edge and blend accordingly
    const distFromTop = sy;
    const distFromBottom = subTilesPerSide - 1 - sy;
    const distFromLeft = sx;
    const distFromRight = subTilesPerSide - 1 - sx;

    // North edge blending
    if (distFromTop < edgeThreshold && neighbors.north && TileBlending.canBlendBiomes(tile.b, neighbors.north.b)) {
      const factor = (edgeThreshold - distFromTop) / edgeThreshold * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = ColorCalculations.getTileColor(neighbors.north);
      }
    }

    // South edge blending
    if (distFromBottom < edgeThreshold && neighbors.south && TileBlending.canBlendBiomes(tile.b, neighbors.south.b)) {
      const factor = (edgeThreshold - distFromBottom) / edgeThreshold * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = ColorCalculations.getTileColor(neighbors.south);
      }
    }

    // East edge blending
    if (distFromRight < edgeThreshold && neighbors.east && TileBlending.canBlendBiomes(tile.b, neighbors.east.b)) {
      const factor = (edgeThreshold - distFromRight) / edgeThreshold * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = ColorCalculations.getTileColor(neighbors.east);
      }
    }

    // West edge blending
    if (distFromLeft < edgeThreshold && neighbors.west && TileBlending.canBlendBiomes(tile.b, neighbors.west.b)) {
      const factor = (edgeThreshold - distFromLeft) / edgeThreshold * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = ColorCalculations.getTileColor(neighbors.west);
      }
    }

    // Northwest corner blending
    if (distFromTop < edgeThreshold && distFromLeft < edgeThreshold && neighbors.northwest && TileBlending.canBlendBiomes(tile.b, neighbors.northwest.b)) {
      const factor = Math.min((edgeThreshold - distFromTop) / edgeThreshold, (edgeThreshold - distFromLeft) / edgeThreshold) * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = ColorCalculations.getTileColor(neighbors.northwest);
      }
    }

    // Northeast
    if (distFromTop < edgeThreshold && distFromRight < edgeThreshold && neighbors.northeast && TileBlending.canBlendBiomes(tile.b, neighbors.northeast.b)) {
      const factor = Math.min((edgeThreshold - distFromTop) / edgeThreshold, (edgeThreshold - distFromRight) / edgeThreshold) * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = ColorCalculations.getTileColor(neighbors.northeast);
      }
    }

    // Southwest
    if (distFromBottom < edgeThreshold && distFromLeft < edgeThreshold && neighbors.southwest && TileBlending.canBlendBiomes(tile.b, neighbors.southwest.b)) {
      const factor = Math.min((edgeThreshold - distFromBottom) / edgeThreshold, (edgeThreshold - distFromLeft) / edgeThreshold) * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = ColorCalculations.getTileColor(neighbors.southwest);
      }
    }

    // Southeast
    if (distFromBottom < edgeThreshold && distFromRight < edgeThreshold && neighbors.southeast && TileBlending.canBlendBiomes(tile.b, neighbors.southeast.b)) {
      const factor = Math.min((edgeThreshold - distFromBottom) / edgeThreshold, (edgeThreshold - distFromRight) / edgeThreshold) * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = ColorCalculations.getTileColor(neighbors.southeast);
      }
    }

    // Return blended color
    if (blendFactor > 0) {
      return ColorCalculations.mixColors(baseColor, neighborColor, 1 - blendFactor);
    }

    return baseColor;
  }
}