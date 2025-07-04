import { WaterTile, LandTile, BaseTile, Tile} from "shared/TileTypes";
import { WaterType, VegetationType, SoilType } from "shared/TerrainTypes";

export class TileNormalizer {
  /**
   * Normalize a tile from array format to object format.
   * @param tile - The tile to normalize.
   * @returns The normalized tile object.
   */
  public static NormalizeTile(tile: any): Tile {
    if (Array.isArray(tile)) {
      const isWater = tile[4] === 1;

      const baseTile: BaseTile = {
        x: tile[0],
        y: tile[1],
        h: tile[2],
        nH: tile[3],
        t: tile[5],
        p: tile[6],
        b: tile[8],
        stp: tile[7],
        c: tile[9],
        w: isWater,
        r: undefined
      };

      if (isWater) {
        const waterTile: WaterTile = {
          ...baseTile,
          w: true,
          wT: tile[11] as WaterType,
        };
        return waterTile;
      } else {
        const landTile: LandTile = {
          ...baseTile,
          w: false,
          iC: tile[10] === 1,
          v: tile[12],
          vT: tile[13] as VegetationType,
          sT: tile[14] as SoilType
        };
        return landTile;
      }
    }
    return tile;
  }

  /**
   * Normalize an array of tiles from array format to object format.
   * @param tiles - The array of tiles to normalize.
   * @returns An array of normalized tile objects.
   */
   public static NormalizeTiles(tiles: any[]): Tile[] {
    return tiles.map(this.NormalizeTile);
  }
}
