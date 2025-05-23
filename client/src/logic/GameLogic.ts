import { INetworkAdapter } from "@/network/INetworkAdapter";

export class GameLogic {
  playerPosition: { x: number; y: number; } = { x: 0, y: 0 };
  viewport: { width: number; height: number; zoom: number; } = { width: 0, height: 0, zoom: 1 };
  lastVisibleChunks: string[] = [];
  pendingChunks: Set<string> = new Set();
  loadedChunks: Set<string> = new Set();
  chunks: Record<string, any> = {};
  playerId: string = '';
  players: Record<string, { x: number; y: number }> = {};
  CHUNK_SIZE: number;
  TILE_SIZE: number;
  CHUNK_BUFFER: number;
  MAX_PENDING_REQUESTS: number;
  lastPlayerChunkX: number = 0;
  lastPlayerChunkY: number = 0;
  lastChunkCheck: number = 0;
  private networkAdapter: INetworkAdapter;

  // Performance tracking
  private frameTimes: number[] = [];
  private frameTimeIndex: number = 0;
  private FRAME_HISTORY_SIZE: number;
  private perfStats = {
    frameCount: 0,
    averageFrameTime: 0,
  }

  constructor(
    networkAdapter: INetworkAdapter,
    config: {
      CHUNK_SIZE: number,
      TILE_SIZE: number,
      CHUNK_BUFFER: number,
      MAX_PENDING_REQUESTS: number,
      FRAME_HISTORY_SIZE: number
    }
  ) {
    this.networkAdapter = networkAdapter;
    this.CHUNK_SIZE = config.CHUNK_SIZE;
    this.TILE_SIZE = config.TILE_SIZE;
    this.CHUNK_BUFFER = config.CHUNK_BUFFER;
    this.MAX_PENDING_REQUESTS = config.MAX_PENDING_REQUESTS;
    this.FRAME_HISTORY_SIZE = config.FRAME_HISTORY_SIZE;
    this.frameTimes = new Array(this.FRAME_HISTORY_SIZE).fill(0);
    this.frameTimeIndex = 0;

    // Set up network message handling
    this.networkAdapter.onMessage(this.handleNetworkMessage.bind(this));
  }

  private handleNetworkMessage(data: unknown) {
    const message = data as any;
    
    if (message.type === "chunkData") {
      const { x, y, tiles } = message.chunk;
      const chunkKey = `${x},${y}`;
      this.processChunkData({ x, y, tiles });
      this.loadedChunks.add(chunkKey);
      this.pendingChunks.delete(chunkKey);
      this.checkPendingChunks();
    } else if (message.type === "connected") {
      this.playerId = message.id;
      this.updatePlayers(message.players);
    } else if (message.type === "playerUpdate") {
      this.updatePlayers(message.players);
    }
  }

  getVisibleChunkKeys() {
    const centerX = this.playerPosition.x;
    const centerY = this.playerPosition.y;
    const halfWidth = (this.viewport.width / this.viewport.zoom) / 2;
    const halfHeight = (this.viewport.height / this.viewport.zoom) / 2;

    const cameraBounds = {
      left: centerX - halfWidth,
      right: centerX + halfWidth,
      top: centerY - halfHeight,
      bottom: centerY + halfHeight
    };

    const chunkSize = this.CHUNK_SIZE * this.TILE_SIZE;

    const startChunkX = Math.floor(cameraBounds.left / chunkSize) - this.CHUNK_BUFFER;
    const endChunkX = Math.floor(cameraBounds.right / chunkSize) + this.CHUNK_BUFFER;
    const startChunkY = Math.floor(cameraBounds.top / chunkSize) - this.CHUNK_BUFFER;
    const endChunkY = Math.floor(cameraBounds.bottom / chunkSize) + this.CHUNK_BUFFER;

    const visibleChunks: string[] = [];
    for (let x = startChunkX; x <= endChunkX; x++) {
      for (let y = startChunkY; y <= endChunkY; y++) {
        visibleChunks.push(`${x},${y}`);
      }
    }

    return visibleChunks;
  }

  checkPendingChunks() {
    if (this.networkAdapter.readyState !== 'open') return;

    const visibleChunks = this.getVisibleChunkKeys();
    const chunksToRequest = visibleChunks.filter(
      chunkKey => !this.loadedChunks.has(chunkKey) && !this.pendingChunks.has(chunkKey)
    );

    const availableSlots = this.MAX_PENDING_REQUESTS - this.pendingChunks.size;
    if (availableSlots > 0 && chunksToRequest.length > 0) {
      const chunksToLoad = chunksToRequest.slice(0, availableSlots);

      for (const chunkKey of chunksToLoad) {
        const [x, y] = chunkKey.split(',').map(Number);
        this.networkAdapter.send({ type: "requestChunk", x, y });
        this.pendingChunks.add(chunkKey);
      }
    }
  }

  addPendingChunks(keys: string[]) {
    keys.forEach(key => {
      if (!this.loadedChunks.has(key) && !this.pendingChunks.has(key)) {
        this.pendingChunks.add(key);
      }
    });
    this.checkPendingChunks();
  }

  unloadDistantChunks() {
    const unloadBuffer = this.CHUNK_BUFFER + 2;
    const centerX = this.playerPosition.x;
    const centerY = this.playerPosition.y;
    const halfWidth = (this.viewport.width / this.viewport.zoom) / 2;
    const halfHeight = (this.viewport.height / this.viewport.zoom) / 2;

    const chunkSize = this.CHUNK_SIZE * this.TILE_SIZE;
    const minX = Math.floor((centerX - halfWidth) / chunkSize) - unloadBuffer;
    const maxX = Math.floor((centerX + halfWidth) / chunkSize) + unloadBuffer;
    const minY = Math.floor((centerY - halfHeight) / chunkSize) - unloadBuffer;
    const maxY = Math.floor((centerY + halfHeight) / chunkSize) + unloadBuffer;

    const loadedChunkKeys = Array.from(this.loadedChunks);
    for (const chunkKey of loadedChunkKeys) {
      const [x, y] = chunkKey.split(',').map(Number);
      if (x < minX || x > maxX || y < minY || y > maxY) {
        this.unloadChunk(chunkKey);
      }
    }
  }

  private unloadChunk(chunkKey: string) {
    delete this.chunks[chunkKey];
    this.loadedChunks.delete(chunkKey);
  }

  processChunkData(chunk: ChunkData) {
    const chunkKey = `${chunk.x},${chunk.y}`;
    this.chunks[chunkKey] = chunk.tiles;
  }

  getTileColor(type: string): number {
    switch (type) {
      case "grass": return 0x00ff00;
      case "rock": return 0xaaaaaa;
      case "forest": return 0x006600;
      case "water": return 0x0000ff;
      case "desert": return 0xffcc00;
      default: return 0xffffff;
    }
  }

  updatePlayers(playersData: Record<string, { x: number; y: number }>) {
    // Update player positions, but don't render here
    // We'll keep the rendering in GameScene
    Object.entries(playersData).forEach(([id, position]) => {
      if (id === this.playerId) {
        // Update our own position if it came from server
        this.playerPosition = position;
      } else {
        this.players[id] = position;
      }
    });
  }

  updateFrameTime(delta: number) {
    this.frameTimes[this.frameTimeIndex] = delta;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % this.frameTimes.length;
    this.perfStats.frameCount++;
  }

  getPerformanceStats() {
    let total = 0;
    let count = 0;
    let currentMax = 0;
    
    for (let i = 0; i < this.frameTimes.length; i++) {
        const ft = this.frameTimes[i];
        if (ft > 0) {
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
        recentFrames: [...this.frameTimes]
    };
  }

  getMemoryStats() {
    return {
      loadedChunks: this.loadedChunks.size,
      pendingChunks: this.pendingChunks.size,
      players: Object.keys(this.players).length
    };
  }

  shouldUpdateChunks(): boolean {
    const chunkSize = this.CHUNK_SIZE * this.TILE_SIZE;
    const currentChunkX = Math.floor(this.playerPosition.x / chunkSize);
    const currentChunkY = Math.floor(this.playerPosition.y / chunkSize);
    const now = Date.now();
    const throttleTime = 100;

    return (
      currentChunkX !== this.lastPlayerChunkX ||
      currentChunkY !== this.lastPlayerChunkY ||
      (now - this.lastChunkCheck > throttleTime && this.pendingChunks.size === 0)
    );
  }

  updateChunkTracking() {
    const chunkSize = this.CHUNK_SIZE * this.TILE_SIZE;
    this.lastPlayerChunkX = Math.floor(this.playerPosition.x / chunkSize);
    this.lastPlayerChunkY = Math.floor(this.playerPosition.y / chunkSize);
    this.lastChunkCheck = Date.now();
  }

  updatePlayerPosition(x: number, y: number) {
    this.playerPosition = { x, y };
    this.networkAdapter.send({ type: "move", x, y });
  }

  updateViewport(width: number, height: number, zoom: number) {
    this.viewport = { width, height, zoom };
  }
}

export type TileType = 'grass' | 'rock' | 'forest' | 'water' | 'desert';

export interface ChunkData {
  x: number;
  y: number;
  tiles: any[];
}

export interface PlayerData {
  x: number;
  y: number;
}