// A tiny forwarder so effects can grab the shared soft sprite without importing
// the whole texture library.
import { radialSprite } from './textures.js';

export function TEX_RADIAL() {
  return radialSprite('rgba(255,255,255,0.95)', 'rgba(255,255,255,0)');
}
