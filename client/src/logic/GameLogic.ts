import { WaterType, Biome, VegetationType, ColorIndex, SoilType } from "shared/TerrainTypes";
import { ChunkData } from "shared/ChunkTypes";
import { Tile, WaterTile, LandTile } from "shared/TileTypes";
import { INetworkAdapter } from "../network/INetworkAdapter";
import { NetworkFactory } from "../network/NetworkFactory";
import { ResourceNode, ResourceType } from "shared/ResourceTypes";
import { TileNormalizer } from "./NormalizeTiles";

export interface PlayerData {
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
  zoom: number;
}

export interface PerformanceStats {
  frameCount: number;
  averageFrameTime: number;
  maxFrameTime: number;
  recentFrames: number[];
}

export interface MemoryStats {
  loadedChunks: number;
  pendingChunks: number;
  players: number;
}

export const CHUNK_SIZE: number = 10;
export const TILE_SIZE: number = 64;
export const CHUNK_BUFFER: number = 2; // Increased buffer for smoother experience
export const MAX_PENDING_REQUESTS: number = 12; // Increased concurrent requests
export const FRAME_HISTORY_SIZE: number = 300;
export const PREDICTIVE_BUFFER: number = 3; // Additional buffer for predictive loading

export class GameLogic {
  // Configuration

  // Network
  private readonly boundHandleMessage = this.handleNetworkMessage.bind(this);

  // Game state
  public chunks: Record<string, ChunkData> = {};
  public loadedChunks: Set<string> = new Set();
  public pendingChunks: Set<string> = new Set();
  public players: Record<string, PlayerData> = {};
  public playerId: string = '';
  public playerPosition: PlayerData = { x: 0, y: 0 };
  public lastVisibleChunks: string[] = [];
  public lastPlayerChunkX: number = 0;
  public lastPlayerChunkY: number = 0;
  public lastChunkCheck: number = 0;
  private borderCache = new Map<string, ChunkData>();

  // Movement tracking for predictive loading
  private lastPlayerPosition: PlayerData = { x: 0, y: 0 };
  private playerVelocity: PlayerData = { x: 0, y: 0 };
  private movementHistory: PlayerData[] = [];
  private readonly MOVEMENT_HISTORY_SIZE = 10;

  // Viewport settings
  public viewport: Viewport = {
    width: 800,  // Default values for testing
    height: 600,
    zoom: 2
  };

  // Performance tracking
  private frameTimes: number[] = new Array(FRAME_HISTORY_SIZE).fill(0);
  private frameTimeIndex: number = 0;
  private perfStats = {
    frameCount: 0,
    averageFrameTime: 0,
  };

  // Network
  private networkAdapter: INetworkAdapter;

  constructor() {
    this.networkAdapter = NetworkFactory.createAdapter();
  }
  public async connect() {
    await this.networkAdapter.connect();
    this.networkAdapter.onMessage(this.boundHandleMessage);
  }

  public async disconnect() {
    this.networkAdapter.offMessage?.(this.boundHandleMessage);
    await this.networkAdapter.disconnect();
  }

  private handleNetworkMessage(data: unknown) {
    const message = data as any;
    if (message.type === "chunkData" || message.type === "chunkUpdate") {
      const { x, y, tiles, mode, resources } = message.chunk;
      const chunkKey = `${x},${y}`;
      if (!tiles || !Array.isArray(tiles[0]) || tiles[0].length < 15 || tiles[0].length > 15) return;

      const mappedTiles = TileNormalizer.NormalizeTiles(tiles);
      
      if (resources) {
        Object.entries(resources).forEach(([key, res]) => {
          const [x, y] = key.split(',').map(Number);
          const tile = mappedTiles.find((t: Tile) => t.x === x && t.y === y);
          if (tile) {
            if (tile.r) {
              tile.r.push(res as ResourceNode);
            } else {
              tile.r = [res as ResourceNode];
            }
          }
        });
      }

      const chunkData = { x, y, tiles: mappedTiles };

      if (mode === "chunk") {
        this.chunks[chunkKey] = chunkData;
        this.processChunkData(chunkData);
        this.loadedChunks.add(chunkKey);
        this.checkPendingChunks();
      } else {
        const worldKey = `${x},${y}`;
        this.borderCache.set(worldKey, chunkData);
      }

      // Remove from pending
      const pendingKey = mode === "chunk" ? chunkKey : `${x},${y}`;
      this.pendingChunks.delete(pendingKey);
    }
    else if (message.type === "miningSuccess") {
      this.handleMiningUpdate(
        message.x,
        message.y,
        message.resource,
        message.amount
      );
    }
    else if (message.type === "connected") {
      this.playerId = message.id;
      this.updatePlayers(message.players);
    }
    else if (message.type === "playerUpdate") {
      this.updatePlayers(message.players);
    }
  }

  private handleMiningUpdate(x: number, y: number, resourceType: ResourceType, amount: number) {
    // Convert world coordinates to chunk coordinates
    const chunkSize = 10;
    const chunkX = Math.floor(x / chunkSize);
    const chunkY = Math.floor(y / chunkSize);
    const tileX = x % chunkSize;
    const tileY = y % chunkSize;
    const chunkKey = `${chunkX},${chunkY}`;

    const chunk = this.chunks[chunkKey];
    if (!chunk) return;

    // Find the specific tile
    const tileIndex = tileY * chunkSize + tileX;
    if (tileIndex >= chunk.tiles.length) return;

    const tile = chunk.tiles[tileIndex];

    // Update resource data
    if (tile.r) {
      const resource = tile.r.find((r: ResourceNode) => r.type === resourceType);
      if (resource) {
        resource.remaining = Math.max(0, resource.remaining - amount);
      }
    }
  }

  // Chunk management
  public updateVisibleChunks(): void {
    const visibleChunks = this.getVisibleChunkKeys();

    // Check if visible chunks have changed
    if (this.chunksChanged(visibleChunks)) {
      this.lastVisibleChunks = visibleChunks;
      this.checkPendingChunks();
      this.unloadDistantChunks();
    }
  }

  public chunksChanged(newChunks: string[]): boolean {
    if (newChunks.length !== this.lastVisibleChunks.length) {
      return true;
    }

    const newSorted = [...newChunks].sort();
    const lastSorted = [...this.lastVisibleChunks].sort();

    for (let i = 0; i < newSorted.length; i++) {
      if (newSorted[i] !== lastSorted[i]) {
        return true;
      }
    }

    return false;
  }



  public getVisibleChunkKeys(): string[] {
    const centerX = this.playerPosition.x;
    const centerY = this.playerPosition.y;

    // Calculate visible area
    const halfWidth = (this.viewport.width / this.viewport.zoom) / 2;
    const halfHeight = (this.viewport.height / this.viewport.zoom) / 2;

    const cameraBounds = {
      left: centerX - halfWidth,
      right: centerX + halfWidth,
      top: centerY - halfHeight,
      bottom: centerY + halfHeight
    };

    // Convert to chunk coordinates with buffer
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

  public checkPendingChunks(): string[] {
    if (this.networkAdapter.readyState !== 'open') return [];

    const visibleChunks = this.getVisibleChunkKeys();
    const predictiveChunks = this.getPredictiveChunkKeys();

    // Combine visible and predictive chunks, prioritizing visible chunks
    const allChunks = [...new Set([...visibleChunks, ...predictiveChunks])];

    const chunksToRequest = allChunks.filter(
      chunkKey => !this.loadedChunks.has(chunkKey) && !this.pendingChunks.has(chunkKey)
    );

    // Prioritize chunks: visible chunks first, then predictive chunks
    const prioritizedChunks = this.prioritizeChunks(chunksToRequest, visibleChunks);

    const availableSlots = MAX_PENDING_REQUESTS - this.pendingChunks.size;
    if (availableSlots > 0 && prioritizedChunks.length > 0) {
      const chunksToLoad = prioritizedChunks.slice(0, availableSlots);

      for (const chunkKey of chunksToLoad) {
        const [x, y] = chunkKey.split(',').map(Number);
        this.networkAdapter.send({ type: "requestChunk", x, y, "mode": "chunk" });
        this.pendingChunks.add(chunkKey);
      }

      return chunksToLoad;
    }
    return [];
  }

  private prioritizeChunks(chunksToRequest: string[], visibleChunks: string[]): string[] {
    const playerChunkSize = CHUNK_SIZE * TILE_SIZE;
    const playerChunkX = Math.floor(this.playerPosition.x / playerChunkSize);
    const playerChunkY = Math.floor(this.playerPosition.y / playerChunkSize);

    return chunksToRequest.sort((a, b) => {
      const [aX, aY] = a.split(',').map(Number);
      const [bX, bY] = b.split(',').map(Number);

      // Prioritize visible chunks over predictive chunks
      const aIsVisible = visibleChunks.includes(a);
      const bIsVisible = visibleChunks.includes(b);

      if (aIsVisible && !bIsVisible) return -1;
      if (!aIsVisible && bIsVisible) return 1;

      // Within the same category, prioritize by distance from player
      const aDistance = Math.abs(aX - playerChunkX) + Math.abs(aY - playerChunkY);
      const bDistance = Math.abs(bX - playerChunkX) + Math.abs(bY - playerChunkY);

      return aDistance - bDistance;
    });
  }

  public addPendingChunks(chunkKeys: string[]): void {
    chunkKeys.forEach(key => {
      if (!this.loadedChunks.has(key) && !this.pendingChunks.has(key)) {
        this.pendingChunks.add(key);
      }
    });
    this.checkPendingChunks();
  }

  public unloadDistantChunks(): string[] {
    const unloadBuffer = CHUNK_BUFFER + 2;
    const centerX = this.playerPosition.x;
    const centerY = this.playerPosition.y;
    const halfWidth = (this.viewport.width / this.viewport.zoom) / 2;
    const halfHeight = (this.viewport.height / this.viewport.zoom) / 2;

    const chunkSize = CHUNK_SIZE * TILE_SIZE;
    const minX = Math.floor((centerX - halfWidth) / chunkSize) - unloadBuffer;
    const maxX = Math.floor((centerX + halfWidth) / chunkSize) + unloadBuffer;
    const minY = Math.floor((centerY - halfHeight) / chunkSize) - unloadBuffer;
    const maxY = Math.floor((centerY + halfHeight) / chunkSize) + unloadBuffer;

    const chunksToUnload: string[] = [];
    const loadedChunkKeys = Array.from(this.loadedChunks);

    for (const chunkKey of loadedChunkKeys) {
      const [x, y] = chunkKey.split(',').map(Number);
      if (x < minX || x > maxX || y < minY || y > maxY) {
        chunksToUnload.push(chunkKey);
      }
    }

    return chunksToUnload;
  }

  public removeChunks(chunkKeys: string[]): void {
    chunkKeys.forEach(key => {
      this.loadedChunks.delete(key);
      delete this.chunks[key];
    });
  }

  public processChunkData(chunkData: ChunkData): string {
    const { x, y } = chunkData;
    const chunkKey = `${x},${y}`;
    this.chunks[chunkKey] = chunkData;
    this.loadedChunks.add(chunkKey);
    this.pendingChunks.delete(chunkKey);
    return chunkKey;
  }

  public requestChunk(x: number, y: number, mode: 'chunk' | 'row' | 'column'): void {
    const key = `${x},${y}`;
    if (!this.chunks[key] && !this.pendingChunks.has(key)) {
      this.pendingChunks.add(key);
      this.networkAdapter.send({ type: "requestChunk", x, y, mode });
    }
  }


  // Player management
  public updatePlayers(playersData: Record<string, PlayerData>): void {
    // Remove players that no longer exist
    Object.keys(this.players).forEach(id => {
      if (!playersData[id] && id !== this.playerId) {
        delete this.players[id];
      }
    });

    // Update or add players
    Object.entries(playersData).forEach(([id, data]) => {
      if (id !== this.playerId) {
        this.players[id] = data;
      } else {
        // Update our own position if it came from server
        this.playerPosition = data;
      }
    });
  }

  public updatePlayerPosition(x: number, y: number): void {
    // Update movement tracking
    this.updateMovementTracking(x, y);

    this.playerPosition = { x, y };
    this.networkAdapter.send({ type: "move", x, y });
  }

  private updateMovementTracking(x: number, y: number): void {
    // Calculate velocity
    this.playerVelocity = {
      x: x - this.lastPlayerPosition.x,
      y: y - this.lastPlayerPosition.y
    };

    // Update movement history
    this.movementHistory.push({ ...this.playerVelocity });
    if (this.movementHistory.length > this.MOVEMENT_HISTORY_SIZE) {
      this.movementHistory.shift();
    }

    this.lastPlayerPosition = { x, y };
  }

  private getPredictedPosition(): PlayerData {
    if (this.movementHistory.length === 0) {
      return { ...this.playerPosition };
    }

    // Calculate average velocity over recent history
    const avgVelocity = this.movementHistory.reduce(
      (acc, vel) => ({ x: acc.x + vel.x, y: acc.y + vel.y }),
      { x: 0, y: 0 }
    );
    avgVelocity.x /= this.movementHistory.length;
    avgVelocity.y /= this.movementHistory.length;

    // Predict position several frames ahead
    const predictionFrames = 30; // Predict 30 frames ahead
    return {
      x: this.playerPosition.x + (avgVelocity.x * predictionFrames),
      y: this.playerPosition.y + (avgVelocity.y * predictionFrames)
    };
  }

  public getPredictiveChunkKeys(): string[] {
    const predictedPos = this.getPredictedPosition();
    const chunkSize = CHUNK_SIZE * TILE_SIZE;

    // Calculate visible area around predicted position
    const halfWidth = (this.viewport.width / this.viewport.zoom) / 2;
    const halfHeight = (this.viewport.height / this.viewport.zoom) / 2;

    const predictedBounds = {
      left: predictedPos.x - halfWidth,
      right: predictedPos.x + halfWidth,
      top: predictedPos.y - halfHeight,
      bottom: predictedPos.y + halfHeight
    };

    // Convert to chunk coordinates with predictive buffer
    const startChunkX = Math.floor(predictedBounds.left / chunkSize) - PREDICTIVE_BUFFER;
    const endChunkX = Math.floor(predictedBounds.right / chunkSize) + PREDICTIVE_BUFFER;
    const startChunkY = Math.floor(predictedBounds.top / chunkSize) - PREDICTIVE_BUFFER;
    const endChunkY = Math.floor(predictedBounds.bottom / chunkSize) + PREDICTIVE_BUFFER;

    const predictiveChunks: string[] = [];
    for (let x = startChunkX; x <= endChunkX; x++) {
      for (let y = startChunkY; y <= endChunkY; y++) {
        predictiveChunks.push(`${x},${y}`);
      }
    }

    return predictiveChunks;
  }

  public updateViewport(width: number, height: number, zoom: number): void {
    this.viewport = { width, height, zoom };
  }

  // Performance tracking
  public updateFrameTime(delta: number): void {
    this.frameTimes[this.frameTimeIndex] = delta;
    this.frameTimeIndex = (this.frameTimeIndex + 1) % FRAME_HISTORY_SIZE;
    this.perfStats.frameCount++;
  }

  public getPerformanceStats(): PerformanceStats {
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

  public getMemoryStats(): MemoryStats {
    return {
      loadedChunks: this.loadedChunks.size,
      pendingChunks: this.pendingChunks.size,
      players: Object.keys(this.players).length
    };
  }

  // Helper methods
  public shouldUpdateChunks(): boolean {
    const chunkSize = CHUNK_SIZE * TILE_SIZE;
    const currentChunkX = Math.floor(this.playerPosition.x / chunkSize);
    const currentChunkY = Math.floor(this.playerPosition.y / chunkSize);
    const now = Date.now();
    const throttleTime = 50; // Reduced throttle time for more responsive loading

    return (
      currentChunkX !== this.lastPlayerChunkX ||
      currentChunkY !== this.lastPlayerChunkY ||
      (now - this.lastChunkCheck > throttleTime && this.pendingChunks.size < MAX_PENDING_REQUESTS)
    );
  }

  public updateChunkTracking(): void {
    const chunkSize = CHUNK_SIZE * TILE_SIZE;
    this.lastPlayerChunkX = Math.floor(this.playerPosition.x / chunkSize);
    this.lastPlayerChunkY = Math.floor(this.playerPosition.y / chunkSize);
    this.lastChunkCheck = Date.now();
  }

  public async getChunkWithBorders(x: number, y: number): Promise<ChunkData | null> {
    const chunkKey = `${x},${y}`;
    const baseChunk = this.chunks[chunkKey];
    if (!baseChunk) {
      console.warn(`Chunk at (${x}, ${y}) not found`);
      return null;
    }

    const chunkWithBorders: ChunkData = {
      x,
      y,
      tiles: [...baseChunk.tiles]
    };

    const seenTiles = new Set<string>();
    for (const tile of chunkWithBorders.tiles) {
      seenTiles.add(`${tile.x},${tile.y}`);
    }

    const waitForBorderData = async (chunkKey: string, borderKey: string): Promise<ChunkData | null> => {
      const maxWait = 500;
      const interval = 50;
      let elapsed = 0;

      while (elapsed < maxWait) {
        // Check for full chunk first (highest priority)
        if (this.chunks[chunkKey]) {
          return this.chunks[chunkKey];
        }
        // Then check border cache using world coordinate key
        if (this.borderCache.has(borderKey)) {
          return this.borderCache.get(borderKey)!;
        }

        await new Promise(res => setTimeout(res, interval));
        elapsed += interval;
      }

      console.warn(`Border data for chunk ${chunkKey} / border ${borderKey} not available after waiting.`);
      return null;
    };

    // Convert chunk coordinates to world coordinates for border requests
    const CHUNK_SIZE = 10; // Assuming 10x10 chunks
    const chunkWorldX = x * CHUNK_SIZE;
    const chunkWorldY = y * CHUNK_SIZE;

    // Edge neighbors - use world coordinates for border cache keys
    const edgeDefs = [
      {
        dx: -1, dy: 0, mode: 'column',
        worldX: chunkWorldX - 1, worldY: chunkWorldY,
        chunkKey: `${x - 1},${y}`,  // For checking full chunks
        borderKey: `${chunkWorldX - 1},${chunkWorldY}`  // For border cache
      },
      {
        dx: 1, dy: 0, mode: 'column',
        worldX: chunkWorldX + CHUNK_SIZE, worldY: chunkWorldY,
        chunkKey: `${x + 1},${y}`,
        borderKey: `${chunkWorldX + CHUNK_SIZE},${chunkWorldY}`
      },
      {
        dx: 0, dy: -1, mode: 'row',
        worldX: chunkWorldX, worldY: chunkWorldY - 1,
        chunkKey: `${x},${y - 1}`,
        borderKey: `${chunkWorldX},${chunkWorldY - 1}`
      },
      {
        dx: 0, dy: 1, mode: 'row',
        worldX: chunkWorldX, worldY: chunkWorldY + CHUNK_SIZE,
        chunkKey: `${x},${y + 1}`,
        borderKey: `${chunkWorldX},${chunkWorldY + CHUNK_SIZE}`
      }
    ];

    const cornerDefs = [
      {
        dx: -1, dy: -1,
        worldX: chunkWorldX - 1,
        worldY: chunkWorldY - 1,
        chunkKey: `${x - 1},${y - 1}`,
        borderKey: `${chunkWorldX - 1},${chunkWorldY - 1}`
      },
      {
        dx: 1, dy: -1,
        worldX: chunkWorldX + CHUNK_SIZE,
        worldY: chunkWorldY - 1,
        chunkKey: `${x + 1},${y - 1}`,
        borderKey: `${chunkWorldX + CHUNK_SIZE},${chunkWorldY - 1}`
      },
      {
        dx: -1, dy: 1,
        worldX: chunkWorldX - 1,
        worldY: chunkWorldY + CHUNK_SIZE,
        chunkKey: `${x - 1},${y + 1}`,
        borderKey: `${chunkWorldX - 1},${chunkWorldY + CHUNK_SIZE}`
      },
      {
        dx: 1, dy: 1,
        worldX: chunkWorldX + CHUNK_SIZE,
        worldY: chunkWorldY + CHUNK_SIZE,
        chunkKey: `${x + 1},${y + 1}`,
        borderKey: `${chunkWorldX + CHUNK_SIZE},${chunkWorldY + CHUNK_SIZE}`
      }
    ];


    const requestBorderIfMissing = (chunkKey: string, borderKey: string, worldX: number, worldY: number, mode: string) => {
      if (!this.chunks[chunkKey] && !this.borderCache.has(borderKey) && !this.pendingChunks.has(borderKey)) {
        this.pendingChunks.add(borderKey);
        this.networkAdapter.send({ type: "requestChunk", x: worldX, y: worldY, mode });
      }
      return { chunkKey, borderKey };
    };

    const borderPromises = edgeDefs.map(({ dx, dy, mode, worldX, worldY, chunkKey, borderKey }) => {
      const keys = requestBorderIfMissing(chunkKey, borderKey, worldX, worldY, mode);
      return waitForBorderData(keys.chunkKey, keys.borderKey)
        .then((neighborChunk) => ({ neighborChunk, dx, dy }));
    });

    const borderResults = await Promise.all(borderPromises);

    for (const { neighborChunk, dx, dy } of borderResults) {
      if (neighborChunk) {
        for (const tile of neighborChunk.tiles) {
          if (this.isBorderTile(tile, dx, dy)) {
            const key = `${tile.x},${tile.y}`;
            if (!seenTiles.has(key)) {
              chunkWithBorders.tiles.push({ ...tile });
              seenTiles.add(key);
            }
          }
        }
      }
    }

    const cornerPromises = cornerDefs.map(({ dx, dy, worldX, worldY, chunkKey, borderKey }) => {
      const keys = requestBorderIfMissing(chunkKey, borderKey, worldX, worldY, 'point');
      return waitForBorderData(keys.chunkKey, keys.borderKey)
        .then((neighborChunk) => ({ neighborChunk, dx, dy }));
    });

    const cornerResults = await Promise.all(cornerPromises);

    for (const { neighborChunk, dx, dy } of cornerResults) {
      if (neighborChunk) {
        const tx = chunkWorldX + dx * CHUNK_SIZE + (dx === 1 ? 0 : 9);
        const ty = chunkWorldY + dy * CHUNK_SIZE + (dy === 1 ? 0 : 9);
        const key = `${tx},${ty}`;
        if (!seenTiles.has(key)) {
          for (const tile of neighborChunk.tiles) {
            if (tile.x === tx && tile.y === ty) {
              chunkWithBorders.tiles.push({ ...tile });
              seenTiles.add(key);
              break;
            }
          }
        }
      }
    }

    this.cleanupBorderCache();

    return chunkWithBorders;
  }


  // Method to clean up old border cache entries
  private cleanupBorderCache() {
    // Keep only recent border data to prevent memory bloat
    const maxCacheSize = 100;
    if (this.borderCache.size > maxCacheSize) {
      const entries = Array.from(this.borderCache.entries());
      entries.slice(0, entries.length - maxCacheSize).forEach(([key]) => {
        this.borderCache.delete(key);
      });
    }
  }

  private isBorderTile(tile: Tile, dx: number, dy: number): boolean {
    const tileChunkX = Math.floor(tile.x / CHUNK_SIZE);
    const tileChunkY = Math.floor(tile.y / CHUNK_SIZE);

    // The chunk that owns this tile
    const targetChunkX = tileChunkX;
    const targetChunkY = tileChunkY;

    // Determine the tile's position relative to its chunk
    const localX = tile.x - (targetChunkX * CHUNK_SIZE);
    const localY = tile.y - (targetChunkY * CHUNK_SIZE);

    // For a neighbor at dx/dy, we're looking for the edge that touches the base chunk (0,0)
    // So we want tiles on the edge **facing** (0,0)
    if (dx === -1 && localX === CHUNK_SIZE - 1) return true; // west neighbor, east edge
    if (dx === 1 && localX === 0) return true;               // east neighbor, west edge
    if (dy === -1 && localY === CHUNK_SIZE - 1) return true; // north neighbor, south edge
    if (dy === 1 && localY === 0) return true;               // south neighbor, north edge

    // Diagonal corners
    if (dx === -1 && dy === -1 && localX === CHUNK_SIZE - 1 && localY === CHUNK_SIZE - 1) return true;
    if (dx === 1 && dy === -1 && localX === 0 && localY === CHUNK_SIZE - 1) return true;
    if (dx === -1 && dy === 1 && localX === CHUNK_SIZE - 1 && localY === 0) return true;
    if (dx === 1 && dy === 1 && localX === 0 && localY === 0) return true;

    return false;
  }
}