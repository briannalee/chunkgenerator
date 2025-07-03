import { TerrainPoint } from "./TileTypes";

export type ChunkData = {
  x: number;
  y: number;
  tiles: any[];
  terrain?: TerrainPoint[][];
  mode?: 'chunk' | 'row' | 'column'; 
};