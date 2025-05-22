import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: window.innerWidth,
  height: window.innerHeight,
  scene: [GameScene],
  backgroundColor: "#000000",
  zoom: 1,
};

const game = new Phaser.Game(config);

if (process.env.NODE_ENV === 'test' || import.meta.env.MODE === 'development') {
  console.log('Game is running in test or development mode');
  (window as any).game = game;
}