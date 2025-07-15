import { createNoise2D, createNoise3D } from 'simplex-noise';

export class NoiseGenerator {
  private seed: number;
  private noise2D: (x: number, y: number) => number;
  private noise3D: (x: number, y: number, z: number) => number;

  constructor(seed?: number) {
    this.seed = seed || Math.random() * 10000;
    // Initialize noise functions with seed
    this.noise2D = createNoise2D(() => this.seed);
    this.noise3D = createNoise3D(() => this.seed);
  }

  // Generate fractal Brownian motion noise (optimized)
  fbm(x: number, y: number, octaves: number = 4, lacunarity: number = 2.0, persistence: number = 0.5): number {
    let value = 0;
    let amplitude = 1.0;
    let frequency = 1.0;
    let maxValue = 0;

    // Reduced octaves for better performance
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    // Normalize to [-1, 1]
    return value / maxValue;
  }

  // Domain warping for more natural-looking terrain
  domainWarp(x: number, y: number, amplitude: number = 30.0, frequency: number = 0.01): [number, number] {
    const warpX = x + amplitude * this.fbm(x * frequency, y * frequency, 4);
    const warpY = y + amplitude * this.fbm(x * frequency + 5.2, y * frequency + 1.3, 4);
    return [warpX, warpY];
  }

  // Generate height map with integrated river carving
  generateHeight(x: number, y: number): number {
    const [warpX, warpY] = this.domainWarp(x, y);
    const baseHeight = this.fbm(warpX * 0.01, warpY * 0.01, 4, 2.0, 0.5);

    // Only apply rivers if above sea level (0.3)
    if (baseHeight > 0.3) {
      const riverValue = this.generateRiverMap(x, y, baseHeight);
      const carveMask = Math.min(1.0, Math.max(0, (baseHeight - 0.3) * 2.5));
      const carveDepth = 0.1 * Math.max(0, carveMask);
      return Math.max(-1.0, Math.min(1.0, baseHeight - riverValue * carveDepth));
    }

    return baseHeight;
  }

  // Generate temperature map (affected by height and latitude)
  generateTemperature(x: number, y: number, height: number): number {
    // Base temperature decreases with latitude (distance from equator)
    const latitudeFactor = Math.cos((y / 1000) * Math.PI);
    // Temperature decreases with altitude
    const heightFactor = Math.max(0, 1 - height * 1.5);
    // Add some local variation
    const variation = this.fbm(x * 0.02, y * 0.02, 3) * 0.2;

    // Combine factors and normalize to [0,1]
    return Math.max(0, Math.min(1, (latitudeFactor * heightFactor) + variation));
  }

  // Generate precipitation map (affected by temperature and terrain)
  generatePrecipitation(x: number, y: number, height: number, temp: number): number {
    // Base precipitation with noise
    let precip = this.fbm(x * 0.01 + 100, y * 0.01 + 100, 4) * 0.5 + 0.5;

    // Rain shadow effect - less rain on leeward side of mountains
    const mountainEffect = Math.max(0, height - 0.5) * 2;
    const windDirection = this.fbm(x * 0.001, y * 0.001, 1); // Simplified wind direction
    const rainShadow = mountainEffect * Math.max(0, windDirection);

    // Precipitation is generally higher in moderate temperatures
    const tempEffect = 1 - Math.abs(temp - 0.5) * 2;

    // Combine factors
    precip = precip * (1 - rainShadow * 0.5) * (0.5 + tempEffect * 0.5);

    return Math.max(0, Math.min(1, precip));
  }

  /**
 * Generates a map of potential river networks.
 * The output is a value from 0 to 1, where values close to 1 represent a river center.
 * @returns {number} A value indicating the "riverness" of a point.
 */
  generateRiverMap(x: number, y: number, baseHeight: number): number {
    if (baseHeight < 0.3) return 0; // No rivers in oceans

    const [warpX, warpY] = this.domainWarp(x, y, 50.0, 0.005);
    const noise = this.fbm(warpX * 0.04, warpY * 0.04, 3);
    let riverValue = 1.0 - Math.abs(noise * 2 - 1);

    // Reduce rivers in high elevations
    const heightFactor = 1.0 - Math.max(0, (baseHeight - 0.6) / 0.3);
    //riverValue = Math.pow(riverValue, 8) * heightFactor;

    return Math.max(0, riverValue);
  }
}