import Phaser from "phaser";
import { CHUNK_SIZE, GameLogic, TILE_SIZE } from "../logic/GameLogic";
import { Biome, ChunkData, Tile } from "../types/types";


const DEBUG_MODE = true;


export class GameScene extends Phaser.Scene {
  private gameLogic!: GameLogic;
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private players: Record<string, Phaser.GameObjects.Rectangle> = {};
  private renderedChunks: Set<string> = new Set();
  private chunkGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();

  constructor() {
    super({ key: "GameScene" });
  }

  async preload() {
    this.gameLogic = new GameLogic();
    // Wait for connection to establish
    try {
      console.log("Connecting...")
      await this.gameLogic.connect();
      console.log("Connected to server");
    } catch (err) {
      console.error("Connection failed:", err);
    }
  }


  async create() {
    this.player = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0xff0000).setDepth(1);
    this.cursors = this.input.keyboard!.createCursorKeys();

    // Set initial camera position and zoom
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setZoom(1);

    // Initial viewport update
    this.gameLogic.updateViewport(
      this.cameras.main.width,
      this.cameras.main.height,
      this.cameras.main.zoom
    );

    // Set initial player position in game logic
    this.gameLogic.updatePlayerPosition(this.player.x, this.player.y);

    // Trigger initial chunk loading
    this.gameLogic.updateChunkTracking();
    this.updateVisibleChunks();

    // Listen for resize events to update viewport
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.gameLogic.updateViewport(
        gameSize.width,
        gameSize.height,
        this.cameras.main.zoom
      );
      this.updateVisibleChunks();
    });

    if (DEBUG_MODE) {
      this.time.addEvent({
        delay: 2000,
        loop: true,
        callback: () => {
          this.debugMemoryUsage();
        }
      });
    }
  }

  update(time: number, delta: number) {
    this.gameLogic.updateFrameTime(delta);

    const speed = 2;
    const prevX = this.player.x;
    const prevY = this.player.y;

    if (this.cursors.left.isDown) this.player.x -= speed;
    if (this.cursors.right.isDown) this.player.x += speed;
    if (this.cursors.up.isDown) this.player.y -= speed;
    if (this.cursors.down.isDown) this.player.y += speed;

    if (prevX !== this.player.x || prevY !== this.player.y) {
      this.gameLogic.updatePlayerPosition(this.player.x, this.player.y);
    }

    // Always check for chunk updates when moving or periodically
    if (this.gameLogic.shouldUpdateChunks()) {
      this.gameLogic.updateChunkTracking();
      this.updateVisibleChunks();
    }

    // Check if camera zoom changed
    if (this.cameras.main.zoom !== this.gameLogic.viewport.zoom) {
      this.gameLogic.updateViewport(
        this.cameras.main.width,
        this.cameras.main.height,
        this.cameras.main.zoom
      );
      this.updateVisibleChunks();
    }

    // Continuously check for pending chunks to load
    this.gameLogic.checkPendingChunks();

    // Render any newly loaded chunks
    this.renderLoadedChunks();

    // Update player renderings
    this.renderPlayers();
  }

  private updateVisibleChunks() {
    const visibleChunks = this.gameLogic.getVisibleChunkKeys();

    // Check if visible chunks have changed
    const visibleChunksString = JSON.stringify(visibleChunks.sort());
    const lastVisibleChunksString = JSON.stringify(this.gameLogic.lastVisibleChunks.sort());

    if (visibleChunksString !== lastVisibleChunksString) {
      this.gameLogic.lastVisibleChunks = visibleChunks;
      this.gameLogic.checkPendingChunks();
      const chunksToUnload = this.gameLogic.unloadDistantChunks();
      this.gameLogic.removeChunks(chunksToUnload);

      // Clean up rendered chunks that were unloaded
      for (const chunkKey of this.renderedChunks) {
        if (!this.gameLogic.loadedChunks.has(chunkKey)) {
          this.unloadRenderedChunk(chunkKey);
        }
      }
    }
  }

  private renderLoadedChunks() {
    for (const chunkKey of this.gameLogic.loadedChunks) {
      if (!this.renderedChunks.has(chunkKey)) {
        const [x, y] = chunkKey.split(',').map(Number);
        const chunk = this.gameLogic.chunks[chunkKey];
        if (chunk) {
          this.renderChunk(chunk);
          this.renderedChunks.add(chunkKey);
        }
      }
    }
  }

  private renderChunk(chunkData: ChunkData) {
    const { x: chunkX, y: chunkY, tiles } = chunkData;
    const chunkKey = `${chunkX},${chunkY}`;

    let graphics = this.chunkGraphics.get(chunkKey);
    if (!graphics) {
      graphics = this.add.graphics();
      this.chunkGraphics.set(chunkKey, graphics);
    }

    // Create a tile lookup map for neighbor checking
    const tileMap = new Map<string, Tile>();
    tiles.forEach(tile => {
      tileMap.set(`${tile.x},${tile.y}`, tile);
    });

    tiles.forEach((tile) => {
      this.renderDetailedTile(graphics, tile, tileMap, chunkData);
    });
  }

  private renderDetailedTile(graphics: Phaser.GameObjects.Graphics, tile: Tile, tileMap: Map<string, Tile>, chunkData: ChunkData) {
    const tileWorldX = tile.x * TILE_SIZE;
    const tileWorldY = tile.y * TILE_SIZE;
    const baseColor = this.gameLogic.getTileColor(tile);

    // Apply steepness darkening
    let adjustedColor = baseColor;
    if (!tile.w && tile.stp > 0.5) {
      adjustedColor = this.gameLogic.darkenColor(baseColor, 0.2);
    }

    // Render base tile with smooth biome transitions
    this.renderTileWithTransitions(graphics, tile, tileMap, tileWorldX, tileWorldY, adjustedColor);

    // Add visual variation within the tile
    this.addTileVariation(graphics, tile, tileWorldX, tileWorldY, adjustedColor);

    // Add biome-specific details
    this.addBiomeDetails(graphics, tile, tileWorldX, tileWorldY);

    // Render cliff edges with hard borders
    if (!tile.w && (tile as any).iC) {
      graphics.lineStyle(2, 0x333333, 1);
      graphics.strokeRect(tileWorldX, tileWorldY, TILE_SIZE, TILE_SIZE);
    }
  }

  private renderTileWithTransitions(graphics: Phaser.GameObjects.Graphics, tile: Tile, tileMap: Map<string, Tile>, x: number, y: number, baseColor: number) {
    const neighbors = this.getNeighbors(tile, tileMap);
    const hasTransitions = this.shouldBlendWithNeighbors(tile, neighbors);

    if (!hasTransitions) {
      // Simple fill for tiles without transitions
      graphics.fillStyle(baseColor, 1);
      graphics.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      return;
    }

    // Render with smooth transitions
    const subTileSize = 8; // Divide each tile into 8x8 sub-tiles for smooth blending
    const subTilesPerSide = TILE_SIZE / subTileSize;

    for (let sy = 0; sy < subTilesPerSide; sy++) {
      for (let sx = 0; sx < subTilesPerSide; sx++) {
        const subX = x + sx * subTileSize;
        const subY = y + sy * subTileSize;

        // Calculate blend factor based on distance from edges
        const blendColor = this.calculateBlendedColor(tile, neighbors, sx, sy, subTilesPerSide, baseColor);

        graphics.fillStyle(blendColor, 1);
        graphics.fillRect(subX, subY, subTileSize, subTileSize);
      }
    }
  }

  private getNeighbors(tile: Tile, tileMap: Map<string, Tile>): any {
    // Check current chunk first
    let neighbors = {
      north: tileMap.get(`${tile.x},${tile.y - 1}`),
      south: tileMap.get(`${tile.x},${tile.y + 1}`),
      east: tileMap.get(`${tile.x + 1},${tile.y}`),
      west: tileMap.get(`${tile.x - 1},${tile.y}`),
      northeast: tileMap.get(`${tile.x + 1},${tile.y - 1}`),
      northwest: tileMap.get(`${tile.x - 1},${tile.y - 1}`),
      southeast: tileMap.get(`${tile.x + 1},${tile.y + 1}`),
      southwest: tileMap.get(`${tile.x - 1},${tile.y + 1}`)
    };

    // If any neighbor is missing, check adjacent chunks
    if (Object.values(neighbors).some(n => n === undefined)) {
      const chunkX = Math.floor(tile.x / CHUNK_SIZE);
      const chunkY = Math.floor(tile.y / CHUNK_SIZE);

      // Check if tile is on the edge of the chunk
      const tileInChunkX = tile.x % CHUNK_SIZE;
      const tileInChunkY = tile.y % CHUNK_SIZE;

      // Helper to get tile from adjacent chunk
      const getFromAdjacentChunk = (dx: number, dy: number, x: number, y: number): Tile | undefined => {
        const adjChunkKey = `${chunkX + dx},${chunkY + dy}`;
        const adjChunk = this.gameLogic.chunks[adjChunkKey];
        if (!adjChunk) return undefined;

        const adjTileMap = new Map<string, Tile>();
        adjChunk.tiles.forEach(t => adjTileMap.set(`${t.x},${t.y}`, t));
        return adjTileMap.get(`${x},${y}`);
      };

      // Check north neighbor in adjacent chunk
      if (tileInChunkY === 0 && !neighbors.north) {
        neighbors.north = getFromAdjacentChunk(0, -1, tile.x, tile.y - 1);
      }
      // Check south neighbor in adjacent chunk
      if (tileInChunkY === CHUNK_SIZE - 1 && !neighbors.south) {
        neighbors.south = getFromAdjacentChunk(0, 1, tile.x, tile.y + 1);
      }
      // Check west neighbor in adjacent chunk
      if (tileInChunkX === 0 && !neighbors.west) {
        neighbors.west = getFromAdjacentChunk(-1, 0, tile.x - 1, tile.y);
      }
      // Check east neighbor in adjacent chunk
      if (tileInChunkX === CHUNK_SIZE - 1 && !neighbors.east) {
        neighbors.east = getFromAdjacentChunk(1, 0, tile.x + 1, tile.y);
      }
      // Check diagonal neighbors if needed
      // (You can expand this for northeast, northwest, etc. if needed)
    }

    return neighbors;
  }

  private shouldBlendWithNeighbors(tile: Tile, neighbors: any): boolean {
    // Don't blend oceans and cliffs - keep hard borders
    if (tile.w || tile.iC) return false;

    // Check if any neighbor has a different biome that should blend
    const blendableBiomes = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17];

    if (!blendableBiomes.includes(tile.b)) return false;

    return Object.values(neighbors).some((neighbor: any) =>
      neighbor &&
      !neighbor.w &&
      !neighbor.iC &&
      neighbor.b !== tile.b &&
      blendableBiomes.includes(neighbor.b)
    );
  }

  private calculateBlendedColor(tile: Tile, neighbors: any, sx: number, sy: number, subTilesPerSide: number, baseColor: number): number {
    const edgeThreshold = 2; // How close to edge before blending starts
    const maxBlend = 0.4; // Maximum blend factor

    let blendFactor = 0;
    let neighborColor = baseColor;

    // Check distance from each edge and blend accordingly
    const distFromTop = sy;
    const distFromBottom = subTilesPerSide - 1 - sy;
    const distFromLeft = sx;
    const distFromRight = subTilesPerSide - 1 - sx;

    // North edge blending
    if (distFromTop < edgeThreshold && neighbors.north && this.canBlendBiomes(tile.b, neighbors.north.b)) {
      const factor = (edgeThreshold - distFromTop) / edgeThreshold * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = this.gameLogic.getTileColor(neighbors.north);
      }
    }

    // South edge blending
    if (distFromBottom < edgeThreshold && neighbors.south && this.canBlendBiomes(tile.b, neighbors.south.b)) {
      const factor = (edgeThreshold - distFromBottom) / edgeThreshold * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = this.gameLogic.getTileColor(neighbors.south);
      }
    }

    // East edge blending
    if (distFromRight < edgeThreshold && neighbors.east && this.canBlendBiomes(tile.b, neighbors.east.b)) {
      const factor = (edgeThreshold - distFromRight) / edgeThreshold * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = this.gameLogic.getTileColor(neighbors.east);
      }
    }

    // West edge blending
    if (distFromLeft < edgeThreshold && neighbors.west && this.canBlendBiomes(tile.b, neighbors.west.b)) {
      const factor = (edgeThreshold - distFromLeft) / edgeThreshold * maxBlend;
      if (factor > blendFactor) {
        blendFactor = factor;
        neighborColor = this.gameLogic.getTileColor(neighbors.west);
      }
    }

    // Return blended color
    if (blendFactor > 0) {
      return this.mixColors(baseColor, neighborColor, 1 - blendFactor);
    }

    return baseColor;
  }

  private canBlendBiomes(biome1: number, biome2: number): boolean {

    // Define which biomes can blend with each other
    const blendableGroups = [
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17],
    ];

    return blendableGroups.some(group =>
      group.includes(biome1) && group.includes(biome2)
    );
  }

  private addTileVariation(graphics: Phaser.GameObjects.Graphics, tile: Tile, x: number, y: number, baseColor: number) {
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
        this.gameLogic.darkenColor(baseColor, variation) :
        this.lightenColor(baseColor, variation);

      graphics.fillStyle(patchColor, 0.6); // Semi-transparent for blending
      graphics.fillRect(patchX, patchY, patchSize, patchSize);
    }
  }

  private addBiomeDetails(graphics: Phaser.GameObjects.Graphics, tile: Tile, x: number, y: number) {
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

  private addGrasslandDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
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

  private addForestDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
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

  private addDesertDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
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

  private addMountainDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
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

  private addSwampDetails(graphics: Phaser.GameObjects.Graphics, x: number, y: number, random: () => number, tile: any) {
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
  private seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  private lightenColor(color: number, factor: number): number {
    const r = Math.min(255, ((color >> 16) & 0xFF) + (255 - ((color >> 16) & 0xFF)) * factor);
    const g = Math.min(255, ((color >> 8) & 0xFF) + (255 - ((color >> 8) & 0xFF)) * factor);
    const b = Math.min(255, (color & 0xFF) + (255 - (color & 0xFF)) * factor);
    return (r << 16) + (g << 8) + b;
  }

  private mixColors(color1: number, color2: number, ratio: number): number {
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


  private unloadRenderedChunk(chunkKey: string) {
    const graphics = this.chunkGraphics.get(chunkKey);
    if (graphics) {
      graphics.destroy();
      this.chunkGraphics.delete(chunkKey);
    }
    this.renderedChunks.delete(chunkKey);
  }

  private renderPlayers() {
    // Remove players that no longer exist
    Object.keys(this.players).forEach((id) => {
      if (!this.gameLogic.players[id] && id !== this.gameLogic.playerId) {
        this.players[id].destroy();
        delete this.players[id];
      }
    });

    // Update or create other players
    Object.entries(this.gameLogic.players).forEach(([id, position]) => {
      if (this.players[id]) {
        this.players[id].setPosition(position.x, position.y);
      } else {
        this.players[id] = this.add.rectangle(
          position.x,
          position.y,
          TILE_SIZE,
          TILE_SIZE,
          0xff00ff
        ).setDepth(1);
      }
    });
  }

  private debugMemoryUsage() {
    const stats = this.gameLogic.getMemoryStats();
    console.log(
      `Memory: ${stats.loadedChunks} chunks, ${stats.pendingChunks} pending, ` +
      `${this.chunkGraphics.size} graphics, ${stats.players} players`
    );
  }
}
