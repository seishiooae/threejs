import './style.css';
import { Game } from './Game.js';

window.addEventListener('DOMContentLoaded', () => {
  const game = new Game();
  game.start();
});
