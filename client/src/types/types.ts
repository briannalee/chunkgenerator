export enum Biome {
  OCEAN = 0,
  BEACH = 1,
  PLAINS = 2,
  FOREST = 3,
  JUNGLE = 4,
  DESERT = 5,
  TAIGA = 6,
  TUNDRA = 7,
  MOUNTAIN = 8,
  GLACIER = 9
}

export enum WaterType {
  FRESH = 0,
  SALT = 1,
  BRACKISH = 2
}

export enum VegetationType {
  NONE = 0,
  GRASS = 1,
  SHRUBS = 2,
  DECIDUOUS = 3,
  CONIFEROUS = 4,
  TROPICAL = 5
}

export enum SoilType {
  SAND = 0,
  LOAM = 1,
  CLAY = 2,
  PEAT = 3,
  ROCKY = 4
}

export enum ColorIndex {
  DEEP_WATER = 0,
  SHALLOW_WATER = 1,
  BEACH = 2,
  PLAINS = 3,
  FOREST = 4,
  JUNGLE = 5,
  DESERT = 6,
  TAIGA = 7,
  TUNDRA = 8,
  MOUNTAIN = 9,
  GLACIER = 10
}

export interface BaseTile {
  x: number;
  y: number;
  h: number; // height
  nH: number; // normalized height (0-1)
  t: number; // temperature (-1 to 1)
  p: number; // precipitation (0-1)
  b: Biome;
  stp: number; // steepness
  iC: boolean; // is cliff
  c: ColorIndex;
}

export interface WaterTile extends BaseTile {
  w: true;
  wT: WaterType;
}

export interface LandTile extends BaseTile {
  w: false;
  v: number; // vegetation amount (0-1)
  vT: VegetationType;
  sT: SoilType;
}

export type Tile = WaterTile | LandTile;

export interface ChunkData {
  x: number;
  y: number;
  tiles: Tile[];
}