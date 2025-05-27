import { describe, it, expect, beforeEach } from 'vitest';
import { ChunkData, GameLogic, TileType, CHUNK_SIZE, MAX_PENDING_REQUESTS, TILE_SIZE} from '../src/logic/GameLogic';


describe('GameLogic', () => {
  let game: GameLogic;

  beforeEach(() => {
    game = new GameLogic();
    game.playerPosition = { x: 100, y: 100 };
    game.viewport = { width: 160, height: 160, zoom: 1 }; // Makes math easier
  });

  describe('getVisibleChunkKeys', () => {
    it('returns correct chunk keys in view with buffer', () => {
      const keys = game.getVisibleChunkKeys();
      expect(keys).toBeInstanceOf(Array);
      expect(keys.length).toBeGreaterThan(0);
    });
  });

  describe('chunksChanged', () => {
    it('detects when chunk list changes', () => {
      game.lastVisibleChunks = ['0,0', '1,0'];
      expect(game.chunksChanged(['0,0', '1,1'])).toBe(true);
    });

    it('detects when chunk list stays the same', () => {
      game.lastVisibleChunks = ['0,0', '1,0'];
      expect(game.chunksChanged(['1,0', '0,0'])).toBe(false);
    });
  });

  describe('checkPendingChunks', () => {
    it('returns chunks not loaded or pending', () => {
      const visible = game.getVisibleChunkKeys();
      const pending = game.checkPendingChunks();
      expect(pending.every(k => visible.includes(k))).toBe(true);
      expect(pending.length).toBeLessThanOrEqual(MAX_PENDING_REQUESTS);
    });
  });

  describe('addPendingChunks and unloadDistantChunks', () => {
    it('adds pending and determines distant chunks to unload', () => {
      const keys = ['5,5', '6,6'];
      game.addPendingChunks(keys);
      keys.forEach(k => expect(game.pendingChunks.has(k)).toBe(true));

      // Force some chunks to appear loaded and far away
      game.loadedChunks.add('99,99');
      const unload = game.unloadDistantChunks();
      expect(unload).toContain('99,99');
    });
  });

  describe('processChunkData', () => {
    it('adds chunk to loadedChunks and removes from pending', () => {
      const chunk: ChunkData = {
        x: 1,
        y: 1,
        tiles: [],
      };
      const key = `${chunk.x},${chunk.y}`;
      game.pendingChunks.add(key);
      const returnedKey = game.processChunkData(chunk);

      expect(game.loadedChunks.has(key)).toBe(true);
      expect(game.pendingChunks.has(key)).toBe(false);
      expect(game.chunks[key]).toEqual(chunk);
      expect(returnedKey).toBe(key);
    });
  });

  describe('getTileColor', () => {
    it('returns correct color for known tile types', () => {
      const cases: [TileType, number][] = [
        ['grass', 0x00ff00],
        ['rock', 0xaaaaaa],
        ['forest', 0x006600],
        ['water', 0x0000ff],
        ['desert', 0xffcc00],
      ];
      for (const [type, color] of cases) {
        expect(game.getTileColor(type)).toBe(color);
      }
    });

    it('returns default color for unknown tile type', () => {
      expect(game.getTileColor('unknown' as TileType)).toBe(0xffffff);
    });
  });

  describe('updatePlayers', () => {
    it('adds and removes players correctly', () => {
      game.playerId = 'self';
      game.players = {
        self: { x: 0, y: 0 },
        p1: { x: 1, y: 1 },
      };

      game.updatePlayers({
        self: { x: 0, y: 0 },
        p2: { x: 2, y: 2 },
      });

      expect(game.players['p1']).toBeUndefined();
      expect(game.players['p2']).toEqual({ x: 2, y: 2 });
    });
  });

  describe('getPerformanceStats and updateFrameTime', () => {
    it('computes frame stats correctly', () => {
      for (let i = 0; i < 10; i++) {
        game.updateFrameTime(i + 1);
      }
      const stats = game.getPerformanceStats();
      expect(stats.frameCount).toBe(10);
      expect(stats.averageFrameTime).toBeGreaterThan(0);
      expect(stats.maxFrameTime).toBe(10);
    });
  });

  describe('getMemoryStats', () => {
    it('returns current memory state', () => {
      game.loadedChunks.add('1,1');
      game.pendingChunks.add('2,2');
      game.players = {
        a: { x: 1, y: 1 },
        b: { x: 2, y: 2 },
      };
      const stats = game.getMemoryStats();
      expect(stats.loadedChunks).toBe(1);
      expect(stats.pendingChunks).toBe(1);
      expect(stats.players).toBe(2);
    });
  });

  describe('shouldUpdateChunks and updateChunkTracking', () => {
    it('determines if chunk update is needed and updates tracking', () => {
      expect(game.shouldUpdateChunks()).toBe(true);
      game.updateChunkTracking();
      expect(game.lastPlayerChunkX).toBe(Math.floor(game.playerPosition.x / (CHUNK_SIZE * TILE_SIZE)));
    });
  });
});