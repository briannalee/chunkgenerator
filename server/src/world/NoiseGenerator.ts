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

  generateRiverNoise(x: number, y: number): number {
    // Use multiple noise layers to create river-like patterns

    // Primary river network - large scale features
    const primaryRivers = Math.abs(this.fbm(x * 0.003, y * 0.003 + 1000, 3, 2.0, 0.6));

    // Secondary tributaries - medium scale
    const secondaryRivers = Math.abs(this.fbm(x * 0.008, y * 0.008 + 2000, 2, 2.0, 0.5));

    // Tertiary streams - small scale
    const tertiaryStreams = Math.abs(this.fbm(x * 0.02, y * 0.02 + 3000, 2, 2.0, 0.4));

    // Combine layers with different weights
    // Invert the values so that low noise values (valleys) become high river values
    const combined = (1 - primaryRivers) * 0.6 +
      (1 - secondaryRivers) * 0.3 +
      (1 - tertiaryStreams) * 0.1;

    // Apply ridging to create more defined river channels
    const ridged = this.applyRidging(combined, 0.4);

    return ridged;
  }

  // Generate regional variation in river density
  generateRegionalRiverDensity(x: number, y: number): number {
    // Large-scale noise for regional river density variation
    return this.fbm(x * 0.001, y * 0.001 + 5000, 2, 2.0, 0.5);
  }

  // Apply ridging function to create sharper river channels
  private applyRidging(value: number, threshold: number): number {
    if (value > threshold) {
      // Sharpen values above threshold
      const normalized = (value - threshold) / (1 - threshold);
      return threshold + Math.pow(normalized, 0.5) * (1 - threshold);
    }
    return value;
  }
}
