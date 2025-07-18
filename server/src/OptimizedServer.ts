import express from "express";
import { WebSocketServer } from "ws";
import * as zlib from 'zlib';
import { createServer } from "http";
import dotenv from "dotenv";
import { ChunkData } from "shared/ChunkTypes";
import { Worker } from "worker_threads";
import path from "path";
import Redis from 'ioredis';
import { Pool } from 'pg';
import { ResourceNode, ResourceType } from "shared/ResourceTypes";
import { TerrainPoint } from "shared/TileTypes";
dotenv.config();

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

const port = process.env.PORT || 15432;
const REDIS_DB = process.env.REDIS_DB || '3';
const REDIS_URL = process.env.REDIS_URL || `redis://localhost:6379/${REDIS_DB}`
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://chunkuser:chunkpass@localhost:5432/chunkgame';
const DEBUG_MODE = process.env.DEBUG_MODE || false;

// Tracks ongoing chunk generation promises by chunk key "x,y"
const inProgressChunks = new Map<string, Promise<ChunkData>>();

// Redis clients
const redis = new Redis(REDIS_URL);
const pubClient = new Redis(REDIS_URL);
const subClient = new Redis(REDIS_URL);

// Subscribe to player updates channel
subClient.subscribe('player_updates');
subClient.subscribe('chunk_invalidate');
subClient.on('message', async (channel, message) => {
  if (channel === 'chunk_invalidate') {
    const { x, y } = JSON.parse(message);
    await redis.del(`chunk:${x}:${y}`);
    if (DEBUG_MODE) {
      console.log(`Invalidated chunk (${x}, ${y}) from pub-sub`);
    }
  }

  if (channel === 'player_updates') {
    await broadcastPlayerUpdate();
  }
});


// PostgreSQL connection pool
const pgPool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize database schema
async function initDatabase() {
  const maxAttempts = 10;
  const delayMs = 1000;
  let attempt = 0;

  while (attempt < maxAttempts) {
    try {
      attempt++;

      // Just a quick connection test
      await pgPool.query('SELECT 1');

      // Now run actual schema setup
      await pgPool.query(`
        CREATE TABLE IF NOT EXISTS chunks (
          x INTEGER NOT NULL,
          y INTEGER NOT NULL,
          tiles JSONB NOT NULL,
          terrain JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (x, y)
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_coords ON chunks(x, y);
      `);

      if (DEBUG_MODE) {
        await pgPool.query(`TRUNCATE TABLE chunks;`);
        console.warn('DEBUG MODE: chunks table truncated');

        await clearRedis('*chunk*');
        await clearRedis('*player*');
        console.warn('DEBUG MODE: Redis cache cleared');
      }

      console.log('Database initialized');
      return; // success, exit early

    } catch (error) {
      if (attempt >= maxAttempts) {
        console.error('Database initialization failed after retries:', error);
        process.exit(1); // fail hard
      }

      const errorMsg = (error && typeof error === 'object' && 'message' in error) ? (error as any).message : String(error);
      console.warn(`Database init failed (attempt ${attempt}): ${errorMsg}`);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

initDatabase();

// Worker pool with load balancing
type PendingRequest = {
  resolve: (value: ChunkData | PromiseLike<ChunkData>) => void;
  reject: (reason?: any) => void;
  ws: any;
  startTime: number;
};
const WORKER_POOL_SIZE = 8;
const workers: { worker: Worker, load: number, pid: number }[] = [];
const pendingRequests = new Map<string, PendingRequest>();
let requestCounter = 0;

// Pending Requests Cleanup
setInterval(() => {
  const now = Date.now();
  pendingRequests.forEach((req, id) => {
    if (now - req.startTime > 15000) { // 15s timeout
      pendingRequests.delete(id);
      req.reject(new Error('Chunk generation timeout (15s exceeded)'));
      console.warn(`Request ${id} timed out`);
    }
  });
}, 5000); // Check every 5 seconds

// Initialize worker pool
for (let i = 0; i < WORKER_POOL_SIZE; i++) {
  const worker = new Worker(path.join(__dirname, 'workers', 'OptimizedChunkWorker.js'));
  const workerInfo = { worker, load: 0, pid: worker.threadId };

  worker.on('message', (data) => {
    const { success, chunk, error, requestId } = data;
    const request = pendingRequests.get(requestId);

    if (request) {
      pendingRequests.delete(requestId);
      // Decrease worker load
      workerInfo.load = Math.max(0, workerInfo.load - 1);

      if (success) {
        request.resolve(chunk);
      } else {
        request.reject(new Error(error));
      }
    }
  });

  worker.on('error', (error) => {
    console.error('Worker error:', error);
    workerInfo.load = Math.max(0, workerInfo.load - 1);
  });

  workers.push(workerInfo);
}

// Load balancing: select worker with lowest load
function selectWorker() {
  return workers.reduce((min, current) =>
    current.load < min.load ? current : min
  );
}

async function getOrGenerateChunk(x: number, y: number, mode: string): Promise<ChunkData> {
  if (mode !== 'chunk') {
    // For rows/columns, just generate directly (no concurrency cache)
    return generateChunkAsync(x, y, mode, null);
  }

  const key = `${x},${y}`;

  if (inProgressChunks.has(key)) {
    return inProgressChunks.get(key)!;
  }

  const generationPromise = (async () => {
    try {
      // Check Redis cache first
      let chunk = null;//await getCachedChunk(x, y);

      if (!chunk) {
        // Check DB
        chunk = null;//await findChunkInDB(x, y);
      }

      if (!chunk) {
        // Generate new chunk, save it to DB and cache
        chunk = await generateChunkAsync(x, y, mode, null);
        await saveChunkToDB(chunk);
        await setCachedChunk(chunk);
      }

      return chunk;
    } finally {
      inProgressChunks.delete(key);
    }
  })();

  inProgressChunks.set(key, generationPromise);
  return generationPromise;
}

// Redis cache operations
const CACHE_TTL = 3600; // 1 hour

async function getCachedChunk(x: number, y: number): Promise<ChunkData | null> {
  try {
    const key = `chunk:${x}:${y}`;
    const cached = await redis.get(key);
    if (!cached) return null;

    const parsed = JSON.parse(cached);
    if (!parsed.resources && parsed.terrain) {
      parsed.resources = extractResourcesFromTerrain(parsed.terrain);
    }

    return parsed;
  } catch (error) {
    console.error('Redis get error:', error);
    return null;
  }
}

async function setCachedChunk(chunk: ChunkData): Promise<void> {
  try {
    const key = `chunk:${chunk.x}:${chunk.y}`;
    await redis.setex(key, CACHE_TTL, JSON.stringify(chunk));
  } catch (error) {
    console.error('Redis set error:', error);
  }
}

function extractResourcesFromTerrain(terrain: TerrainPoint[][]): Record<string, ResourceNode> {
  const resources: Record<string, ResourceNode> = {};
  for (let row of terrain) {
    for (let point of row) {
      if (point.r) {
        resources[`${point.x},${point.y}`] = point.r;
      }
    }
  }
  return resources;
}

// Database operations with PostgreSQL
async function findChunkInDB(x: number, y: number): Promise<ChunkData | null> {
  try {
    const result = await pgPool.query(
      'SELECT tiles, terrain FROM chunks WHERE x = $1 AND y = $2',
      [x, y]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const terrain = row.terrain;

    return {
      x,
      y,
      tiles: row.tiles,
      terrain,
      mode: 'chunk',
      resources: extractResourcesFromTerrain(terrain),
    };
  } catch (error) {
    console.error('Database find error:', error);
    return null;
  }
}

async function saveChunkToDB(chunk: ChunkData): Promise<void> {
  const key = `chunk:${chunk.x}:${chunk.y}`;
  let existed = false;

  try {
    const cached = await redis.exists(key);
    if (cached) {
      existed = true;
    } else {
      const dbChunk = await findChunkInDB(chunk.x, chunk.y);
      if (dbChunk) existed = true;
    }

    await pgPool.query(
      `INSERT INTO chunks (x, y, tiles, terrain) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (x, y) DO UPDATE SET 
       tiles = EXCLUDED.tiles, 
       terrain = EXCLUDED.terrain`,
      [chunk.x, chunk.y, JSON.stringify(chunk.tiles), JSON.stringify(chunk.terrain)]
    );

    await redis.del(key);

    if (existed) {
      // Notify workers to clear their local caches
      await pubClient.publish(
        'chunk_invalidate',
        JSON.stringify({ x: chunk.x, y: chunk.y })
      );
    }
  } catch (error) {
    console.error('Database save error:', error);
    throw error;
  }
}

// Generate chunk using load-balanced worker
const generateChunkAsync = (x: number, y: number, mode: string, ws: any): Promise<ChunkData> => {
  return new Promise((resolve, reject) => {
    const requestId = `req_${++requestCounter}`;
    const selectedWorker = selectWorker();

    // Increase worker load
    selectedWorker.load++;
    const startTime = Date.now();
    pendingRequests.set(requestId, { resolve, reject, ws, startTime });
    selectedWorker.worker.postMessage({ x, y, mode, requestId });

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        selectedWorker.load = Math.max(0, selectedWorker.load - 1);
        reject(new Error('Chunk generation timeout'));
      }
    }, 15000);
  });
};

// Shared player state in Redis
async function updatePlayerPosition(playerId: string, x: number, y: number) {
  try {
    await redis.hset('players', playerId, JSON.stringify({ x, y }));
    await redis.expire('players', 3600);
    // Publish the update to all workers
    await pubClient.publish('player_updates', JSON.stringify({ playerId, x, y }));
  } catch (error) {
    console.error('Redis player update error:', error);
  }
}

async function clearRedis(prefix = 'worker_chunk:') {
  let cursor = '0';
  let totalDeleted = 0;

  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
      totalDeleted += keys.length;
    }
  } while (cursor !== '0');

  console.log(`Deleted ${totalDeleted} Redis keys with prefix "${prefix}"`);
}

async function getAllPlayers(): Promise<Record<string, { x: number; y: number }>> {
  try {
    const players = await redis.hgetall('players');
    const result: Record<string, { x: number; y: number }> = {};

    for (const [id, data] of Object.entries(players)) {
      result[id] = JSON.parse(data);
    }

    return result;
  } catch (error) {
    console.error('Redis get players error:', error);
    return {};
  }
}

async function removePlayer(playerId: string) {
  try {
    await redis.hdel('players', playerId);
  } catch (error) {
    console.error('Redis remove player error:', error);
  }
}

// WebSocket server setup
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: true });

wss.on("connection", async (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  await updatePlayerPosition(id, 0, 0);

  const players = await getAllPlayers();
  ws.send(JSON.stringify({ type: "connected", id, players }));

  ws.on("message", async (data) => {
    const message = JSON.parse(data.toString());
    await handleMessage(ws, message, id);
  });

  ws.on("close", async () => {
    await removePlayer(id);
    await broadcastPlayerUpdate();
  });
});

// Message handling with optimized caching
async function handleMessage(ws: any, message: any, playerId: string) {
  if (message.type === "requestChunk") {
    const { x, y, mode = "chunk" } = message;

    const validCoords = typeof x === "number" && typeof y === "number" && !isNaN(x) && !isNaN(y);
    const validMode = mode === "chunk" || mode === "row" || mode === "column" || mode === "point";

    if (!validCoords || !validMode) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid request parameters" }));
      return;
    }

    try {
      const chunk = await getOrGenerateChunk(x, y, mode);

      const clientChunk = {
        x: chunk.x,
        y: chunk.y,
        tiles: chunk.tiles,
        mode: chunk.mode,
        resources: chunk.resources
      };

      const chunkResponse = { type: "chunkData", chunk: clientChunk };
      const chunkData = JSON.stringify(chunkResponse);
      zlib.gzip(chunkData, (err, compressed) => {
        if (!err) ws.send(compressed, { binary: true });
      });
    } catch (error) {
      console.error("Error processing chunk request:", error);
      ws.send(JSON.stringify({ type: "error", message: "Failed to process chunk request" }));
    }
  } else if (message.type === "move") {
    const { x, y } = message;
    await updatePlayerPosition(playerId, x, y);
    await broadcastPlayerUpdate();
  } else if (message.type === "handshake") {
    const players = await getAllPlayers();
    ws.send(JSON.stringify({ type: "handshook", id: playerId, players }));
  } else if (message.type === "mining") {
    const { x, y, tool } = message;
    const result = await handleMining(playerId, x, y, tool);

    if (result.success) {
      ws.send(JSON.stringify({
        type: "miningSuccess",
        resource: result.resource,
        amount: result.amount,
        x,
        y
      }));

      // Broadcast update to nearby players and invalidate chunk
      const chunkX = Math.floor(x / 10);
      const chunkY = Math.floor(y / 10);

      await pubClient.publish(
        'chunk_invalidate',
        JSON.stringify({ x: chunkX, y: chunkY })
      );

      broadcastChunkUpdate(chunkX, chunkY);
    } else {
      ws.send(JSON.stringify({
        type: "miningFailed",
        x,
        y
      }));
    }
  }
}


// Broadcast player updates
async function broadcastPlayerUpdate() {
  try {
    const players = await getAllPlayers();
    const updateMessage = JSON.stringify({ type: "playerUpdate", players });

    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(updateMessage);
      }
    });
  } catch (error) {
    console.error('Error broadcasting player update:', error);
  }
}

// Resource management
async function handleMining(playerId: string, x: number, y: number, tool: string): Promise<{ success: boolean, resource?: ResourceType, amount?: number }> {
  try {
    // Get the chunk containing this position
    const chunkSize = 10;
    const chunkX = Math.floor(x / chunkSize);
    const chunkY = Math.floor(y / chunkSize);

    // Get the chunk data
    let chunk = await getCachedChunk(chunkX, chunkY);
    if (!chunk) {
      chunk = await findChunkInDB(chunkX, chunkY);
      if (!chunk) {
        return { success: false };
      }
    }

    // Find the specific tile
    const mod = (n: number, m: number) => ((n % m) + m) % m;

    const tileX = mod(x, chunkSize);
    const tileY = mod(y, chunkSize);

    let tile;
    if (chunk.terrain) {
      tile = chunk.terrain[tileY][tileX];
    } else {
      return { success: false };
    }

    if (!tile || !tile.r) {
      return { success: false };
    }

    const resource = tile.r; // Get first resource
    if (resource.remaining <= 0) {
      return { success: false };
    }

    // Calculate mining efficiency
    const toolEfficiency = {
      hand: 0.2,
      pickaxe: 0.6,
      drill: 0.9
    }[tool] || 0.2;

    const efficiency = Math.max(0.1, toolEfficiency - resource.hardness);
    const minedAmount = Math.max(1, Math.floor(resource.remaining * efficiency * 0.1));

    // Update resource
    resource.remaining = Math.max(0, resource.remaining - minedAmount);

    // Update the chunk in database and cache
    await saveChunkToDB(chunk);

    return {
      success: true,
      resource: resource.type,
      amount: minedAmount
    };
  } catch (error) {
    console.error('Mining error:', error);
    return { success: false };
  }
}

// Helper for async compression
function compressAsync(data: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zlib.gzip(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}


// Broadcast chunk updates
async function broadcastChunkUpdate(chunkX: number, chunkY: number) {
  try {
    // Try cache first, then database
    let chunk = await getCachedChunk(chunkX, chunkY);
    if (!chunk) {
      chunk = await findChunkInDB(chunkX, chunkY);
      if (!chunk) {
        if (DEBUG_MODE) console.warn(`Chunk ${chunkX},${chunkY} not found`);
        return;
      }
      // Cache the chunk for future use
      await setCachedChunk(chunk);
    }

    // Prepare minimal client data
    const clientChunk = {
      x: chunk.x,
      y: chunk.y,
      tiles: chunk.tiles,
      mode: chunk.mode
    };

    // Compress the payload
    const updateMessage = JSON.stringify({
      type: "chunkUpdate",
      chunk: clientChunk
    });

    // Broadcast efficiently
    const compressed = await compressAsync(updateMessage);
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(compressed);
      }
    });

  } catch (error) {
    console.error('Error broadcasting chunk update:', error);
  }
}

// Subscribe to Redis for worker communication
subClient.subscribe(`worker_${process.pid}`);
subClient.on('message', async (channel, message) => {
  if (channel === `worker_${process.pid}`) {
    const request = JSON.parse(message);
    // TODO: Handle worker-specific messages if needed
  }
});

// Report load to cluster master
setInterval(() => {
  if (process.send) {
    const totalLoad = workers.reduce((sum, w) => sum + w.load, 0);
    process.send({ type: 'load_update', load: totalLoad });
  }
}, 1000);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await pgPool.end();
  await redis.quit();
  await pubClient.quit();
  await subClient.quit();
  process.exit(0);
});

// Start server
httpServer.listen(port, () => {
  console.log(`Optimized server running on port ${port} (PID: ${process.pid})`);
});