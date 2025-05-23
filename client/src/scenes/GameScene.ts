import Phaser from "phaser";

const CHUNK_SIZE = 10; // Size of each chunk in tiles
const TILE_SIZE = 8; // Size of each tile in pixels
const SERVER_URL = import.meta.env.VITE_SERVER || '127.0.0.1';
const WS_PORT = import.meta.env.VITE_WS_PORT || '15432';
const WS_PROTOCOL = import.meta.env.VITE_WS_PROTOCOL || 'ws';
const CHUNK_BUFFER = 1; // Buffer of 1 chunk in each direction
const MAX_PENDING_REQUESTS = 4; // Limit concurrent chunk requests
const DEBUG_MODE = false; // Enable debug mode for memory usage
const FRAME_HISTORY_SIZE = 300; 

export class GameScene extends Phaser.Scene {
  socket!: WebSocket; // WebSocket connection
  player!: Phaser.GameObjects.Rectangle; // Player object
  cursors!: Phaser.Types.Input.Keyboard.CursorKeys; // Cursor keys
  camera!: Phaser.Cameras.Scene2D.Camera; // Main camera
  chunks: Record<string, any> = {}; // Store loaded chunks
  loadedChunks: Set<string> = new Set(); // Track loaded chunks
  pendingChunks: Set<string> = new Set(); // Track pending chunk requests
  tilesGroup!: Phaser.GameObjects.Group; // Group to contain the tiles
  players: Record<string, Phaser.GameObjects.Rectangle> = {}; // Store other players
  playerId!: string; // Store this client's player ID
  lastVisibleChunks: string[] = []; // Store last visible chunks for comparison
  chunkLoadTimer: number = 0; // Timer to check for new chunk loads
  lastPlayerChunkX: number = 0; // Last player chunk X coordinate
  lastPlayerChunkY: number = 0; // Last player chunk Y coordinate
  lastCameraZoom: number = 2; // Camera zoom, default to 1
  lastChunkCheck: number = 0; // Time tracker for throttling chunk checks

  // Performance stats
  private frameTimes: number[] = [];
  private frameTimeIndex: number = 0;
  private perfStats = {
    frameCount: 0,
    averageFrameTime: 0,
  }


  constructor() {
    super({ key: "GameScene" });    
    this.frameTimes = new Array(FRAME_HISTORY_SIZE).fill(0);
    this.frameTimeIndex = 0;
  }

  preload() {
    // WebSocket connection
    const SOCKET_URL = `${WS_PROTOCOL}://${SERVER_URL}:${WS_PORT}`;
    this.socket = new WebSocket(SOCKET_URL);

    // Handle incoming messages
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      // Handle chunk data
      if (message.type === "chunkData") {
        const { x, y, tiles } = message.chunk;
        const chunkKey = `${x},${y}`;
        this.chunks[chunkKey] = tiles;
        this.renderChunk(x, y, tiles);
        this.loadedChunks.add(chunkKey);
        this.pendingChunks.delete(chunkKey);

        // Immediately try to request more chunks if we received data
        this.checkPendingChunks();

        // Handle player connection
      } else if (message.type === "connected") {
        this.playerId = message.id; // Set this client's player ID
        this.renderPlayers(message.players); // Render initial player positions

        // Handle player update
      } else if (message.type === "playerUpdate") {
        this.renderPlayers(message.players); // Update player positions
      }
    };

    this.socket.onopen = () => {
      // Initial chunk loading when socket opens
      this.updateVisibleChunks();
    };
  }

  create() {
    // Create player
    this.player = this.add.rectangle(0, 0, TILE_SIZE, TILE_SIZE, 0xff0000);
    this.cursors = this.input.keyboard!.createCursorKeys();

    // Set player depth to be above the tiles
    this.player.setDepth(1);

    // Camera setup
    this.camera = this.cameras.main;
    this.camera.startFollow(this.player);
    this.camera.setZoom(2);

    // Group to hold tile objects
    this.tilesGroup = this.add.group();

    console.log("Zoom", this.camera.zoom);
    console.log("Camera", this.camera.width, this.camera.height);
  }

  update(time: number, delta: number) {
    // Track frame timing
    this.frameTimes[this.frameTimeIndex] = delta;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % this.frameTimes.length;
    
    // Performance counter
    this.perfStats.frameCount++;
    

    // Keep only the last 100 frames
    if (this.frameTimes.length > 1000) {
      this.frameTimes.shift();
    }

    const speed = 2;
    const prevX = this.player.x;
    const prevY = this.player.y;

    if (this.cursors.left.isDown) this.player.x -= speed;
    if (this.cursors.right.isDown) this.player.x += speed;
    if (this.cursors.up.isDown) this.player.y -= speed;
    if (this.cursors.down.isDown) this.player.y += speed;

    // Send position update if player moved 
    if (prevX !== this.player.x || prevY !== this.player.y) {
      this.socket.send(JSON.stringify({ type: "move", x: this.player.x, y: this.player.y }));

      // Check if player entered a new chunk
      const chunkSize = CHUNK_SIZE * TILE_SIZE;
      const currentChunkX = Math.floor(this.player.x / chunkSize);
      const currentChunkY = Math.floor(this.player.y / chunkSize);

      const now = Date.now();
      // Only check for visible chunks every 100ms at most
      const throttleTime = 100;

      if (
        currentChunkX !== this.lastPlayerChunkX ||
        currentChunkY !== this.lastPlayerChunkY ||
        (now - this.lastChunkCheck > throttleTime && this.pendingChunks.size === 0)
      ) {
        this.lastPlayerChunkX = currentChunkX;
        this.lastPlayerChunkY = currentChunkY;
        this.lastChunkCheck = now;
        this.updateVisibleChunks(); // Force update when changing chunks
      }
      if (DEBUG_MODE) {
        this.debugMemoryUsage(); // Log memory usage
      }
    }

    // Check if camera zoom changed (which would affect visible chunks)
    if (this.camera.zoom !== this.lastCameraZoom) {
      this.lastCameraZoom = this.camera.zoom;
      this.updateVisibleChunks();
    }
  }

  checkPendingChunks() {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    // Get the current list of chunks that need to be loaded
    const visibleChunks = this.getVisibleChunkKeys();

    // Filter to chunks that are visible but not loaded or pending
    const chunksToRequest = visibleChunks.filter(
      chunkKey => !this.loadedChunks.has(chunkKey) && !this.pendingChunks.has(chunkKey)
    );

    // If we have room for more pending requests, make them
    const availableSlots = MAX_PENDING_REQUESTS - this.pendingChunks.size;
    if (availableSlots > 0 && chunksToRequest.length > 0) {
      const chunksToLoad = chunksToRequest.slice(0, availableSlots);

      for (const chunkKey of chunksToLoad) {
        const [x, y] = chunkKey.split(',').map(Number);
        this.socket.send(JSON.stringify({ type: "requestChunk", x, y }));

        this.pendingChunks.add(chunkKey);
      }
    }
  }

  getVisibleChunkKeys() {
    const centerX = this.player.x;
    const centerY = this.player.y;

    // Calculate visible area around the player
    const halfWidth = (this.camera.width / this.camera.zoom) / 2;
    const halfHeight = (this.camera.height / this.camera.zoom) / 2;

    const cameraBounds = {
      left: centerX - halfWidth,
      right: centerX + halfWidth,
      top: centerY - halfHeight,
      bottom: centerY + halfHeight
    };

    // Convert camera bounds to chunk coordinates with buffer
    const chunkSize = CHUNK_SIZE * TILE_SIZE;

    const startChunkX = Math.floor(cameraBounds.left / chunkSize) - CHUNK_BUFFER;
    const endChunkX = Math.floor(cameraBounds.right / chunkSize) + CHUNK_BUFFER;
    const startChunkY = Math.floor(cameraBounds.top / chunkSize) - CHUNK_BUFFER;
    const endChunkY = Math.floor(cameraBounds.bottom / chunkSize) + CHUNK_BUFFER;

    // Generate list of visible chunks
    const visibleChunks: string[] = [];
    for (let x = startChunkX; x <= endChunkX; x++) {
      for (let y = startChunkY; y <= endChunkY; y++) {
        visibleChunks.push(`${x},${y}`);
      }
    }

    return visibleChunks;
  }

  updateVisibleChunks() {
    if (this.socket.readyState !== WebSocket.OPEN) return;

    const visibleChunks = this.getVisibleChunkKeys();

    // Check if visible chunks have changed to avoid unnecessary processing
    const visibleChunksString = JSON.stringify(visibleChunks.sort());
    const lastVisibleChunksString = JSON.stringify(this.lastVisibleChunks.sort());

    if (visibleChunksString === lastVisibleChunksString) {
      return;
    }

    this.lastVisibleChunks = visibleChunks;

    // Check for pending chunks
    this.checkPendingChunks();

    // Unload chunks that are far outside the visible area (with additional buffer for unloading)
    const unloadBuffer = CHUNK_BUFFER + 2; // Extra buffer before unloading chunks

    // Calculate the extended bounds for unloading using player position
    const centerX = this.player.x;
    const centerY = this.player.y;
    const halfWidth = (this.camera.width / this.camera.zoom) / 2;
    const halfHeight = (this.camera.height / this.camera.zoom) / 2;

    const chunkSize = CHUNK_SIZE * TILE_SIZE;
    const minX = Math.floor((centerX - halfWidth) / chunkSize) - unloadBuffer;
    const maxX = Math.floor((centerX + halfWidth) / chunkSize) + unloadBuffer;
    const minY = Math.floor((centerY - halfHeight) / chunkSize) - unloadBuffer;
    const maxY = Math.floor((centerY + halfHeight) / chunkSize) + unloadBuffer;

    // Check all loaded chunks
    const loadedChunkKeys = Array.from(this.loadedChunks);
    for (const chunkKey of loadedChunkKeys) {
      const [x, y] = chunkKey.split(',').map(Number);

      // Check if chunk is far outside the camera view
      if (x < minX || x > maxX || y < minY || y > maxY) {
        this.unloadChunk(chunkKey);
      }
    }
  }

  unloadChunk(chunkKey: string) {
    // Remove tiles from the scene
    if (this.chunks[chunkKey]) {
      const [chunkX, chunkY] = chunkKey.split(',').map(Number);
      const startX = chunkX * CHUNK_SIZE * TILE_SIZE;
      const startY = chunkY * CHUNK_SIZE * TILE_SIZE;
      const endX = startX + CHUNK_SIZE * TILE_SIZE;
      const endY = startY + CHUNK_SIZE * TILE_SIZE;

      // Create a temporary array to store tiles to be removed
      const tilesToRemove: Phaser.GameObjects.GameObject[] = [];

      // Find all tiles in this chunk
      this.tilesGroup.getChildren().forEach((tile: any) => {
        const tileX = tile.x;
        const tileY = tile.y;

        // Check if this tile belongs to the chunk we're unloading
        if (
          tileX >= startX &&
          tileX < endX &&
          tileY >= startY &&
          tileY < endY
        ) {
          tilesToRemove.push(tile);
        }
      });

      // Remove all tiles at once - destroy each tile individually
      tilesToRemove.forEach(tile => {
        tile.destroy();
      });

      // Remove from data structures
      delete this.chunks[chunkKey];
      this.loadedChunks.delete(chunkKey);
    }
  }

  renderChunk(chunkX: number, chunkY: number, tiles: any[]) {
    // Calculate the absolute world position for this chunk
    const startX = chunkX * CHUNK_SIZE * TILE_SIZE;
    const startY = chunkY * CHUNK_SIZE * TILE_SIZE;

    // Create a batch of tiles to add all at once
    const newTiles: Phaser.GameObjects.Rectangle[] = [];

    tiles.forEach((tile: any) => {
      // Calculate absolute world position for this tile
      const tileWorldX = startX + tile.x * TILE_SIZE;
      const tileWorldY = startY + tile.y * TILE_SIZE;

      const color = this.getTileColor(tile.type);
      const tileRect = this.add.rectangle(
        tileWorldX,
        tileWorldY,
        TILE_SIZE,
        TILE_SIZE,
        color
      ).setOrigin(0);

      // Add to our local array
      newTiles.push(tileRect);
    });

    // Add all tiles to the group at once
    this.tilesGroup.addMultiple(newTiles);
  }

  getTileColor(type: string) {
    switch (type) {
      case "grass": return 0x00ff00;
      case "rock": return 0xaaaaaa;
      case "forest": return 0x006600;
      case "water": return 0x0000ff;
      case "desert": return 0xffcc00;
      default: return 0xffffff;
    }
  }

  renderPlayers(playersData: Record<string, { x: number; y: number }>) {
    // Remove players that no longer exist
    Object.keys(this.players).forEach((id) => {
      if (!playersData[id] && id !== this.playerId) {
        this.players[id].destroy();
        delete this.players[id];
      }
    });

    // Update or create other players
    Object.entries(playersData).forEach(([id, { x, y }]) => {
      if (id === this.playerId) return; // Skip rendering this client's player

      if (this.players[id]) {
        // Update existing player position
        this.players[id].setPosition(x, y);
      } else {
        // Create new player rectangle
        this.players[id] = this.add.rectangle(x, y, TILE_SIZE, TILE_SIZE, 0xff00ff).setDepth(1);
      }
    });
  }

  /**
   * Logs memory usage statistics for debugging purposes.
   */
  public getMemoryStats() {
    return {
      loadedChunks: this.loadedChunks.size,
      pendingChunks: this.pendingChunks.size,
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
      `${stats.tiles} tiles, ${stats.players} players`
    );
  }
}

