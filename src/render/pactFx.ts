// What some of the barman's drinks (the pacts, src/sim/drinks.ts) look and
// sound like. Only the pacts that make something happen in the world need
// it; the ones that change a number (more health, more damage) show up in
// the HUD on their own.
// - "Ali del corvo": the jump in mid-air: a puff of black feathers (smoke
//   particles, dark and small) under your feet, a wingbeat and a caw.
// - "Zoccolo del diavolo": the hard landing's shockwave: a ring of dust thrown
//   out on the ground, the view shaken, a hoof on stone.
// ("Scia di brace" is drawn by holyFire.ts: its patches are the same pools,
// orange.)
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import { playAirJump, playHoofSlam } from '../audio/sfx';
import { spawnDirt, spawnSmoke } from './particles';
import { blastShake } from './cameraFeel';

/** Feathers (dark smoke) for the crow's jump. */
const FEATHERS = 4;
/** The hoof's ring of dust: how many puffs around, how many grains each, how hard the view shakes (0..1). */
const RING_PUFFS = 16;
const DIRT_PER_PUFF = 4;
const HOOF_SHAKE = 0.6;

const point = new THREE.Vector3();
const dir = new THREE.Vector3();

export function handlePactEvents(events: SimEvent[]): void {
  for (const e of events) {
    if (e.type === 'airJump') {
      point.set(e.x, e.y, e.z);
      spawnSmoke(point, dir.set(0, -1, 0), FEATHERS);
      playAirJump();
    } else if (e.type === 'hoofSlam') {
      // A ring of dust: puffs evenly around you, each thrown outward and a bit up.
      for (let i = 0; i < RING_PUFFS; i++) {
        const a = (i / RING_PUFFS) * Math.PI * 2;
        point.set(e.x + Math.cos(a) * 0.8, e.y + 0.1, e.z + Math.sin(a) * 0.8);
        spawnDirt(point, dir.set(Math.cos(a), 0.6, Math.sin(a)).normalize(), DIRT_PER_PUFF);
      }
      blastShake(HOOF_SHAKE);
      playHoofSlam();
    }
  }
}
