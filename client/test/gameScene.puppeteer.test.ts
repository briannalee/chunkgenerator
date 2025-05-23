import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';

// Extend the Window interface to include 'game'
declare global {
  interface Window {
    game: any;
  }
}

const TEST_URL = 'http://localhost:5173';

describe('Phaser Game (Puppeteer)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
    });
    page = await browser.newPage();


    await page.goto(TEST_URL, { waitUntil: 'networkidle0' });

    await page.evaluate(() => { });

    await page.waitForFunction(() => window.game?.isBooted, { timeout: 10000 });
  });

  afterAll(async () => {
    await page.close();
    await browser.close();
  });

  const debugScene = async () => {
    return await page.evaluate(() => {
      try {
        const scene = window.game.scene.getScene('GameScene');
        return scene;
      } catch (e) {
        return null;
      }
    });
  };

  it('should load the game', async () => {
    const title = await page.title();
    expect(title).to.equal('Game');
  });

  it('should initialize player rectangle', async () => {
    await debugScene(); // Debug before test

    const playerInfo = await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      return {
        exists: !!scene?.player,
        type: scene?.player?.constructor?.name,
        position: scene?.player ? {
          x: scene.player.x,
          y: scene.player.y
        } : null
      };
    });

    expect(playerInfo.exists).toBe(true);
    expect(playerInfo.type).toBe('Rectangle2');
  });

  it('should maintain reasonable memory usage', async () => {
    // Get initial stats
    const initialStats = await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      return scene.getMemoryStats();
    });


    await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');

      scene.player.x += 500;
      scene.updateVisibleChunks();
    });

    // Wait for changes to take effect
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get final stats
    const finalStats = await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      return scene.getMemoryStats();
    });

    // Given a window size of 1920x1080 (set via puppeteer), a chunk size of 10x10 tiles,
    // and a tile size of 8px, the maximum number of chunks is about 175 + buffer:
    const MAX_CHUNKS = 200;
    const MAX_TILES = MAX_CHUNKS * 100; // 10x10 tiles per chunk
    const MAX_PENDING_CHUNKS = 5;
    const MAX_PLAYERS = 5;

    expect(finalStats.loadedChunks).toBeGreaterThan(0);
    expect(finalStats.loadedChunks).toBeLessThan(MAX_CHUNKS);

    expect(finalStats.pendingChunks).toBeLessThanOrEqual(MAX_PENDING_CHUNKS);

    expect(finalStats.tiles).toBeGreaterThan(0);
    expect(finalStats.tiles).toBeLessThanOrEqual(MAX_TILES);
    expect(finalStats.tiles).toEqual(finalStats.loadedChunks * 100); // 10x10 tiles per chunk

    expect(finalStats.players).toBeGreaterThanOrEqual(0);
    expect(finalStats.players).toBeLessThan(MAX_PLAYERS);

    // Verify memory management works (chunks should load/unload)
    if (initialStats.loadedChunks > 0) {
      expect(finalStats.loadedChunks).not.toBe(initialStats.loadedChunks);
    }
  }, 10000);

  it('should maintain memory usage after large player movement', async () => {

    const initialStats = await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      return scene.getMemoryStats();
    });
    console.log('Initial memory:', initialStats);


    const movements = [
      { key: 'ArrowRight', duration: 5000 }, // Right
      { key: 'ArrowDown', duration: 1000 },  // Down
      { key: 'ArrowLeft', duration: 1000 },  // Left
      { key: 'ArrowUp', duration: 1000 }    // Up
    ];


    for (const move of movements) {
      await page.keyboard.down(move.key as any);
      await new Promise(resolve => setTimeout(resolve, move.duration));
      await page.keyboard.up(move.key as any);
      console.log(`Moved ${move.key} for ${move.duration}ms`);

      await new Promise(resolve => setTimeout(resolve, 200));
    }


    await page.waitForFunction(() => {
      const scene = window.game.scene.getScene('GameScene');
      return scene.pendingChunks.size === 0;
    }, { timeout: 5000 });


    const finalStats = await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      return scene.getMemoryStats();
    });
    console.log('Final memory:', finalStats);

    // Given a window size of 1920x1080 (set via puppeteer), a chunk size of 10x10 tiles,
    // and a tile size of 8px, the maximum number of chunks is about 175 + buffer:
    const MAX_CHUNKS = 200;
    const MAX_TILES = MAX_CHUNKS * 100; // 10x10 tiles per chunk


    expect(finalStats.loadedChunks).toBeGreaterThan(0);
    expect(finalStats.loadedChunks).toBeLessThanOrEqual(MAX_CHUNKS);

    expect(finalStats.pendingChunks).toBe(0); // All chunks should be loaded

    expect(finalStats.tiles).toBeGreaterThan(0);
    expect(finalStats.tiles).toBeLessThanOrEqual(MAX_TILES);

    expect(finalStats.tiles).toEqual(finalStats.loadedChunks * 100); // 10x10 tiles per chunk

    await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      scene.debugMemoryUsage();
    });
  }, 15000);

  it('should maintain consistent frame timing during movement', async () => {
    // Reset performance tracking
    await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      if (scene) {
        scene.getPerformanceStats(); // This clears the buffer if needed
      }
    });

    // Perform movement
    const movements = [
      { key: 'ArrowRight', duration: 3000 },
      { key: 'ArrowDown', duration: 2000 },
      { key: 'ArrowLeft', duration: 3000 },
      { key: 'ArrowUp', duration: 2000 }
    ];

    for (const move of movements) {
      await page.keyboard.down(move.key as any);
      await new Promise(resolve => setTimeout(resolve, move.duration));
      await page.keyboard.up(move.key as any);
    }



    // Wait briefly for final frames
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get performance data
    const perfData = await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      return scene?.getPerformanceStats?.() || null;
    });

    if (!perfData) {
      throw new Error('Performance data not available - ensure getPerformanceStats() exists in GameScene');
    }

    console.log('Performance Data:', {
      framesTracked: perfData.frameCount,
      avgFrameTime: `${perfData.averageFrameTime.toFixed(2)}ms`,
      maxFrameTime: `${perfData.maxFrameTime.toFixed(2)}ms`,
      fps: perfData.averageFrameTime > 0 ? Math.round(1000 / perfData.averageFrameTime) : 0
    });

    // Performance assertions
    expect(perfData.frameCount).toBeGreaterThan(50);
    expect(perfData.averageFrameTime).toBeLessThan(25);
    expect(perfData.maxFrameTime).toBeLessThan(perfData.averageFrameTime * 1.5); // No frames greater than 20% of average
  }, 20000);

  it('should correlate memory and performance', async () => {
    // Reset trackers
    await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      scene?.getPerformanceStats(); // Resets counters
    });

    // Stress movement
    await page.keyboard.down('ArrowRight' as any);
    await new Promise(resolve => setTimeout(resolve, 10000));
    await page.keyboard.up('ArrowRight' as any);

    // Get combined data
    const results = await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      if (!scene) return null;

      return {
        perf: scene.getPerformanceStats(),
        memory: scene.getMemoryStats()
      };
    });

    if (!results) {
      throw new Error('Could not retrieve performance data');
    }

    console.log('Memory vs Performance:', {
      chunks: results.memory.loadedChunks,
      avgFrameTime: results.perf.averageFrameTime.toFixed(2),
      maxFrameTime: results.perf.maxFrameTime.toFixed(2)
    });

    // Assert no linear degradation
    const frameTimePerChunk = results.perf.averageFrameTime / Math.max(1, results.memory.loadedChunks);
    expect(frameTimePerChunk).toBeLessThan(1.5); // ms per chunk
  }, 25000);

  it('should handle diagonal movement without performance issues', async () => {
    // Reset performance tracking
    await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      scene?.getPerformanceStats(); // Resets counters
    });

    // Define movement combinations
    const diagonalMovements = [
      { keys: ['ArrowRight', 'ArrowUp'], duration: 3000 }, // NE
      { keys: ['ArrowRight', 'ArrowDown'], duration: 3000 }, // SE
      { keys: ['ArrowLeft', 'ArrowDown'], duration: 3000 }, // SW
      { keys: ['ArrowLeft', 'ArrowUp'], duration: 3000 } // NW
    ];

    // Execute diagonal movements
    for (const move of diagonalMovements) {
      console.log(`Moving ${move.keys.join('+')} for ${move.duration}ms`);

      // Press both keys simultaneously
      await Promise.all(move.keys.map(key => page.keyboard.down(key as any)));

      // Wait while keys are held
      await new Promise(resolve => setTimeout(resolve, move.duration));

      // Release both keys
      await Promise.all(move.keys.map(key => page.keyboard.up(key as any)));

      // Brief pause between movements
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Get performance data
    const perfData = await page.evaluate(() => {
      const scene = window.game.scene.getScene('GameScene');
      return scene?.getPerformanceStats?.() || null;
    });

    if (!perfData) {
      throw new Error('Performance data not available');
    }

    console.log('Diagonal Movement Performance:', {
      avgFrameTime: `${perfData.averageFrameTime.toFixed(2)}ms`,
      maxFrameTime: `${perfData.maxFrameTime.toFixed(2)}ms`,
      fps: Math.round(1000 / perfData.averageFrameTime),
    });

    // Assertions
    expect(perfData.averageFrameTime).toBeLessThan(25); // <25ms avg
    expect(perfData.maxFrameTime).toBeLessThan(perfData.averageFrameTime * 1.5); // No frames greater than 20% of average
    expect(perfData.frameCount).toBeGreaterThan(50); // Enough frames tracked
  }, 20000);
});

