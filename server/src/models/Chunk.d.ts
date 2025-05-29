import { TerrainPoint } from "../world/TerrainTypes.js";
export type ChunkData = {
    x: number;
    y: number;
    tiles: any[];
    terrain?: TerrainPoint[][];
};
export declare function findChunk(x: number, y: number): ChunkData | null;
export declare function saveChunk(chunk: ChunkData): void;
