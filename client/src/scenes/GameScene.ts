import Phaser from "phaser";
import { CHUNK_SIZE, GameLogic, TILE_SIZE } from "../logic/GameLogic";
import { ChunkData } from "../types/types";


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
    const startX = chunkX * CHUNK_SIZE * TILE_SIZE;
    const startY = chunkY * CHUNK_SIZE * TILE_SIZE;

    let graphics = this.chunkGraphics.get(chunkKey);
    if (!graphics) {
      graphics = this.add.graphics();
      this.chunkGraphics.set(chunkKey, graphics);
    }

    tiles.forEach((tile) => {
      const tileWorldX = tile.x * TILE_SIZE;
      const tileWorldY = tile.y * TILE_SIZE;

      let color = this.gameLogic.getTileColor(tile);
      if (!tile.w && tile.stp > 0.5) {
        color = this.gameLogic.darkenColor(color, 0.2); // Steeper slopes
      }

      graphics.fillStyle(color, 1);
      graphics.fillRect(tileWorldX, tileWorldY, TILE_SIZE, TILE_SIZE);

      if (tile.iC) {
        graphics.lineStyle(1, 0x333333); // Cliff edges
        graphics.strokeRect(tileWorldX, tileWorldY, TILE_SIZE, TILE_SIZE);
      }
    });
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
