// The revolver: firing, cooldown, ammo and reloading. Pure simulation:
// what happens visually/audibly is decided elsewhere, from the events.
import type { InputCommand } from './command';
import { secondsToTicks, tuning } from './config';
import type { SimEvent } from './events';
import { currentEyeHeight, type PlayerState } from './player';
import { raycastBoxes } from './raycast';
import type { World } from './world';

export function stepWeapon(
  p: PlayerState,
  cmd: InputCommand,
  world: World,
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
    fire(p, world, events);
    p.ammo--;
    p.fireCooldownTicks = secondsToTicks(tuning.revolverFireInterval);
    p.fireBufferTicks = 0;
  }
}

/** Hitscan: the bullet travels instantly along the view direction. */
function fire(p: PlayerState, world: World, events: SimEvent[]): void {
  // Start at the eye, go where the player looks. Same yaw/pitch math as the
  // camera: yaw turns around the vertical axis, pitch tilts up/down.
  const ox = p.x;
  const oy = p.y + currentEyeHeight(p);
  const oz = p.z;
  const cosPitch = Math.cos(p.pitch);
  const dx = -Math.sin(p.yaw) * cosPitch;
  const dy = Math.sin(p.pitch);
  const dz = -Math.cos(p.yaw) * cosPitch;

  const hit = raycastBoxes(ox, oy, oz, dx, dy, dz, tuning.weaponRange, world.boxes);
  const to = hit
    ? { x: hit.x, y: hit.y, z: hit.z }
    : { x: ox + dx * tuning.weaponRange, y: oy + dy * tuning.weaponRange, z: oz + dz * tuning.weaponRange };
  events.push({
    type: 'shot',
    from: { x: ox, y: oy, z: oz },
    to,
    normal: hit ? { x: hit.nx, y: hit.ny, z: hit.nz } : null,
  });
}
