export enum TerrainType {
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
  MARSH = 17,
}

export enum WaterType {
  NONE = 0,
  OCEAN = 1,
  RIVER = 2,
  LAKE = 3,
}

export enum VegetationType {
  NONE = 0,
  GRASS = 1,
  SHRUB = 2,
  DECIDUOUS = 3,
  CONIFEROUS = 4,
  TROPICAL = 5,
  CACTUS = 6,
  TUNDRA_VEGETATION = 7,
}

export enum SoilType {
  SAND = 0,
  DIRT = 1,
  CLAY = 2,
  SILT = 3,
  PEAT = 4,
  GRAVEL = 5,
  ROCK = 6,
  SNOW = 7,
}

/* ColorIndex is used for rendering and mapping purposes, representing different terrain colors
 * While this is currently a duplicate of the TerrainType enum, it may be expanded in the future
 * to include more specific color indices for rendering purposes. */
export enum ColorIndex {
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
  MARSH = 17,
}

export interface TerrainPoint {
  x: number;
  y: number;
  h: number;      // height
  nH: number;     // normalized height (0-1)
  w: boolean;     // is water
  wT?: WaterType; // water type (only if w is true)
  t: number;      // temperature (normalized 0-1)
  p: number;      // precipitation (normalized 0-1)
  b: TerrainType; // biome/terrain type
  v?: number;      // vegetation amount (0-1)
  vT?: VegetationType; // vegetation type (only if v > 0)
  sT?: SoilType;  // soil type (only if not water)
  stp: number;    // steepness (0-1)
  iC?: boolean;    // is cliff
  c: ColorIndex;  // color index for rendering
}