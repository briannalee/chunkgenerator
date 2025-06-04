import { TerrainPoint } from "../world/TerrainTypes";

export type ChunkData = {
  x: number;
  y: number;
  tiles: any[];
  terrain?: TerrainPoint[][];
};
