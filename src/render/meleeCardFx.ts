// What the melee weapons' cards (shovel and lasso, src/sim/upgrades.ts) look
// and sound like, when they make something happen that the weapon's own
// effects don't already show:
// - "Pogo": the bounce up off an enemy: a springy boing and a puff under you.
// - "Schianto dal cielo": the dive (rushing wind) and the shockwave where you
//   land: a ring of dirt as wide as the wave, the view shaken, a BOOM.
// - "Fionda": the rope lets go like a slingshot band.
// (Parata uses the drink Bobby's sparks and TING, pactFx.ts; Arrivo di
// stivale is a 'kickLand' of the boot, weaponFx.ts; the fire of Corda rovente
// is burning.ts; the patches of Scia Napalm are drawn by holyFire.ts.)
import * as THREE from 'three';
import type { SimEvent } from '../sim/events';
import { tuning } from '../sim/config';
import { playPogo, playSkyDive, playSkySlam, playSling } from '../audio/sfx';
import { spawnDirt, spawnSmoke } from './particles';
import { blastShake } from './cameraFeel';

/** The shockwave's ring of dirt: puffs per meter of circumference, grains each. */
const SLAM_PUFFS_PER_METER = 1.2;
const SLAM_DIRT_PER_PUFF = 5;
/** How hard the view shakes at the biggest wave (0..1), and at the smallest. */
const SLAM_SHAKE_MIN = 0.5;
const SLAM_SHAKE_MAX = 1;

const point = new THREE.Vector3();
const dir = new THREE.Vector3();

export function handleMeleeCardEvents(events: SimEvent[]): void {
  for (const e of events) {
    if (e.type === 'pogo') {
      point.set(e.x, e.y, e.z);
      spawnSmoke(point, dir.set(0, -1, 0), 3);
      playPogo();
    } else if (e.type === 'skyDive') {
      playSkyDive();
    } else if (e.type === 'skySlam') {
      // 0 = the smallest wave, 1 = the biggest (how far you fell, through the radius).
      const span = Math.max(0.01, tuning.skySlamMaxRadius - tuning.skySlamRadius);
      const size = Math.min(1, Math.max(0, (e.radius - tuning.skySlamRadius) / span));
      // The ring: puffs evenly around the circle's edge (2πr meters of it), thrown outward.
      const puffs = Math.max(8, Math.round(2 * Math.PI * e.radius * SLAM_PUFFS_PER_METER));
      for (let i = 0; i < puffs; i++) {
        const a = (i / puffs) * Math.PI * 2;
        for (const r of [0.8, e.radius]) {
          point.set(e.x + Math.cos(a) * r, e.y + 0.1, e.z + Math.sin(a) * r);
          spawnDirt(point, dir.set(Math.cos(a), 0.7, Math.sin(a)).normalize(), SLAM_DIRT_PER_PUFF);
        }
      }
      blastShake(SLAM_SHAKE_MIN + (SLAM_SHAKE_MAX - SLAM_SHAKE_MIN) * size);
      playSkySlam(size);
    } else if (e.type === 'hookRelease' && e.sling) {
      playSling();
    }
  }
}
