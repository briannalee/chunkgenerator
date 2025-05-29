import { TerrainPoint } from './TerrainTypes';
export declare class WorldGenerator {
    private noiseGen;
    private seaLevel;
    private heightCache;
    private temperatureCache;
    private precipitationCache;
    private readonly MAX_CACHE_SIZE;
    constructor(seed?: number);
    generateChunk(chunkX: number, chunkY: number, chunkSize?: number): TerrainPoint[][];
    private cacheHeight;
    private getCachedHeight;
    private batchGenerateHeights;
    private batchGenerateClimate;
    private generateTerrainPointFast;
    private manageCacheSize;
    private generateTerrainPoint;
    private assignTerrainProperties;
    private postProcessChunk;
}
