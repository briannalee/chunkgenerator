import express from "express";
import { WebSocketServer } from "ws";
import * as zlib from 'zlib';
import { createServer } from "http";
import dotenv from "dotenv";
import { findChunk, saveChunk, ChunkData } from "./models/Chunk";
import { WorldGenerator } from "./world/WorldGenerator";

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

// Initialize world generator with a fixed seed for consistency
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

    let chunk = findChunk(x, y);
    if (!chunk) {
      const generatedChunk = generateChunk(x, y);
      saveChunk(generatedChunk);
      chunk = generatedChunk;
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
