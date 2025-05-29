import Phaser from 'phaser';

declare global {
  interface Window {
    game: Phaser.Game;
  }
}

declare module 'pako' {
  export function inflate(input: Uint8Array, options?: { to?: 'string' }): string | Uint8Array;
  // Add other functions if needed
}
