import express from "express";
import { WebSocketServer } from "ws";
import * as zlib from 'zlib';
import { createServer } from "http";
import dotenv from "dotenv";
import { ChunkData } from "./models/Chunk";
import { Worker } from "worker_threads";
import path from "path";
import Redis from 'ioredis';
import { Pool } from 'pg';

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

// Redis clients
const redis = new Redis(REDIS_URL);
const pubClient = new Redis(REDIS_URL);
const subClient = new Redis(REDIS_URL);

// Subscribe to player updates channel
subClient.subscribe('player_updates');
subClient.on('message', async (channel, message) => {
  if (channel === 'player_updates') {
    // Broadcast to all clients connected to THIS worker
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
  try {
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
      // Clear chunks table in debug mode
      await pgPool.query(`TRUNCATE TABLE chunks;`);
      console.warn('DEBUG MODE: chunks table truncated');

      // Clear Redis cache
      await clearRedis('*chunk*');
      await clearRedis('*player*');
      console.warn('DEBUG MODE: Redis cache cleared');
    }

    console.log('Database initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
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

// Redis cache operations
const CACHE_TTL = 3600; // 1 hour

async function getCachedChunk(x: number, y: number): Promise<ChunkData | null> {
  try {
    const key = `chunk:${x}:${y}`;
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
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

// Database operations with PostgreSQL
async function findChunkInDB(x: number, y: number): Promise<ChunkData | null> {
  try {
    const result = await pgPool.query(
      'SELECT tiles, terrain FROM chunks WHERE x = $1 AND y = $2',
      [x, y]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      x,
      y,
      tiles: row.tiles,
      terrain: row.terrain
    };
  } catch (error) {
    console.error('Database find error:', error);
    return null;
  }
}

async function saveChunkToDB(chunk: ChunkData): Promise<void> {
  try {
    await pgPool.query(
      `INSERT INTO chunks (x, y, tiles, terrain) 
       VALUES ($1, $2, $3, $4) 
       ON CONFLICT (x, y) DO UPDATE SET 
       tiles = EXCLUDED.tiles, 
       terrain = EXCLUDED.terrain`,
      [chunk.x, chunk.y, JSON.stringify(chunk.tiles), JSON.stringify(chunk.terrain)]
    );

    await redis.del(`chunk:${chunk.x}:${chunk.y}`);

    // 3. Notify all workers to clear local caches
    await pubClient.publish(
      'chunk_invalidate',
      JSON.stringify({ x: chunk.x, y: chunk.y })
    );
  } catch (error) {
    console.error('Database save error:', error);
    throw error;
  }
}

// Generate chunk using load-balanced worker
const generateChunkAsync = (x: number, y: number, ws: any): Promise<ChunkData> => {
  return new Promise((resolve, reject) => {
    const requestId = `req_${++requestCounter}`;
    const selectedWorker = selectWorker();

    // Increase worker load
    selectedWorker.load++;
    const startTime = Date.now();
    pendingRequests.set(requestId, { resolve, reject, ws, startTime });
    selectedWorker.worker.postMessage({ x, y, requestId });

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
    const { x, y } = message;
    if (typeof x !== "number" || typeof y !== "number" || isNaN(x) || isNaN(y)) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid coordinates" }));
      return;
    }

    try {
      // Check Redis cache first
      let chunk = await getCachedChunk(x, y);

      if (!chunk) {
        // Check PostgreSQL database
        chunk = await findChunkInDB(x, y);

        if (chunk) {
          // Cache the chunk from database
          await setCachedChunk(chunk);
        } else {
          // Generate chunk using load-balanced worker
          const generatedChunk = await generateChunkAsync(x, y, ws);
          await saveChunkToDB(generatedChunk);
          await setCachedChunk(generatedChunk);
          chunk = generatedChunk;
        }
      }

      const clientChunk = {
        x: chunk.x,
        y: chunk.y,
        tiles: chunk.tiles
      };

      const chunkResponse = { type: "chunkData", chunk: clientChunk };
      const chunkData = JSON.stringify(chunkResponse);
      zlib.gzip(chunkData, (err, compressed) => {
        if (!err) ws.send(compressed, { binary: true });
      });
    } catch (error) {
      console.error('Error processing chunk request:', error);
      ws.send(JSON.stringify({ type: "error", message: "Failed to generate chunk" }));
    }
  } else if (message.type === "move") {
    const { x, y } = message;
    await updatePlayerPosition(playerId, x, y);
    await broadcastPlayerUpdate();
  } else if (message.type === "handshake") {
    const players = await getAllPlayers();
    ws.send(JSON.stringify({ type: "handshook", id: playerId, players }));
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

// Subscribe to Redis for worker communication
subClient.subscribe(`worker_${process.pid}`);
subClient.on('message', async (channel, message) => {
  if (channel === `worker_${process.pid}`) {
    const request = JSON.parse(message);
    // Handle chunk generation request from cluster master
    // This would be implemented based on your specific clustering needs
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
