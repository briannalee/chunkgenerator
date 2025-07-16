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

  // Generate height map with domain warping (optimized)
  generateHeight(x: number, y: number): number {
    const [warpX, warpY] = this.domainWarp(x, y);
    return this.fbm(warpX * 0.01, warpY * 0.01, 4, 2.0, 0.5);
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

  generateRiverValue(x: number, y: number): number {
    const octaves = 5;
    const persistence = 0.5;
    const lacunarity = 2.0;
    const offset = 1.0;
    const scale = 0.005; // Low frequency for spaced-out, connected rivers

    let value = 0;
    let amplitude = 1;
    let frequency = scale;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
      let signal = this.noise2D(x * frequency, y * frequency);
      signal = Math.abs(signal);
      signal = offset - signal;
      signal *= signal; // Sharpen for path-like structures
      value += signal * amplitude;
      maxValue += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }

    return value / maxValue;
  }

  generateRiverWidth(x: number, y: number): number {
    return (this.fbm(x * 0.001, y * 0.001, 3, 2.0, 0.5) + 1) * 0.5; // Normalized 0-1
  }

}
