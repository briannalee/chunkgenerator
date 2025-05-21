import express from "express";
import { WebSocketServer } from "ws";
import mongoose from "mongoose";
import dotenv from "dotenv";
import { Chunk } from "./models/Chunk";
import { randomInt } from "crypto";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/game");

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

// WebSocket server
const wss = new WebSocketServer({ noServer: true });
const players: Record<string, { x: number; y: number }> = {};

wss.on("connection", (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  players[id] = { x: 0, y: 0 };

  ws.send(JSON.stringify({ type: "connected", id, players }));
  console.log("Player connected:", id); 

  ws.on("message", async (data) => {
    
    const message = JSON.parse(data.toString());

    if (message.type === "requestChunk") {
      const { x, y } = message;
      let chunk = await Chunk.findOne({ x, y });
      if (!chunk) {
        const generatedChunk = generateChunk(x, y);
        chunk = new Chunk(generatedChunk);
        await chunk.save();
      }
      ws.send(JSON.stringify({ type: "chunkData", chunk }));
    } else if (message.type === "move") {

      const { x, y } = message;
      players[id] = { x, y };
      wss.clients.forEach((client) => {
        client.send(JSON.stringify({ type: "playerUpdate", players }));
      });
    }
  });

  ws.on("close", () => {
    delete players[id];
    wss.clients.forEach((client) => {
      client.send(JSON.stringify({ type: "playerUpdate", players }));
    });
  });
});

const server = app.listen(port, () => console.log(`Server running on port ${port}`));
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});