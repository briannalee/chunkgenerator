import Phaser from 'phaser';
import { NetworkFactory } from '../network/NetworkFactory';
import { INetworkAdapter } from '../network/INetworkAdapter';

export const SERVER_URL = import.meta.env.SERVER || 'http://localhost';
export const TILE_SIZE = 8;
export const CHUNK_SIZE = 10;
export const CHUNK_BUFFER = 1;
const DEBUG_MODE = false;

export class GameScene extends Phaser.Scene {
  private network!: INetworkAdapter;
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private loadedChunks: Set<string> = new Set();
  private pendingChunks: Set<string> = new Set();
  private tilesGroup!: Phaser.GameObjects.Group;
  private players: Record<string, Phaser.GameObjects.Rectangle> = {};
  private playerId!: string;
  private lastPlayerChunkX: number = 0;
  private lastPlayerChunkY: number = 0;


  private chunkTiles: Map<string, Phaser.GameObjects.Rectangle[]> = new Map()

  constructor() {
    super({ key: 'GameScene' });
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

  update() {
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
  }

  private sendPositionUpdate() {
    this.network.send({
      type: 'move',
      x: this.player.x,
      y: this.player.y
    });

    // Debug memory usage periodically if in DEBUG_MODE
    if (DEBUG_MODE) {
      if (this.time.now % 1000 < 50) {
        this.debugMemoryUsage();
      }
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
        this.handleChunkData(message.chunk);
        break;

      case 'playerUpdate':
        this.renderPlayers(message.players);
        break;
    }
  }

  private handleChunkData(chunk: any) {
    const { x, y, tiles } = chunk;
    const chunkKey = `${x},${y}`;

    // Remove from pending first
    this.pendingChunks.delete(chunkKey);

    // Only render if not already loaded
    if (!this.loadedChunks.has(chunkKey)) {
      this.renderChunk(x, y, tiles);
      this.loadedChunks.add(chunkKey);
    }
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

      this.requestVisibleChunks(currentChunkX, currentChunkY);
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
   * Requests all chunks that should be visible around the player.
   * Chunks are sorted by distance from the center so closer ones are loaded first.
   */
  private requestVisibleChunks(centerX: number, centerY: number) {
    const camera = this.cameras.main;
    const zoom = camera.zoom;

    // Calculate visible area in world pixels
    const screenWidth = this.scale.width;
    const screenHeight = this.scale.height;

    // Convert screen dimensions to world dimensions
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

    // Track chunks we're about to request in this frame
    const chunksBeingRequestedThisFrame = new Set<string>();

    // Loop through all chunk coordinates in the visible area
    for (let x = leftChunk; x <= rightChunk; x++) {
      for (let y = topChunk; y <= bottomChunk; y++) {
        const chunkKey = `${x},${y}`;

        // Skip if already loaded or pending from previous frames
        if (this.loadedChunks.has(chunkKey)) continue;
        if (this.pendingChunks.has(chunkKey)) continue;

        // Mark as being requested in this frame
        chunksBeingRequestedThisFrame.add(chunkKey);
      }
    }

    // Convert to array and sort by distance from center (player's chunk)
    const sortedChunks = Array.from(chunksBeingRequestedThisFrame).sort((a, b) => {
      const [ax, ay] = a.split(',').map(Number);
      const [bx, by] = b.split(',').map(Number);
      // Use chunk coordinates for distance calculation
      const distA = Phaser.Math.Distance.Between(centerX, centerY, ax, ay);
      const distB = Phaser.Math.Distance.Between(centerX, centerY, bx, by);
      return distA - distB;
    });

    // Request each chunk from the server, mark as pending
    for (const chunkKey of sortedChunks) {
      const [x, y] = chunkKey.split(',').map(Number);
      this.pendingChunks.add(chunkKey);
      this.network.send({ type: 'requestChunk', x, y });
    }
  }

  /**
   * Logs memory usage statistics for debugging purposes.
   */
  private debugMemoryUsage() {
    const loadedChunksCount = this.loadedChunks.size;
    const pendingChunksCount = this.pendingChunks.size;
    const tilesCount = this.tilesGroup.getChildren().length;
    const playersCount = Object.keys(this.players).length;

    console.log(`Memory: ${loadedChunksCount} chunks, ${pendingChunksCount} pending, ` +
      `${tilesCount} tiles, ${playersCount} players`);
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