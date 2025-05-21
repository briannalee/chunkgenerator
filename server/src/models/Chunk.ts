
import mongoose from "mongoose";

export const TileSchema = new mongoose.Schema({
  x: Number,
  y: Number,
  type: String,
});

export const ChunkSchema = new mongoose.Schema({
  x: Number,
  y: Number,
  tiles: [TileSchema],
});

export const Chunk = mongoose.model("Chunk", ChunkSchema);
