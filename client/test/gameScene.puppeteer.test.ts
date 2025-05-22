import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer from 'puppeteer';
import type { Browser, Page } from 'puppeteer';

const TEST_URL = 'http://localhost:5173';

describe('Phaser Game (Puppeteer)', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox'],
    });
    page = await browser.newPage();


    await page.goto(TEST_URL, { waitUntil: 'networkidle0' });

    await page.evaluate(() => {});

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


    // Define reasonable ranges (adjust based on your game's needs)
    const MAX_CHUNKS = 60;
    const MAX_PENDING_CHUNKS = 5;
    const MAX_TILES = 6000;
    const MAX_PLAYERS = 5;

    expect(finalStats.loadedChunks).toBeGreaterThan(0);
    expect(finalStats.loadedChunks).toBeLessThan(MAX_CHUNKS);

    expect(finalStats.pendingChunks).toBeLessThanOrEqual(MAX_PENDING_CHUNKS);

    expect(finalStats.tiles).toBeGreaterThan(0);
    expect(finalStats.tiles).toBeLessThan(MAX_TILES);

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
    await page.keyboard.down(move.key);
    await new Promise(resolve => setTimeout(resolve, move.duration));
    await page.keyboard.up(move.key);
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

  const MAX_CHUNKS = 60;
  const MAX_TILES = 6000;


  expect(finalStats.loadedChunks).toBeGreaterThan(0);
  expect(finalStats.loadedChunks).toBeLessThan(MAX_CHUNKS);
  
  expect(finalStats.pendingChunks).toBe(0); // All chunks should be loaded
  
  expect(finalStats.tiles).toBeGreaterThan(0);
  expect(finalStats.tiles).toBeLessThan(MAX_TILES);


  // 9. Debug output
  await page.evaluate(() => {
    const scene = window.game.scene.getScene('GameScene');
    scene.debugMemoryUsage();
  });
}, 15000); // 15 second timeout
});

