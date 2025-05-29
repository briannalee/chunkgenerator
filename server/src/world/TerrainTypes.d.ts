export declare enum Biome {
    OCEAN_DEEP = 0,
    OCEAN_SHALLOW = 1,
    BEACH = 2,
    GRASSLAND = 3,
    FOREST = 4,
    DENSE_FOREST = 5,
    JUNGLE = 6,
    SAVANNA = 7,
    DESERT = 8,
    TUNDRA = 9,
    SNOW = 10,
    MOUNTAIN = 11,
    MOUNTAIN_SNOW = 12,
    CLIFF = 13,
    RIVER = 14,
    LAKE = 15,
    SWAMP = 16,
    MARSH = 17
}
export declare enum WaterType {
    NONE = 0,
    OCEAN = 1,
    RIVER = 2,
    LAKE = 3
}
export declare enum VegetationType {
    NONE = 0,
    GRASS = 1,
    SHRUB = 2,
    DECIDUOUS = 3,
    CONIFEROUS = 4,
    TROPICAL = 5,
    CACTUS = 6,
    TUNDRA_VEGETATION = 7
}
export declare enum SoilType {
    SAND = 0,
    DIRT = 1,
    CLAY = 2,
    SILT = 3,
    PEAT = 4,
    GRAVEL = 5,
    ROCK = 6,
    SNOW = 7
}
export declare enum ColorIndex {
    OCEAN_DEEP = 0,
    OCEAN_SHALLOW = 1,
    BEACH = 2,
    GRASSLAND = 3,
    FOREST = 4,
    DENSE_FOREST = 5,
    JUNGLE = 6,
    SAVANNA = 7,
    DESERT = 8,
    TUNDRA = 9,
    SNOW = 10,
    MOUNTAIN = 11,
    MOUNTAIN_SNOW = 12,
    CLIFF = 13,
    RIVER = 14,
    LAKE = 15,
    SWAMP = 16,
    MARSH = 17
}
export interface TerrainPoint {
    x: number;
    y: number;
    h: number;
    nH: number;
    w: boolean;
    wT?: WaterType;
    t: number;
    p: number;
    b: Biome;
    v?: number;
    vT?: VegetationType;
    sT?: SoilType;
    stp: number;
    iC?: boolean;
    c: ColorIndex;
    _possibleBeach?: Boolean;
}
