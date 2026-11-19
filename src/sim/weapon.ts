// The revolver: firing, cooldown, ammo and reloading. Pure simulation:
// what happens visually/audibly is decided elsewhere, from the events.
import type { InputCommand } from './command';
import { secondsToTicks, tuning } from './config';
import type { SimEvent } from './events';
import { currentEyeHeight, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';
import { damage, hitBox, isAlive, isEnemy, type Entity, type EyebatEntity } from './entities';

export function stepWeapon(
  p: PlayerState,
  cmd: InputCommand,
  world: World,
  entities: Entity[],
  events: SimEvent[],
): void {
  // Timers.
  if (p.fireCooldownTicks > 0) p.fireCooldownTicks--;
  if (p.fireBufferTicks > 0) p.fireBufferTicks--;

  // Reloading: count down, then refill.
  if (p.reloadTicks > 0) {
    p.reloadTicks--;
    if (p.reloadTicks === 0) {
      p.ammo = tuning.revolverAmmo;
      events.push({ type: 'reloadEnd' });
    }
  }

  // Semi-automatic: a shot needs a NEW click (pressed now, not pressed the
  // tick before). The click is buffered a little, like the jump.
  const clicked = cmd.fire && !p.fireHeld;
  p.fireHeld = cmd.fire;
  if (clicked) p.fireBufferTicks = secondsToTicks(tuning.revolverFireBuffer);

  const wantsReload = (cmd.reload && p.ammo < tuning.revolverAmmo) || (p.ammo === 0 && clicked);
  if (wantsReload && p.reloadTicks === 0) {
    if (p.ammo === 0 && clicked) events.push({ type: 'dryFire' });
    p.reloadTicks = secondsToTicks(tuning.revolverReloadTime);
    p.fireBufferTicks = 0;
    events.push({ type: 'reloadStart' });
    return;
  }

  const ready = p.fireCooldownTicks === 0 && p.reloadTicks === 0 && p.ammo > 0;
  if (p.fireBufferTicks > 0 && ready) {
    fire(p, world, entities, events);
    p.ammo--;
    p.fireCooldownTicks = secondsToTicks(tuning.revolverFireInterval);
    p.fireBufferTicks = 0;
  }
}

/** Hitscan: the bullet travels instantly along the view direction. */
function fire(p: PlayerState, world: World, entities: Entity[], events: SimEvent[]): void {
  // Start at the eye, go where the player looks. Same yaw/pitch math as the
  // camera: yaw turns around the vertical axis, pitch tilts up/down.
  const ox = p.x;
  const oy = p.y + currentEyeHeight(p);
  const oz = p.z;
  const cosPitch = Math.cos(p.pitch);
  const dx = -Math.sin(p.yaw) * cosPitch;
  const dy = Math.sin(p.pitch);
  const dz = -Math.cos(p.yaw) * cosPitch;

  // Two raycasts: against the level and against the (living) entities.
  // The bullet stops at whichever is closer: a target behind a wall is safe.
  const levelHit = raycastBoxes(ox, oy, oz, dx, dy, dz, tuning.weaponRange, world.boxes);
  const living = entities.filter(isAlive);
  const entityHit = raycastBoxes(ox, oy, oz, dx, dy, dz, tuning.weaponRange, living.map(hitBox));
  const hitEntity = entityHit && (!levelHit || entityHit.distance < levelHit.distance);
  const hit = hitEntity ? entityHit : levelHit;
  const target = hitEntity ? living[entityHit.index] : null;

  // Critical hit ("headshot" in the events, so the gold hitmarker and the
  // sound work for every enemy):
  // - ghoul: the bullet hit the top of it (head and hat). Checking the
  //   height of the impact point is enough: no second hitbox.
  // - eye-bat: the bullet passed through the pupil (see pupilHit).
  const headshot =
    target !== null &&
    ((target.type === 'ghoul' && hit!.y - target.y > tuning.ghoulHeadHeight) ||
      (target.type === 'eyebat' && pupilHit(target, ox, oy, oz, dx, dy, dz)));

  const to = hit
    ? { x: hit.x, y: hit.y, z: hit.z }
    : { x: ox + dx * tuning.weaponRange, y: oy + dy * tuning.weaponRange, z: oz + dz * tuning.weaponRange };
  events.push({
    type: 'shot',
    from: { x: ox, y: oy, z: oz },
    to,
    normal: hit ? { x: hit.nx, y: hit.ny, z: hit.nz } : null,
    entityId: target ? target.id : null,
    surface: !hit ? null : !target ? 'level' : isEnemy(target) ? 'flesh' : 'metal',
    headshot,
  });

  if (target) {
    const amount = tuning.revolverDamage * (headshot ? tuning.headshotMultiplier : 1);
    const killed = damage(target, amount);
    if (killed && headshot && target.type === 'ghoul') target.headless = true;
    if (killed && headshot && target.type === 'eyebat') target.popped = true;
    events.push({
      type: 'hit',
      entityId: target.id,
      damage: amount,
      killed,
      surface: isEnemy(target) ? 'flesh' : 'metal',
      headshot,
    });
  }
}

/**
 * Did the bullet go through the eye-bat's pupil?
 *
 * The sprite always faces the camera, so the pupil is always the point of the
 * eye closest to the center as seen from the shooter. That turns the question
 * into: how close does the bullet's line pass to the center of the eye?
 *
 * Point-to-line distance: take the vector from the gun to the center (oc),
 * project it on the shot direction (t = oc · dir, how far along the line the
 * center is), and measure what's left over (the part of oc perpendicular to
 * the line). If that's smaller than the pupil, it's a critical hit.
 */
function pupilHit(b: EyebatEntity, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean {
  const r = tuning.eyebatRadius;
  const ocx = b.x - ox;
  const ocy = b.y + r - oy; // b.y is the bottom of the body: + r = its center
  const ocz = b.z - oz;
  const t = ocx * dx + ocy * dy + ocz * dz;
  const px = ocx - dx * t;
  const py = ocy - dy * t;
  const pz = ocz - dz * t;
  return Math.hypot(px, py, pz) < tuning.eyebatPupilRadius;
}
