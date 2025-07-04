export enum ResourceType {
  Iron = 'iron',
  Gold = 'gold',
  Coal = 'coal',
  Stone = 'stone',
  Wood = 'wood',
  Crystal = 'crystal',
  Oil = 'oil',
  Water = 'water'
}

export interface ResourceNode {
  type: ResourceType;
  amount: number;       // Total available amount
  remaining: number;    // Current remaining amount
  hardness: number;     // Mining difficulty (0-1)
  x: number;            // World X position
  y: number;            // World Y position
  respawnTime?: number; // Time in ms until respawn
}