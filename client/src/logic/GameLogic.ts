import { Tile, WaterType, Biome, ChunkData, WaterTile, LandTile, VegetationType, ColorMap, ColorIndex, SoilType } from "../types/types";
import { INetworkAdapter } from "../network/INetworkAdapter";
import { NetworkFactory } from "../network/NetworkFactory";

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
  public partialChunks: Record<string, { tiles: Tile[], expiration: number }> = {};

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

    if (message.type === "chunkData") {
      const { mode } = message;

      if (mode === 'chunk') {
        let { x, y, tiles } = message.chunk;
        if (tiles && tiles.length > 0 && Array.isArray(tiles[0])) {
          tiles = tiles.map((t: any) => {
            const isWater = t[4] === 1;
            const baseProperties = {
              x: t[0],
              y: t[1],
              h: t[2],
              nH: t[3],
              t: t[5],
              p: t[6],
              stp: t[7],
              b: t[8] as Biome,
              c: t[9] as ColorIndex,
              iC: t[10] === 1,
              w: isWater
            };

            if (isWater) {
              return {
                ...baseProperties,
                wT: t[11] as WaterType
              } as WaterTile;
            } else {
              return {
                ...baseProperties,
                v: t[12],
                vT: t[13] as VegetationType,
                sT: t[14] as SoilType
              } as LandTile;
            }
          });
        }
        this.processChunkData(message.chunk);
        const chunkKey = `${message.chunk.x},${message.chunk.y}`;
        this.loadedChunks.add(chunkKey);
        this.pendingChunks.delete(chunkKey);
      } else {
        // Handle partial data
        const partialKey = mode === 'point'
          ? `${message.chunk.x},${message.chunk.y}_point`
          : `${message.chunk.x},${message.chunk.y}_${message.edge}`;

        // Store partial data temporarily (expires after 5 minutes)
        this.partialChunks[partialKey] = {
          tiles: processTiles(message.tiles),
          expiration: Date.now() + 300000
        };

        this.pendingChunks.delete(partialKey);
      }

      this.checkPendingChunks();
    } else if (message.type === "connected") {
      this.playerId = message.id;
      this.updatePlayers(message.players);
    } else if (message.type === "playerUpdate") {
      this.updatePlayers(message.players);
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
        this.networkAdapter.send({ type: "requestChunk", x, y });
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



  public getChunkWithBorders(x: number, y: number): ChunkData | null {
    const chunkKey = `${x},${y}`;
    if (!this.chunks[chunkKey]) {
      console.warn(`Chunk at (${x}, ${y}) not found`);
      return null;
    }

    // Clone the chunk data to avoid modifying original
    const chunkWithBorders = JSON.parse(JSON.stringify(this.chunks[chunkKey]));

    // Get neighboring chunks or request partial data
    const neighbors = [
      { dx: -1, dy: 0, edge: 'east' },    // west
      { dx: 1, dy: 0, edge: 'west' },     // east
      { dx: 0, dy: -1, edge: 'south' },   // north
      { dx: 0, dy: 1, edge: 'north' },    // south
      { dx: -1, dy: -1 }, // northwest
      { dx: 1, dy: -1 },  // northeast
      { dx: -1, dy: 1 },  // southwest
      { dx: 1, dy: 1 }    // southeast
    ];

    for (const neighbor of neighbors) {
      const neighborX = x + neighbor.dx;
      const neighborY = y + neighbor.dy;
      const neighborKey = `${neighborX},${neighborY}`;

      // Check if we have the full chunk
      if (this.chunks[neighborKey]) {
        // Use full chunk data
        const neighborChunk = this.chunks[neighborKey];
        addBorderTiles(chunkWithBorders, neighborChunk, neighbor.dx, neighbor.dy);
      } else {
        // Check if we have partial data
        const partialKey = `${neighborKey}_${neighbor.edge || 'point'}`;
        const now = Date.now();

        if (this.partialChunks[partialKey] && this.partialChunks[partialKey].expiration > now) {
          // Use cached partial data
          addPartialBorderTiles(chunkWithBorders, this.partialChunks[partialKey].tiles, neighbor.dx, neighbor.dy);
        } else {
          // Request partial data
          if (neighbor.edge) {
            // Request row or column for edge neighbors
            this.requestChunkPartial(neighborX, neighborY, neighbor.edge === 'north' || neighbor.edge === 'south' ? 'row' : 'column', neighbor.edge);
          } else {
            // Request specific points for diagonal neighbors
            this.requestChunkPartial(neighborX, neighborY, 'point', undefined, getDiagonalPositions(neighbor.dx, neighbor.dy));
          }
        }
      }
    }

    // Clean up expired partial data
    this.cleanupPartialChunks();

    return chunkWithBorders;
  }

  public cleanupPartialChunks(): void {
    const now = Date.now();
    Object.keys(this.partialChunks).forEach(key => {
      if (this.partialChunks[key].expiration <= now) {
        delete this.partialChunks[key];
      }
    });
  }

  // Add method to request partial chunk data
  public requestChunkPartial(x: number, y: number, mode: 'row' | 'column' | 'point', edge?: string, positions?: { x: number, y: number }[]): void {
    const key = mode === 'point' ? `${x},${y}_point` : `${x},${y}_${edge}`;

    // Don't request if we already have pending or loaded data
    if (this.partialChunks[key] || this.pendingChunks.has(key)) return;

    this.pendingChunks.add(key);
    this.networkAdapter.send({
      type: "requestChunk",
      x,
      y,
      mode,
      edge,
      positions
    });
  }
}

// Helper to get positions for diagonal requests
function getDiagonalPositions(dx: number, dy: number): { x: number, y: number }[] {
  const CHUNK_SIZE = 10;
  if (dx === -1 && dy === -1) return [{ x: CHUNK_SIZE - 1, y: CHUNK_SIZE - 1 }]; // northwest -> southeast corner of neighbor
  if (dx === 1 && dy === -1) return [{ x: 0, y: CHUNK_SIZE - 1 }]; // northeast -> southwest corner
  if (dx === -1 && dy === 1) return [{ x: CHUNK_SIZE - 1, y: 0 }]; // southwest -> northeast corner
  if (dx === 1 && dy === 1) return [{ x: 0, y: 0 }]; // southeast -> northwest corner
  return [];
}

// Helper to process raw tile data
function processTiles(rawTiles: any[]): Tile[] {
  return rawTiles.map((t: any) => {
    const isWater = t[4] === 1;
    const baseProperties = {
      x: t[0],
      y: t[1],
      h: t[2],
      nH: t[3],
      t: t[5],
      p: t[6],
      stp: t[7],
      b: t[8] as Biome,
      c: t[9] as ColorIndex,
      iC: t[10] === 1,
      w: isWater
    };

    if (isWater) {
      return {
        ...baseProperties,
        wT: t[11] as WaterType
      } as WaterTile;
    } else {
      return {
        ...baseProperties,
        v: t[12],
        vT: t[13] as VegetationType,
        sT: t[14] as SoilType
      } as LandTile;
    }
  });
}

// Add function to add border tiles from full neighbor chunks
function addBorderTiles(targetChunk: ChunkData, neighborChunk: ChunkData, dx: number, dy: number) {
  // Existing logic to add border tiles from full neighbor chunks
  for (const tile of neighborChunk.tiles) {
    const isBorderTile = isNeighborBorderTile(tile, dx, dy, neighborChunk.x, neighborChunk.y);
    if (isBorderTile) {
      targetChunk.tiles.push({ ...tile });
    }
  }
}

// Add function to add border tiles from partial data
function addPartialBorderTiles(targetChunk: ChunkData, partialTiles: Tile[], dx: number, dy: number) {
  // Add the partial tiles that are relevant for borders
  partialTiles.forEach(tile => {
    // Adjust coordinates relative to the target chunk
    const adjustedTile = {
      ...tile,
      x: tile.x + dx * CHUNK_SIZE,
      y: tile.y + dy * CHUNK_SIZE
    };

    // Only add if it's actually a border tile
    if (isBorderPosition(adjustedTile.x, adjustedTile.y, targetChunk.x, targetChunk.y)) {
      targetChunk.tiles.push(adjustedTile);
    }
  });
}

// Helper to check if a position is on the border
function isBorderPosition(x: number, y: number, chunkX: number, chunkY: number): boolean {
  const localX = x - chunkX * CHUNK_SIZE;
  const localY = y - chunkY * CHUNK_SIZE;

  return localX < 0 || localX >= CHUNK_SIZE || localY < 0 || localY >= CHUNK_SIZE;
}

// Update isBorderTile to work with neighbor coordinates
function isNeighborBorderTile(tile: Tile, dx: number, dy: number, neighborX: number, neighborY: number): boolean {
  const localX = tile.x - neighborX * CHUNK_SIZE;
  const localY = tile.y - neighborY * CHUNK_SIZE;

  // Adjust logic based on neighbor position
  if (dx === -1 && localX === CHUNK_SIZE - 1) return true; // west neighbor - need east border
  if (dx === 1 && localX === 0) return true; // east neighbor - need west border
  if (dy === -1 && localY === CHUNK_SIZE - 1) return true; // north neighbor - need south border
  if (dy === 1 && localY === 0) return true; // south neighbor - need north border

  // Diagonal neighbors - need corner tiles
  if (dx === -1 && dy === -1 && localX === CHUNK_SIZE - 1 && localY === CHUNK_SIZE - 1) return true;
  if (dx === 1 && dy === -1 && localX === 0 && localY === CHUNK_SIZE - 1) return true;
  if (dx === -1 && dy === 1 && localX === CHUNK_SIZE - 1 && localY === 0) return true;
  if (dx === 1 && dy === 1 && localX === 0 && localY === 0) return true;

  return false;
}
