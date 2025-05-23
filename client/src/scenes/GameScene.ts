import Phaser from 'phaser';
import { NetworkFactory } from '../network/NetworkFactory';
import { INetworkAdapter } from '../network/INetworkAdapter';

export const SERVER_URL = import.meta.env.SERVER || 'http://localhost';
export const TILE_SIZE = 8;
export const CHUNK_SIZE = 10;
export const CHUNK_BUFFER = 1;
const DEBUG_MODE = true;
const FRAME_HISTORY_SIZE = 300; 

export class GameScene extends Phaser.Scene {
  public network!: INetworkAdapter;
  public player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private loadedChunks: Set<string> = new Set();
  private pendingChunks: Set<string> = new Set();
  private tilesGroup!: Phaser.GameObjects.Group;
  private players: Record<string, Phaser.GameObjects.Rectangle> = {};
  private playerId!: string;
  private lastPlayerChunkX: number = 0;
  private lastPlayerChunkY: number = 0;

  // Performance stats - optimized
  private frameTimes: number[] = [];
  private frameTimeIndex: number = 0;
  private perfStats = {
    frameCount: 0,
    averageFrameTime: 0,
  }


  // Chunk loading optimization
  private chunkLoadCooldown: number = 0;
  private readonly CHUNK_LOAD_INTERVAL = 100; // ms between chunk loading batches
  private pendingChunkQueue: {x: number, y: number, distance: number}[] = [];

  private chunkTiles: Map<string, Phaser.GameObjects.Rectangle[]> = new Map()

  constructor() {
    super({ key: 'GameScene' });
    // Pre-allocate frame times array
    this.frameTimes = new Array(FRAME_HISTORY_SIZE).fill(0);
    this.frameTimeIndex = 0;
  }

  preload() {
    this.network = NetworkFactory.createAdapter();
    this.network.onMessage(this.handleNetworkMessage.bind(this));
    this.network.onDisconnect(this.handleDisconnect.bind(this));
  }

  create() {
    // Loading text
    const loadingText = this.add.text(0, 0, 'Connecting...', {
      fontSize: '24px',
      color: '#ffffff'
    })
      .setOrigin(0.5)
      .setDepth(20);

    // Create tiles group
    this.tilesGroup = this.add.group();

    // Create player 
    this.player = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0xff0000)
      .setDepth(10);

    this.cursors = this.input.keyboard!.createCursorKeys();

    // Set up camera
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setZoom(2);

    this.network.connect()
      .then(() => {
        loadingText.destroy();
      })
      .catch(error => {
        loadingText.setText('Connection failed');
        console.error(error);
      })
  }

  update(time: number, delta: number) {
     // Track frame timing
    this.frameTimes[this.frameTimeIndex] = delta;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % this.frameTimes.length;
    
    // Performance counter
    this.perfStats.frameCount++;

    const speed = 2;
    const prevX = this.player.x;
    const prevY = this.player.y;

    if (this.cursors.left.isDown) this.player.x -= speed;
    if (this.cursors.right.isDown) this.player.x += speed;
    if (this.cursors.up.isDown) this.player.y -= speed;
    if (this.cursors.down.isDown) this.player.y += speed;

    if (prevX !== this.player.x || prevY !== this.player.y) {
      this.sendPositionUpdate();
      this.updateVisibleChunks();
    }

    // Process chunk queue with cooldown
    this.processChunkQueue(time);
  }

  private sendPositionUpdate() {
    this.network.send({
      type: 'move',
      x: this.player.x,
      y: this.player.y
    });

    // Debug memory usage periodically if in DEBUG_MODE
    if (DEBUG_MODE && this.perfStats.frameCount % 60 === 0) {
      this.debugMemoryUsage();
    }
  }

  private handleNetworkMessage(data: unknown) {
    if (typeof data !== 'object' || data === null) return;

    const message = data as Record<string, any>;

    switch (message.type) {
      case 'connected':
        this.playerId = message.id;
        this.renderPlayers(message.players);
        this.updateVisibleChunks(true);
        break;

      case 'chunkData':
        this.handleChunkData(message.chunk, message.terrainTypes);
        break;

      case 'chunkDataCompressed':
        // Handle binary compressed data (if implemented)
        console.log(`Received compressed chunk data: ${message.size} bytes`);
        break;

      case 'playerUpdate':
        if (message.delta) {
          this.handleDeltaPlayerUpdate(message.players);
        } else {
          this.renderPlayers(message.players);
        }
        break;
    }
  }

  private handleChunkData(chunk: any, terrainTypes?: string[]) {
    const { x, y, tiles } = chunk;
    const chunkKey = `${x},${y}`;

    // Remove from pending first
    this.pendingChunks.delete(chunkKey);

    // Only render if not already loaded
    if (!this.loadedChunks.has(chunkKey)) {
      // Handle compressed tile format: [x, y, typeId, x, y, typeId, ...]
      let processedTiles;
      if (Array.isArray(tiles) && Array.isArray(tiles[0])) {
        // Compact format: [[x, y, typeId], [x, y, typeId], ...]
        processedTiles = tiles.map(([x, y, typeId]: number[]) => ({
          x,
          y,
          type: terrainTypes ? terrainTypes[typeId] : `type_${typeId}`
        }));
      } else if (Array.isArray(tiles) && typeof tiles[0] === 'number') {
        // Flat format: [x, y, typeId, x, y, typeId, ...]
        processedTiles = [];
        for (let i = 0; i < tiles.length; i += 3) {
          processedTiles.push({
            x: tiles[i],
            y: tiles[i + 1],
            type: terrainTypes ? terrainTypes[tiles[i + 2]] : `type_${tiles[i + 2]}`
          });
        }
      } else {
        // Standard format
        processedTiles = tiles;
      }

      this.renderChunk(x, y, processedTiles);
      this.loadedChunks.add(chunkKey);
    }
  }

  private handleDeltaPlayerUpdate(deltaPlayers: Record<string, { x: number; y: number } | null>) {
    Object.entries(deltaPlayers).forEach(([id, pos]) => {
      if (id === this.playerId) return; // Skip local player

      if (pos === null) {
        // Player removed
        if (this.players[id]) {
          this.players[id].destroy();
          delete this.players[id];
        }
      } else {
        // Player added or moved
        if (this.players[id]) {
          this.players[id].setPosition(pos.x, pos.y);
        } else {
          this.players[id] = this.add.rectangle(pos.x, pos.y, TILE_SIZE, TILE_SIZE, 0xff00ff)
            .setDepth(5);
        }
      }
    });
  }

  private renderChunk(chunkX: number, chunkY: number, tiles: any[]) {
    const chunkKey = `${chunkX},${chunkY}`;
    const chunkTileObjects: Phaser.GameObjects.Rectangle[] = [];

    const startX = chunkX * CHUNK_SIZE * TILE_SIZE;
    const startY = chunkY * CHUNK_SIZE * TILE_SIZE;

    tiles.forEach((tile: any) => {
      const tileWorldX = startX + tile.x * TILE_SIZE;
      const tileWorldY = startY + tile.y * TILE_SIZE;

      const color = this.getTileColor(tile.type);
      const rect = this.add.rectangle(tileWorldX, tileWorldY, TILE_SIZE, TILE_SIZE, color)
        .setOrigin(0)
        .setDepth(0)
        .setScrollFactor(1);

      chunkTileObjects.push(rect);
      this.tilesGroup.add(rect);
    });

    this.chunkTiles.set(chunkKey, chunkTileObjects);
  }

  private updateVisibleChunks(force = false) {
    const chunkSize = CHUNK_SIZE * TILE_SIZE;
    const currentChunkX = Math.floor(this.player.x / chunkSize);
    const currentChunkY = Math.floor(this.player.y / chunkSize);

    if (force || currentChunkX !== this.lastPlayerChunkX || currentChunkY !== this.lastPlayerChunkY) {
      this.lastPlayerChunkX = currentChunkX;
      this.lastPlayerChunkY = currentChunkY;

      this.queueVisibleChunks(currentChunkX, currentChunkY);
      this.unloadDistantChunks(currentChunkX, currentChunkY);
    }
  }

  private unloadDistantChunks(currentChunkX: number, currentChunkY: number) {
    const camera = this.cameras.main;
    const zoom = camera.zoom;
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    // Calculate visible area in world pixels
    const worldWidth = screenWidth / zoom;
    const worldHeight = screenHeight / zoom;

    // Calculate bounds with buffer
    const left = this.player.x - worldWidth * 0.75;
    const right = this.player.x + worldWidth * 0.75;
    const top = this.player.y - worldHeight * 0.75;
    const bottom = this.player.y + worldHeight * 0.75;

    // Convert to chunk coordinates
    const chunkSize = CHUNK_SIZE * TILE_SIZE;
    const leftChunk = Math.floor(left / chunkSize);
    const rightChunk = Math.floor(right / chunkSize);
    const topChunk = Math.floor(top / chunkSize);
    const bottomChunk = Math.floor(bottom / chunkSize);

    const keepLoaded = new Set<string>();
    for (let x = leftChunk; x <= rightChunk; x++) {
      for (let y = topChunk; y <= bottomChunk; y++) {
        keepLoaded.add(`${x},${y}`);
      }
    }

    // Unload chunks that are loaded but outside the keepLoaded area
    const loadedChunks = Array.from(this.loadedChunks);
    for (const chunkKey of loadedChunks) {
      if (!keepLoaded.has(chunkKey)) {
        this.unloadChunk(chunkKey);
      }
    }
  }

  private unloadChunk(chunkKey: string) {
    if (this.loadedChunks.has(chunkKey)) {
      const [chunkX, chunkY] = chunkKey.split(',').map(Number);
      this.clearChunkTiles(chunkX, chunkY);
      this.loadedChunks.delete(chunkKey);
    }
    this.pendingChunks.delete(chunkKey);
  }

  private clearChunkTiles(chunkX: number, chunkY: number) {
    const chunkKey = `${chunkX},${chunkY}`;

    if (this.chunkTiles.has(chunkKey)) {
      const tiles = this.chunkTiles.get(chunkKey)!;

      // Destroy all tiles in this chunk
      tiles.forEach(tile => {
        this.tilesGroup.remove(tile, true);
        tile.destroy();
      });

      this.chunkTiles.delete(chunkKey);
    }
  }

  /**
   * Queues chunks for loading instead of loading them immediately.
   * This prevents frame spikes from too many network requests at once.
   */
  private queueVisibleChunks(centerX: number, centerY: number) {
    const camera = this.cameras.main;
    const zoom = camera.zoom;
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;
    const worldWidth = screenWidth / zoom;
    const worldHeight = screenHeight / zoom;

    // Calculate bounds with buffer (1.5x visible area)
    const left = this.player.x - worldWidth * 0.75;
    const right = this.player.x + worldWidth * 0.75;
    const top = this.player.y - worldHeight * 0.75;
    const bottom = this.player.y + worldHeight * 0.75;

    // Convert to chunk coordinates
    const chunkSize = CHUNK_SIZE * TILE_SIZE;
    const leftChunk = Math.floor(left / chunkSize);
    const rightChunk = Math.floor(right / chunkSize);
    const topChunk = Math.floor(top / chunkSize);
    const bottomChunk = Math.floor(bottom / chunkSize);

    // Clear existing queue and rebuild
    this.pendingChunkQueue.length = 0;

    // First pass: Identify all chunks that need loading
    for (let x = leftChunk; x <= rightChunk; x++) {
        for (let y = topChunk; y <= bottomChunk; y++) {
            const chunkKey = `${x},${y}`;
            
            if (this.loadedChunks.has(chunkKey)) continue;
            if (this.pendingChunks.has(chunkKey)) continue;

            // Use squared distance to avoid expensive sqrt
            const dx = centerX - x;
            const dy = centerY - y;
            const distanceSquared = dx * dx + dy * dy;
            
            this.pendingChunkQueue.push({
                x,
                y,
                distance: distanceSquared
            });
        }
    }

    // Sort by distance (closest first) - using squared distance
    this.pendingChunkQueue.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Processes the chunk queue with rate limiting to prevent frame spikes.
   */
  private processChunkQueue(currentTime: number) {
    if (this.pendingChunkQueue.length === 0) return;
    if (currentTime < this.chunkLoadCooldown) return;

    // Load chunks in smaller batches to maintain smooth framerate
    const MAX_CHUNKS_PER_BATCH = 2;
    let chunksLoadedThisBatch = 0;

    while (this.pendingChunkQueue.length > 0 && chunksLoadedThisBatch < MAX_CHUNKS_PER_BATCH) {
        const chunk = this.pendingChunkQueue.shift()!;
        const chunkKey = `${chunk.x},${chunk.y}`;
        
        // Double-check it's still needed (might have been loaded by server in the meantime)
        if (!this.loadedChunks.has(chunkKey) && !this.pendingChunks.has(chunkKey)) {
            this.pendingChunks.add(chunkKey);
            this.network.send({ type: 'requestChunk', x: chunk.x, y: chunk.y });
            chunksLoadedThisBatch++;
        }
    }

    // Set cooldown for next batch
    this.chunkLoadCooldown = currentTime + this.CHUNK_LOAD_INTERVAL;
  }

  /**
   * Logs memory usage statistics for debugging purposes.
   */
  public getMemoryStats() {
    return {
      loadedChunks: this.loadedChunks.size,
      pendingChunks: this.pendingChunks.size,
      queuedChunks: this.pendingChunkQueue.length,
      tiles: this.tilesGroup.getChildren().length,
      players: Object.keys(this.players).length
    };
  }

public getPerformanceStats() {
    // Calculate stats from the circular buffer
    let total = 0;
    let count = 0;
    let currentMax = 0;
    
    for (let i = 0; i < this.frameTimes.length; i++) {
        const ft = this.frameTimes[i];
        if (ft > 0) { // Only count initialized frames
            total += ft;
            count++;
            if (ft > currentMax) {
                currentMax = ft;
            }
        }
    }
    
    return {
        frameCount: this.perfStats.frameCount,
        averageFrameTime: count > 0 ? total / count : 0,
        maxFrameTime: currentMax,
        recentFrames: [...this.frameTimes] // Clone array
    };
}

  private debugMemoryUsage() {
    const stats = this.getMemoryStats();
    console.log(
      `Memory: ${stats.loadedChunks} chunks, ${stats.pendingChunks} pending, ` +
      `${stats.queuedChunks} queued, ${stats.tiles} tiles, ${stats.players} players`
    );
  }

  /**
   * Renders all players except the local player.
   * Updates positions or creates new rectangles for new players.
   * Removes players that are no longer present.
   */
  private renderPlayers(playersData: Record<string, { x: number; y: number }>) {
    // Remove players that are no longer present
    Object.keys(this.players).forEach(id => {
      if (!playersData[id] && id !== this.playerId) {
        this.players[id].destroy();
        delete this.players[id];
      }
    });

    // Update or create player rectangles for each player in the data
    Object.entries(playersData).forEach(([id, { x, y }]) => {
      if (id === this.playerId) return; // Skip local player

      if (this.players[id]) {
        this.players[id].setPosition(x, y);
      } else {
        this.players[id] = this.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, 0xff00ff)
          .setDepth(5);
      }
    });
  }

  /**
   * Handles disconnect event from the server.
   */
  private handleDisconnect() {
    console.warn('Disconnected from server');
  }

  /**
   * Returns a color for a given tile type.
   */
  private getTileColor(type: string): number {
    switch (type) {
      case "grass": return 0x00ff00;
      case "rock": return 0xaaaaaa;
      case "forest": return 0x006600;
      case "water": return 0x0000ff;
      case "desert": return 0xffcc00;
      default: return 0xffffff;
    }
  }
}

