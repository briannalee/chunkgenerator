import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import dotenv from "dotenv";
import { findChunk, saveChunk } from "./models/Chunk";
import { randomInt } from "crypto";
import * as zlib from "zlib";

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

const port = process.env.PORT || 8080;

// Terrain types with numeric IDs for compression
const TERRAIN_TYPES = ["grass", "rock", "forest", "water", "desert"];
const TERRAIN_ID_MAP = TERRAIN_TYPES.reduce((map, type, index) => {
  map[type] = index;
  return map;
}, {} as Record<string, number>);

// Generate tiles for a chunk with compression-friendly format
const generateChunk = (x: number, y: number) => {
  const tiles = [];
  for (let i = 0; i < 10; i++) {
    for (let j = 0; j < 10; j++) {
      const tileType = TERRAIN_TYPES[randomInt(0, TERRAIN_TYPES.length)];
      tiles.push({ x: i, y: j, type: tileType });
    }
  }
  return { x, y, tiles };
};

// Compress chunk data using run-length encoding + gzip
const compressChunkData = (chunk: any): Buffer => {
  // Convert to more compact format
  const compactChunk = {
    x: chunk.x,
    y: chunk.y,
    // Convert tiles to compact array: [x, y, typeId, x, y, typeId, ...]
    tiles: chunk.tiles.flatMap((tile: any) => [
      tile.x,
      tile.y, 
      TERRAIN_ID_MAP[tile.type]
    ])
  };

  const jsonString = JSON.stringify(compactChunk);
  return zlib.gzipSync(jsonString);
};

// Alternative: Even more compact bit-packed format for maximum compression
const bitPackChunkData = (chunk: any): Buffer => {
  // For 10x10 chunks, we can pack each tile into fewer bits
  // x,y: 4 bits each (0-9), type: 3 bits (0-4 terrain types)
  // Total: 11 bits per tile, but we'll use 16 bits (2 bytes) for simplicity
  
  const buffer = Buffer.alloc(4 + 10 * 10 * 2); // 4 bytes for x,y coords + 200 bytes for tiles
  let offset = 0;
  
  // Write chunk coordinates
  buffer.writeInt16LE(chunk.x, offset);
  offset += 2;
  buffer.writeInt16LE(chunk.y, offset);
  offset += 2;
  
  // Write tiles in row-major order (implicit x,y from position)
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      const tile = chunk.tiles.find((t: any) => t.x === x && t.y === y);
      const typeId = tile ? TERRAIN_ID_MAP[tile.type] : 0;
      
      // Pack x(4), y(4), type(3) into 16 bits with padding
      const packed = (x << 12) | (y << 8) | (typeId << 5);
      buffer.writeUInt16LE(packed, offset);
      offset += 2;
    }
  }
  
  return zlib.gzipSync(buffer);
};

// Shared player state
const players: Record<string, { x: number; y: number }> = {};

// Create HTTP server first
const httpServer = createServer(app);

// WebSocket server setup with compression
const wss = new WebSocketServer({ 
  server: httpServer,
  perMessageDeflate: {
    // Enable per-message compression
    zlibDeflateOptions: {
      level: zlib.constants.Z_BEST_SPEED, // Prioritize speed over compression ratio
      windowBits: 13, // Reduce memory usage
    },
  }
});

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  players[id] = { x: 0, y: 0 };
  
  // Send initial connection with player data
  ws.send(JSON.stringify({ type: "connected", id, players }));
  console.log("WebSocket player connected:", id);

  ws.on("message", async (data) => {
    const message = JSON.parse(data.toString());
    await handleMessage(message, id, ws);
  });

  ws.on("close", () => {
    delete players[id];
    broadcastPlayerUpdate();
    console.log("WebSocket player disconnected:", id);
  });
});

// Enhanced message handling with compression
async function handleMessage(
  message: any,
  playerId: string,
  ws: any
) {
  if (message.type === "requestChunk") {
    const { x, y } = message;
    let chunk = findChunk(x, y);
    
    if (!chunk) {
      const generatedChunk = generateChunk(x, y);
      saveChunk(generatedChunk);
      chunk = generatedChunk;
    }

    // Choose compression method based on message size preference
    const useAdvancedCompression = message.compression === 'advanced';
    
    if (useAdvancedCompression) {
      // Send binary compressed data
      const compressedData = bitPackChunkData(chunk);
      ws.send(JSON.stringify({
        type: "chunkDataCompressed",
        compression: "bitpack+gzip",
        x: chunk.x,
        y: chunk.y,
        size: compressedData.length
      }));
      ws.send(compressedData);
    } else {
      // Send JSON compressed data (relies on WebSocket per-message deflate)
      const compactChunk = {
        x: chunk.x,
        y: chunk.y,
        // Use terrain IDs instead of strings
        tiles: chunk.tiles.map((tile: any) => [
          tile.x,
          tile.y,
          TERRAIN_ID_MAP[tile.type]
        ])
      };
      
      ws.send(JSON.stringify({ 
        type: "chunkData", 
        chunk: compactChunk,
        terrainTypes: TERRAIN_TYPES // Send mapping once
      }));
    }
    
  } else if (message.type === "move") {
    const { x, y } = message;
    players[playerId] = { x, y };
    broadcastPlayerUpdate();
  } else {
    console.log("Unknown message type:", message);
  }
}

// Optimized player updates with delta compression
let lastPlayerState: Record<string, { x: number; y: number }> = {};

function broadcastPlayerUpdate() {
  // Only send players that have actually changed
  const changedPlayers: Record<string, { x: number; y: number }> = {};
  let hasChanges = false;

  for (const [id, pos] of Object.entries(players)) {
    const lastPos = lastPlayerState[id];
    if (!lastPos || lastPos.x !== pos.x || lastPos.y !== pos.y) {
      changedPlayers[id] = pos;
      hasChanges = true;
    }
  }

  // Handle removed players
  for (const id of Object.keys(lastPlayerState)) {
    if (!players[id]) {
      changedPlayers[id] = null as any; // Mark as removed
      hasChanges = true;
    }
  }

  if (hasChanges) {
    const updateMessage = JSON.stringify({ 
      type: "playerUpdate", 
      players: changedPlayers,
      delta: true // Indicate this is a delta update
    });

    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(updateMessage);
      }
    });

    // Update last state
    lastPlayerState = { ...players };
  }
}

// Start server
httpServer.listen(port, () => {
  console.log(`HTTP/WebSocket server running on port ${port} with compression enabled`);
});
