import Phaser from "phaser";
import { CHUNK_SIZE, GameLogic, TILE_SIZE } from "../logic/GameLogic";
import { Biome, ChunkData, Tile } from "../types/types";
import { ColorCalculations } from "@/logic/ColorCalculations";
import { TileVariation } from "@/logic/TileVariation";
import { TileBlending } from "@/logic/TileBlending";


const DEBUG_MODE = true;


export class GameScene extends Phaser.Scene {
  private gameLogic!: GameLogic;
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private players: Record<string, Phaser.GameObjects.Rectangle> = {};
  private renderedChunks: Set<string> = new Set();
  private chunkGraphics: Map<string, Phaser.GameObjects.Graphics> = new Map();
  private coordText!: Phaser.GameObjects.Text;

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

      this.coordText = this.add.text(10, 10, '', {
        font: '16px monospace',
        color: '#ffffff',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        padding: { x: 4, y: 2 }
      })
        .setScrollFactor(0) // keep it fixed on screen
        .setDepth(10);
    }
  }

  update(time: number, delta: number) {
    this.gameLogic.updateFrameTime(delta);

    const speed = 10;
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

    if (DEBUG_MODE) {
      this.coordText.setText(`X: ${Math.floor(this.player.x)}, Y: ${Math.floor(this.player.y)}`);
      const chunkX = Math.floor(this.player.x / (CHUNK_SIZE * TILE_SIZE));
      const chunkY = Math.floor(this.player.y / (CHUNK_SIZE * TILE_SIZE));
      this.coordText.setText(`X: ${Math.floor(this.player.x)}, Y: ${Math.floor(this.player.y)}, Chunk: (${chunkX}, ${chunkY})`);
    }
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
    const { x: chunkX, y: chunkY } = chunkData;
    const chunkKey = `${chunkX},${chunkY}`;

    // Get chunk with border tiles from neighbors
    const chunkWithBorders = this.gameLogic.getChunkWithBorders(chunkX, chunkY);
    if (!chunkWithBorders) return;

    let graphics = this.chunkGraphics.get(chunkKey);
    if (!graphics) {
      graphics = this.add.graphics();
      this.chunkGraphics.set(chunkKey, graphics);
    }

    // Clear previous rendering
    graphics.clear();

    // Create a tile lookup map for neighbor checking
    const tileMap = new Map<string, Tile>();
    chunkWithBorders.tiles.forEach(tile => {
      tileMap.set(`${tile.x},${tile.y}`, tile);
    });

    // Only render tiles that belong to this chunk (not border tiles from neighbors)
    const chunkTiles = chunkData.tiles;
    chunkTiles.forEach((tile) => {
      this.renderDetailedTile(graphics, tile, tileMap, chunkData);
    });
  }

  private renderDetailedTile(graphics: Phaser.GameObjects.Graphics, tile: Tile, tileMap: Map<string, Tile>, chunkData: ChunkData) {
    const tileWorldX = chunkData.x + tile.x * TILE_SIZE;
    const tileWorldY = chunkData.y + tile.y * TILE_SIZE;
    const color = ColorCalculations.getTileColor(tile);

    // Render base tile with smooth biome transitions
    this.renderTileWithTransitions(graphics, tile, tileMap, tileWorldX, tileWorldY, color);

    // Add visual variation within the tile
    TileVariation.addTileVariation(graphics, tile, tileWorldX, tileWorldY, color);

    // Add biome-specific details
    TileVariation.addBiomeDetails(graphics, tile, tileWorldX, tileWorldY);
  }

  private renderTileWithTransitions(graphics: Phaser.GameObjects.Graphics, tile: Tile, tileMap: Map<string, Tile>, x: number, y: number, baseColor: number) {
    const neighbors = this.getNeighbors(tile, tileMap);
    const hasTransitions = TileBlending.shouldBlendWithNeighbors(tile, neighbors);

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
        const blendColor = TileBlending.calculateBlendedColor(tile, neighbors, sx, sy, subTilesPerSide, baseColor);

        graphics.fillStyle(blendColor, 1);
        graphics.fillRect(subX, subY, subTileSize, subTileSize);
      }
    }
  }


  private getNeighbors(tile: Tile, tileMap: Map<string, Tile>): any {
    // Check all directions - the tileMap now includes border tiles from neighbors
    return {
      north: tileMap.get(`${tile.x},${tile.y - 1}`),
      south: tileMap.get(`${tile.x},${tile.y + 1}`),
      east: tileMap.get(`${tile.x + 1},${tile.y}`),
      west: tileMap.get(`${tile.x - 1},${tile.y}`),
      northeast: tileMap.get(`${tile.x + 1},${tile.y - 1}`),
      northwest: tileMap.get(`${tile.x - 1},${tile.y - 1}`),
      southeast: tileMap.get(`${tile.x + 1},${tile.y + 1}`),
      southwest: tileMap.get(`${tile.x - 1},${tile.y + 1}`)
    };
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