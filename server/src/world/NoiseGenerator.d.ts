export declare class NoiseGenerator {
    private seed;
    private noise2D;
    private noise3D;
    constructor(seed?: number);
    fbm(x: number, y: number, octaves?: number, lacunarity?: number, persistence?: number): number;
    domainWarp(x: number, y: number, amplitude?: number, frequency?: number): [number, number];
    generateHeight(x: number, y: number): number;
    generateTemperature(x: number, y: number, height: number): number;
    generatePrecipitation(x: number, y: number, height: number, temp: number): number;
}
