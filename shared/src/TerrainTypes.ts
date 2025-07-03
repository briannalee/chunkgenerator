export enum Biome {
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

// Map ColorIndex to hex colors for rendering
export const ColorMap: Record<ColorIndex, number> = {
  [ColorIndex.OCEAN_DEEP]: 0x0f4d8a,
  [ColorIndex.OCEAN_SHALLOW]: 0x08394d,
  [ColorIndex.BEACH]: 0xF5DEB3,
  [ColorIndex.GRASSLAND]: 0x7CFC00,
  [ColorIndex.FOREST]: 0x228B22, // Forest green
  [ColorIndex.DENSE_FOREST]: 0x006400, // Dark green for dense forest
  [ColorIndex.JUNGLE]: 0x228B22, // Jungle green
  [ColorIndex.SAVANNA]: 0xD2B48C, // Tan for savanna
  [ColorIndex.DESERT]: 0x000000,//0xF4A460, // Sandy color for desert
  [ColorIndex.TUNDRA]: 0xE6E6FA, // Light purple for tundra
  [ColorIndex.SNOW]: 0xFFFFFF, // White for snow
  [ColorIndex.MOUNTAIN]:  0xA9A9A9, // Dark gray for mountains
  [ColorIndex.MOUNTAIN_SNOW]: 0xe8e8e8, // Light gray for snowy mountains
  [ColorIndex.CLIFF]: 0x575656, // Gray for cliffs
  [ColorIndex.RIVER]: 0x1E90FF, // Dodger blue for rivers
  [ColorIndex.LAKE]: 0x5F9EA0, // Cadet blue for lakes
  [ColorIndex.SWAMP]: 0x8FBC8F, // Dark sea green for swamps
  [ColorIndex.MARSH]: 0x98FB98, // Pale green for marshes
};