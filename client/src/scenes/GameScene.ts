import Phaser from "phaser";
import { GameLogic } from "../logic/GameLogic";
import { NetworkFactory } from "../network/NetworkFactory";
import { INetworkAdapter } from "../network/INetworkAdapter";

const CHUNK_SIZE = 10;
const TILE_SIZE = 8;
const CHUNK_BUFFER = 1;
const MAX_PENDING_REQUESTS = 4;
const DEBUG_MODE = false;
const FRAME_HISTORY_SIZE = 300;

export class GameScene extends Phaser.Scene {
  private gameLogic!: GameLogic;
  private networkAdapter!: INetworkAdapter;
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private tilesGroup!: Phaser.GameObjects.Group;
  private players: Record<string, Phaser.GameObjects.Rectangle> = {};
  private renderedChunks: Set<string> = new Set();

  constructor() {
    super({ key: "GameScene" });
  }

  preload() {
    this.networkAdapter = NetworkFactory.createAdapter();
    this.gameLogic = new GameLogic(this.networkAdapter, {
      CHUNK_SIZE,
      TILE_SIZE,
      CHUNK_BUFFER,
      MAX_PENDING_REQUESTS,
      FRAME_HISTORY_SIZE
    });
  }

  async create() {
    await this.networkAdapter.connect();
    
    this.player = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0xff0000).setDepth(1);
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.tilesGroup = this.add.group();
    
    // Update viewport when camera changes
    this.gameLogic.updateViewport(
      this.cameras.main.width,
      this.cameras.main.height,
      this.cameras.main.zoom
    );
    
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setZoom(2);
    
    // Listen for resize events to update viewport
    this.scale.on('resize', (gameSize: Phaser.Structs.Size) => {
      this.gameLogic.updateViewport(
        gameSize.width,
        gameSize.height,
        this.cameras.main.zoom
      );
    });
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
      
      if (this.gameLogic.shouldUpdateChunks()) {
        this.gameLogic.updateChunkTracking();
        this.updateVisibleChunks();
      }
      
      if (DEBUG_MODE) {
        this.debugMemoryUsage();
      }
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
      this.gameLogic.unloadDistantChunks();
      
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
        const tiles = this.gameLogic.chunks[chunkKey];
        if (tiles) {
          this.renderChunk(x, y, tiles);
          this.renderedChunks.add(chunkKey);
        }
      }
    }
  }

  private renderChunk(chunkX: number, chunkY: number, tiles: any[]) {
    const startX = chunkX * CHUNK_SIZE * TILE_SIZE;
    const startY = chunkY * CHUNK_SIZE * TILE_SIZE;
    const newTiles: Phaser.GameObjects.Rectangle[] = [];

    tiles.forEach((tile: any) => {
      const tileWorldX = startX + tile.x * TILE_SIZE;
      const tileWorldY = startY + tile.y * TILE_SIZE;
      const color = this.gameLogic.getTileColor(tile.type);
      const tileRect = this.add.rectangle(
        tileWorldX,
        tileWorldY,
        TILE_SIZE,
        TILE_SIZE,
        color
      ).setOrigin(0);
      newTiles.push(tileRect);
    });

    this.tilesGroup.addMultiple(newTiles);
  }

  private unloadRenderedChunk(chunkKey: string) {
    const [chunkX, chunkY] = chunkKey.split(',').map(Number);
    const startX = chunkX * CHUNK_SIZE * TILE_SIZE;
    const startY = chunkY * CHUNK_SIZE * TILE_SIZE;
    const endX = startX + CHUNK_SIZE * TILE_SIZE;
    const endY = startY + CHUNK_SIZE * TILE_SIZE;

    const tilesToRemove: Phaser.GameObjects.GameObject[] = [];
    this.tilesGroup.getChildren().forEach((tile: any) => {
      const tileX = tile.x;
      const tileY = tile.y;
      if (tileX >= startX && tileX < endX && tileY >= startY && tileY < endY) {
        tilesToRemove.push(tile);
      }
    });

    tilesToRemove.forEach(tile => tile.destroy());
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
      `${this.tilesGroup.getChildren().length} tiles, ${stats.players} players`
    );
  }
}