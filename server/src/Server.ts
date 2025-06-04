import express from "express";
import { WebSocketServer } from "ws";
import * as zlib from 'zlib';
import { createServer } from "http";
import dotenv from "dotenv";
import { ChunkData } from "./models/Chunk";
import { WorldGenerator } from "./world/WorldGenerator";
import { Worker } from "worker_threads";
import path from "path";

dotenv.config();

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});
const port = process.env.PORT || 15432;

// Worker pool for chunk generation
const WORKER_POOL_SIZE = 16;
const workers: Worker[] = [];
const pendingRequests = new Map<string, { resolve: Function, reject: Function, ws: any }>();
let requestCounter = 0;

// Chunk cache to avoid regenerating the same chunks
const chunkCache = new Map<string, ChunkData>();
const CACHE_SIZE_LIMIT = 1000; // Limit cache size to prevent memory issues

 // Initialize worker pool
for (let i = 0; i < WORKER_POOL_SIZE; i++) {
  const worker = new Worker(path.join(__dirname, 'workers', 'ChunkWorker.js'));
  
  worker.on('message', (data) => {
    const { success, chunk, error, requestId } = data;
    const request = pendingRequests.get(requestId);
    
    if (request) {
      pendingRequests.delete(requestId);
      if (success) {
        request.resolve(chunk);
      } else {
        request.reject(new Error(error));
      }
    }
  });
  
  worker.on('error', (error) => {
    console.error('Worker error:', error);
  });
  
  workers.push(worker);
}

// DB Worker
const dbWorker = new Worker(path.join(__dirname, 'workers', 'DBWorker.js'));
const dbPending = new Map<string, { resolve: Function, reject: Function }>();

dbWorker.on('message', (data) => {
  const { success, result, error, requestId } = data;
  const request = dbPending.get(requestId);
  
  if (request) {
    dbPending.delete(requestId);
    if (success) {
      request.resolve(result);
    } else {
      request.reject(new Error(error));
    }
  }
});

dbWorker.on('error', (error) => {
  console.error('DB Worker error:', error);
});

// Generate chunk using worker thread
const generateChunkAsync = (x: number, y: number, ws: any): Promise<ChunkData> => {
  return new Promise((resolve, reject) => {
    const requestId = `req_${++requestCounter}`;
    const worker = workers[requestCounter % workers.length];
    
    pendingRequests.set(requestId, { resolve, reject, ws });
    worker.postMessage({ x, y, requestId });
    
    // Reduced timeout for faster failure detection
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Chunk generation timeout'));
      }
    }, 10000); // Reduced from 30s to 10s
  });
};

// DB operations
const findChunkAsync = (x: number, y: number): Promise<ChunkData | null> => {
  return new Promise((resolve, reject) => {
    const requestId = `db_${++requestCounter}`;
    dbPending.set(requestId, { resolve, reject });
    dbWorker.postMessage({ type: 'find', x, y, requestId });
    
    setTimeout(() => {
      if (dbPending.has(requestId)) {
        dbPending.delete(requestId);
        reject(new Error('DB find timeout'));
      }
    }, 10000);
  });
};

const saveChunkAsync = (chunk: ChunkData): Promise<void> => {
  return new Promise((resolve, reject) => {
    const requestId = `db_${++requestCounter}`;
    dbPending.set(requestId, { resolve, reject });
    dbWorker.postMessage({ type: 'save', chunk, requestId });
    
    setTimeout(() => {
      if (dbPending.has(requestId)) {
        dbPending.delete(requestId);
        reject(new Error('DB save timeout'));
      }
    }, 10000);
  });
};

// Cache management functions
const getCachedChunk = (x: number, y: number): ChunkData | null => {
  const key = `${x},${y}`;
  return chunkCache.get(key) || null;
};

const setCachedChunk = (chunk: ChunkData): void => {
  const key = `${chunk.x},${chunk.y}`;
  
  // Manage cache size
  if (chunkCache.size >= CACHE_SIZE_LIMIT) {
    // Remove oldest entries (simple FIFO)
    const firstKey = chunkCache.keys().next().value;
    if (firstKey) {
      chunkCache.delete(firstKey);
    }
  }
  
  chunkCache.set(key, chunk);
};

// Shared player state
const players: Record<string, { x: number; y: number }> = {};

// WebSocket server setup
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: true });

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  players[id] = { x: 0, y: 0 };
  ws.send(JSON.stringify({ type: "connected", id, players }));

  ws.on("message", async (data) => {
    const message = JSON.parse(data.toString());
    await handleMessage(ws, message, id);
  });

  ws.on("close", () => {
    delete players[id];
    broadcastPlayerUpdate();
  });
});

// Shared message handling logic
async function handleMessage(
  ws: any,
  message: any,
  playerId: string
) {
  if (message.type === "requestChunk") {
    const { x, y } = message;
    if (typeof x !== "number" || typeof y !== "number" || isNaN(x) || isNaN(y)) {
      ws.send(JSON.stringify({ type: "error", message: "Invalid coordinates" }));
      return;
    }

    try {
      // Check memory cache first
      let chunk = getCachedChunk(x, y);
      
      if (!chunk) {
      // Check database
      chunk = await findChunkAsync(x, y);
      
      if (chunk) {
        // Cache the chunk from database
        setCachedChunk(chunk);
      } else {
        // Generate chunk using worker thread
        const generatedChunk = await generateChunkAsync(x, y, ws);
        await saveChunkAsync(generatedChunk);
        setCachedChunk(generatedChunk);
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
      console.error('Error generating chunk:', error);
      ws.send(JSON.stringify({ type: "error", message: "Failed to generate chunk" }));
    }
  } else if (message.type === "move") {
    const { x, y } = message;
    players[playerId] = { x, y };
    broadcastPlayerUpdate();
  } else if (message.type === "handshake") {
    // Handle handshake message
    ws.send(JSON.stringify({ type: "handshook", id: playerId, players }));
  } else {
    console.log("Unknown message type:", message);
  }
}

// Broadcast player updates to all connected clients
function broadcastPlayerUpdate() {
  const updateMessage = JSON.stringify({ type: "playerUpdate", players });

  // Broadcast to WebSocket clients
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(updateMessage);
    }
  });
}

// Start servers
httpServer.listen(port, () => {
  console.log(`HTTP/WebSocket server running on port ${port}`);
});
