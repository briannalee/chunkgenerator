import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import dotenv from "dotenv";
import { findChunk, saveChunk } from "./models/Chunk";
import { randomInt } from "crypto";

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


// Terrain types
const TERRAIN_TYPES = ["grass", "rock", "forest", "water", "desert"];

// Generate tiles for a chunk
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

// Shared player state
const players: Record<string, { x: number; y: number }> = {};

// WebSocket server setup
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  players[id] = { x: 0, y: 0 };
  ws.send(JSON.stringify({ type: "connected", id, players }));

  ws.on("message", async (data) => {
    const message = JSON.parse(data.toString());
    await handleMessage(message, id, (response) => {
      ws.send(JSON.stringify(response));
    });
  });

  ws.on("close", () => {
    delete players[id];
    broadcastPlayerUpdate();
  });
});

// Shared message handling logic
async function handleMessage(
  message: any,
  playerId: string,
  sendResponse: (response: any) => void
) {

  if (message.type === "requestChunk") {

    const { x, y } = message;
    if (typeof x !== "number" || typeof y !== "number" || isNaN(x) || isNaN(y)) {
      sendResponse({ type: "error", message: "Invalid coordinates" });
      return;
    }
    let chunk = findChunk(x, y);
    if (!chunk) {
      const generatedChunk = generateChunk(x, y);
      saveChunk(generatedChunk);
      chunk = generatedChunk;
    }
    sendResponse({ type: "chunkData", chunk });
  } else if (message.type === "move") {
    const { x, y } = message;
    players[playerId] = { x, y };
    broadcastPlayerUpdate();
  } else if (message.type === "handshake") {
    // Handle handshake message
    sendResponse({ type: "handshook", id: playerId, players });
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