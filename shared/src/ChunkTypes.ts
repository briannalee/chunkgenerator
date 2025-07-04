import { ResourceNode } from "./ResourceTypes";
import { TerrainPoint } from "./TileTypes";

export type ChunkData = {
  x: number;
  y: number;
  tiles: any[];
  terrain?: TerrainPoint[][];
  mode?: 'chunk' | 'row' | 'column'; 
  resources?: Record<string, ResourceNode>;
};