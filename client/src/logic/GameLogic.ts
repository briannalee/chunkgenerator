import { Tile, WaterType, Biome, ChunkData, WaterTile, LandTile, VegetationType, ColorMap } from "../types/types";
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
export const TILE_SIZE: number = 8;
export const CHUNK_BUFFER: number = 1;
export const MAX_PENDING_REQUESTS: number = 4;
export const FRAME_HISTORY_SIZE: number = 300;

export class GameLogic {
  // Configuration


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
    this.connect();
  }

  public async connect() {
    await this.networkAdapter.connect();
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
    const chunksToRequest = visibleChunks.filter(
      chunkKey => !this.loadedChunks.has(chunkKey) && !this.pendingChunks.has(chunkKey)
    );

    const availableSlots = MAX_PENDING_REQUESTS - this.pendingChunks.size;
    if (availableSlots > 0 && chunksToRequest.length > 0) {
      const chunksToLoad = chunksToRequest.slice(0, availableSlots);

      for (const chunkKey of chunksToLoad) {
        const [x, y] = chunkKey.split(',').map(Number);
        this.networkAdapter.send({ type: "requestChunk", x, y });
        this.pendingChunks.add(chunkKey);
      }

      return chunksToLoad;
    }
    return [];
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


  public getTileColor(tile: Tile): number {
    if (tile.w) {
      return this.getWaterColor(tile);
    } else {
      return this.getLandColor(tile);
    }
  }

    private getWaterColor(tile: WaterTile): number {
    // Depth-based water coloring
    const depthFactor = 1 - tile.nH; // Deeper water is darker
    const baseColors = {
      [WaterType.RIVER]: 0x1E90FF, // DodgerBlue
      [WaterType.OCEAN]: 0x0f4d8a,  // DeepSkyBlue
      [WaterType.LAKE]: 0x5F9EA0, // CadetBlue
      [WaterType.NONE]: 0x000000 // Default color for no water
    };

    const baseColor = baseColors[tile.wT];
    return this.darkenColor(baseColor, depthFactor * 0.7);
  }

    private getLandColor(tile: LandTile): number {
    // Elevation-based tinting
    const elevationTint = this.getElevationTint(tile.nH);
    
    // Base colors for each biome
    const biomeColors = {
      [Biome.OCEAN_DEEP]: 0x0f4d8a,
      [Biome.OCEAN_SHALLOW]: 0x08394d,
      [Biome.BEACH]: 0xF5DEB3,
      [Biome.GRASSLAND]: 0x7CFC00,
      [Biome.FOREST]: this.getForestColor(tile),
      [Biome.DENSE_FOREST]: this.getForestColor(tile),
      [Biome.SWAMP]: 0x8FBC8F,
      [Biome.MARSH]: 0x98FB98,
      [Biome.CLIFF]: 0xA9A9A9,
      [Biome.RIVER]: 0x1E90FF,
      [Biome.LAKE]: 0x5F9EA0,
      [Biome.JUNGLE]: 0x006400,
      [Biome.DESERT]: 0xF4A460,
      [Biome.SAVANNA]: 0xD2B48C,
      [Biome.TUNDRA]: 0xE6E6FA,
      [Biome.MOUNTAIN]: this.getMountainColor(tile),
      [Biome.SNOW]: 0xFFFFFF,
      [Biome.MOUNTAIN_SNOW]: 0xe8e8e8
    };
    
    // Get base color for the tile's biome
    let color = ColorMap[tile.c] || 0x000000; // Default to black if unknown biome
    // Update dynamic colors for forests and mountains
    if (tile.b === Biome.FOREST || tile.b === Biome.DENSE_FOREST) {
      color = this.getForestColor(tile);
    } else if (tile.b === Biome.MOUNTAIN) {
      color = this.getMountainColor(tile);
    }
    
    // Mix with elevation tint
    return this.mixColors(color, elevationTint, 0.7);
  }

   private getForestColor(tile: LandTile): number {
    // Vegetation density affects forest color
    const density = tile.v;
    const baseColors: Record<VegetationType, number> = {
      [VegetationType.GRASS]: 0x7CFC00,
      [VegetationType.SHRUB]: 0x6B8E23,
      [VegetationType.DECIDUOUS]: 0x228B22,
      [VegetationType.CONIFEROUS]: 0x2E8B57,
      [VegetationType.TROPICAL]: 0x006400,
      [VegetationType.CACTUS]: 0x8B4513,
      [VegetationType.TUNDRA_VEGETATION]: 0xD2B48C,
      [VegetationType.NONE]: 0
    };
    return this.darkenColor(baseColors[tile.vT], 1 - (density * 0.5));
  }

  private getMountainColor(tile: LandTile): number {
    // Rocky appearance with snow caps
    if (tile.t < 0) { // Below freezing
      return 0xFFFFFF; // Snow
    }
    return 0xA9A9A9; // Rock
  }

  // Color utility functions
  public darkenColor(color: number, factor: number): number {
    const r = Math.max(0, ((color >> 16) & 0xFF) * (1 - factor));
    const g = Math.max(0, ((color >> 8) & 0xFF) * (1 - factor));
    const b = Math.max(0, (color & 0xFF) * (1 - factor));
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

  private getElevationTint(elevation: number): number {
    // Higher elevations get more gray/rocky
    if (elevation > 0.8) return 0xAAAAAA;
    if (elevation > 0.6) return 0xCCCCCC;
    return 0xFFFFFF; // No tint
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
    this.playerPosition = { x, y };
    this.networkAdapter.send({ type: "move", x, y });
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
    const throttleTime = 100;

    return (
      currentChunkX !== this.lastPlayerChunkX ||
      currentChunkY !== this.lastPlayerChunkY ||
      (now - this.lastChunkCheck > throttleTime && this.pendingChunks.size === 0)
    );
  }

  public updateChunkTracking(): void {
    const chunkSize = CHUNK_SIZE * TILE_SIZE;
    this.lastPlayerChunkX = Math.floor(this.playerPosition.x / chunkSize);
    this.lastPlayerChunkY = Math.floor(this.playerPosition.y / chunkSize);
    this.lastChunkCheck = Date.now();
  }
}