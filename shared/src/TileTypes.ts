import { ResourceNode } from "./ResourceTypes";
import { Biome, ColorIndex, SoilType, VegetationType, WaterType } from "./TerrainTypes";

export interface BaseTile {
  x: number;
  y: number; 
  h: number; // height
  nH: number; // normalized height (0-1)
  t: number; // temperature (-1 to 1)
  p: number; // precipitation (0-1)
  b: Biome;
  stp: number; // steepness
  c: ColorIndex;
  w: boolean; // is water
  r?: ResourceNode
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
  iC: boolean; // is cliff
}

export type Tile = WaterTile | LandTile;

export interface TerrainPoint {
  x: number;
  y: number;
  h: number;      // height
  nH: number;     // normalized height (0-1)
  w: boolean;     // is water
  wT?: WaterType; // water type (only if w is true)
  t: number;      // temperature (normalized 0-1)
  p: number;      // precipitation (normalized 0-1)
  b: Biome; // biome/terrain type
  v?: number;      // vegetation amount (0-1)
  vT?: VegetationType; // vegetation type (only if v > 0)
  sT?: SoilType;  // soil type (only if not water)
  stp: number;    // steepness (0-1)
  iC?: boolean;    // is cliff
  c: ColorIndex;  // color index for rendering
  _possibleBeach?: Boolean; // used for beach detection, not sent to client
  r?: ResourceNode;
  rV?: number; // River Value
}