import { parentPort } from 'worker_threads';
import { WorldGenerator } from '../world/WorldGenerator';
import { ChunkData } from '../models/Chunk';

// Initialize world generator with the same seed for consistency
const worldGenerator = new WorldGenerator(12345);

// Generate a chunk with realistic terrain
const generateChunk = (x: number, y: number): ChunkData => {
  // Generate detailed terrain data
  const terrain = worldGenerator.generateChunk(x, y, 10);

  let tiles = [];
  for (let row of terrain) {
    for (let point of row) {
      const h = Math.round(point.h * 100) / 100;
      const nH = Math.round(point.nH * 100) / 100;
      const t = Math.round(point.t * 100) / 100;
      const p = Math.round(point.p * 100) / 100;
      const stp = Math.round(point.stp * 100) / 100;
      const v = point.v ? Math.round(point.v * 100) / 100 : 0;
      tiles.push([
        point.x,
        point.y,
        h,
        nH,
        point.w ? 1 : 0,
        t,
        p,
        stp,
        point.b,
        point.c,
        point.iC ? 1 : 0,
        point.wT || 0,
        v,
        point.vT || 0,
        point.sT || 0
      ]);
    }
  }
  return { x, y, tiles, terrain };
};

// Listen for messages from the main thread
parentPort?.on('message', (data) => {
  const { x, y, requestId } = data;
  
  try {
    const chunk = generateChunk(x, y);
    parentPort?.postMessage({ 
      success: true, 
      chunk, 
      requestId 
    });
  } catch (error) {
    parentPort?.postMessage({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId 
    });
  }
});
