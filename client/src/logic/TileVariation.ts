import { Tile } from "shared/TileTypes";
import { TILE_SIZE } from "./GameLogic";
import { ColorCalculations } from "./ColorCalculations";

export class TileVariation {
  static addTileVariation(graphics: Phaser.GameObjects.Graphics, tile: Tile, x: number, y: number, baseColor: number) {
    // Create deterministic random variations based on tile position
    const seed = tile.x * 1000 + tile.y;
    const random = this.seededRandom(seed);

    // Add color variation patches
    const numPatches = 3 + Math.floor(random() * 4); // 3-6 patches per tile

    for (let i = 0; i < numPatches; i++) {
      const patchSeed = seed + i * 100;
      const patchRandom = this.seededRandom(patchSeed);

      const patchSize = 8 + Math.floor(patchRandom() * 16); // 8-24 pixel patches
      const patchX = x + Math.floor(patchRandom() * (TILE_SIZE - patchSize));
      const patchY = y + Math.floor(patchRandom() * (TILE_SIZE - patchSize));

      // Vary the color slightly
      const variation = 0.1 + patchRandom() * 0.2; // 10-30% variation
      const darken = patchRandom() > 0.5;
      const patchColor = darken ?
        ColorCalculations.darkenColor(baseColor, variation) :
        ColorCalculations.lightenColor(baseColor, variation);

      graphics.fillStyle(patchColor, 0.6); // Semi-transparent for blending
      graphics.fillRect(patchX, patchY, patchSize, patchSize);
    }
  }

  static addBiomeDetails(graphics: Phaser.GameObjects.Graphics, tile: Tile, x: number, y: number) {
    const seed = tile.x * 1000 + tile.y;
    const random = this.seededRandom(seed + 500);

    if (tile.w) return; // Skip water tiles

    const landTile = tile as any; // Cast to access land-specific properties

    switch (tile.b) {
      case 3: // Grassland
        this.addGrasslandDetails(graphics, x, y, random, landTile);
        break;
      case 4:
      case 5: // Dense Forest
        this.addForestDetails(graphics, x, y, random, landTile);
        break;
      case 8: // Desert
        this.addDesertDetails(graphics, x, y, random, landTile);
        break;
      case 11: // Mountain
        this.addMountainDetails(graphics, x, y, random, landTile);
        break;
      case 16: // Swamp
        this.addSwampDetails(graphics, x, y, random, landTile);
        break;
    }
  }

  static addGrasslandDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
    // Add small grass patches and occasional flowers
    const numDetails = 2 + Math.floor(random() * 3);

    for (let i = 0; i < numDetails; i++) {
      const detailX = x + Math.floor(random() * (TILE_SIZE - 4));
      const detailY = y + Math.floor(random() * (TILE_SIZE - 4));

      if (random() > 0.7) {
        // Flower patch (bright color)
        graphics.fillStyle(0xFFFF00, 0.8); // Yellow flowers
        graphics.fillRect(detailX, detailY, 2, 2);
      } else {
        // Darker grass patch
        graphics.fillStyle(0x228B22, 0.6);
        graphics.fillRect(detailX, detailY, 3, 3);
      }
    }
  }

  static addForestDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
    // Add tree-like elements and undergrowth
    const density = tile.v || 0.5;
    const numTrees = Math.floor(density * 4) + 1;

    for (let i = 0; i < numTrees; i++) {
      const treeX = x + Math.floor(random() * (TILE_SIZE - 8));
      const treeY = y + Math.floor(random() * (TILE_SIZE - 8));

      // Tree trunk (brown)
      graphics.fillStyle(0x8B4513, 1);
      graphics.fillRect(treeX + 2, treeY + 4, 2, 4);

      // Tree canopy (darker green)
      graphics.fillStyle(0x006400, 0.8);
      graphics.fillRect(treeX, treeY, 6, 6);
    }
  }

  static addDesertDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
    // Add rocks and sand dunes
    const numRocks = 1 + Math.floor(random() * 3);

    for (let i = 0; i < numRocks; i++) {
      const rockX = x + Math.floor(random() * (TILE_SIZE - 6));
      const rockY = y + Math.floor(random() * (TILE_SIZE - 6));

      // Rock (gray-brown)
      graphics.fillStyle(0x8B7355, 0.9);
      graphics.fillRect(rockX, rockY, 4 + Math.floor(random() * 4), 3 + Math.floor(random() * 3));
    }

    // Occasional cactus
    if (random() > 0.8) {
      const cactusX = x + Math.floor(random() * (TILE_SIZE - 4));
      const cactusY = y + Math.floor(random() * (TILE_SIZE - 8));

      graphics.fillStyle(0x228B22, 1);
      graphics.fillRect(cactusX, cactusY, 2, 6);
    }
  }

  static addMountainDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
    // Add boulders and rocky outcrops
    const numBoulders = 2 + Math.floor(random() * 4);

    for (let i = 0; i < numBoulders; i++) {
      const boulderX = x + Math.floor(random() * (TILE_SIZE - 8));
      const boulderY = y + Math.floor(random() * (TILE_SIZE - 8));
      const size = 4 + Math.floor(random() * 6);

      // Boulder (dark gray)
      graphics.fillStyle(0x696969, 0.9);
      graphics.fillRect(boulderX, boulderY, size, size);
    }
  }

  static addSwampDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
    // Add water patches and dead vegetation
    const numDetails = 2 + Math.floor(random() * 3);

    for (let i = 0; i < numDetails; i++) {
      const detailX = x + Math.floor(random() * (TILE_SIZE - 6));
      const detailY = y + Math.floor(random() * (TILE_SIZE - 6));

      if (random() > 0.6) {
        // Water patch
        graphics.fillStyle(0x2F4F4F, 0.7);
        graphics.fillRect(detailX, detailY, 4, 4);
      } else {
        // Dead vegetation
        graphics.fillStyle(0x8B4513, 0.6);
        graphics.fillRect(detailX, detailY, 2, 3);
      }
    }
  }

  // Utility functions
  static seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }


}