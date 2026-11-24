// Ammo, bottom-right (look "blood and ash", like the rest of the HUD): one
// small drawn round per round in the gun, then the spare rounds in your
// pockets as a number. Each weapon has its own round SHAPE, so you can tell
// at a glance what you're holding: thin brass cartridges for the revolver,
// fat red shells for the shotgun. Spent rounds stay as hollow outlines.
// Markup and CSS in index.html (#ammo-box, .round); from here we only add
// and remove elements and toggle CSS classes.
import { tuning } from '../sim/config';
import type { PlayerState } from '../sim/player';
import { AMMO_TYPE, currentAmmo, isAkimbo, magazineSize, type WeaponId } from '../sim/weapon';
import './fonts'; // the number is written in Rye

const box = document.getElementById('ammo-box')!;
const roundsEl = document.getElementById('ammo-rounds')!;
const reserveEl = document.getElementById('ammo-reserve')!;

// The round elements are rebuilt only when the weapon changes (or its
// magazine size, from the debug panel). Every other frame we just toggle
// a class on the ones already there: creating DOM elements 60 times a
// second would be wasted work for the browser (and garbage to collect).
let builtFor = ''; // "weapon:size" of the elements in roundsEl
let rounds: HTMLElement[] = [];

function build(weapon: WeaponId, size: number, akimbo: boolean, holy: boolean): void {
  roundsEl.replaceChildren(); // remove the old ones
  rounds = [];
  for (let i = 0; i < size; i++) {
    const r = document.createElement('i');
    // The CSS draws the shape from these two classes: .round.revolver / .round.shotgun
    r.className = `round ${weapon}`;
    // Akimbo: two cylinders, so a gap in the middle ("6 + 6").
    if (akimbo && i === size / 2) r.classList.add('cylinder-gap');
    // The Forge's dynamite: holy-water sticks, ivory with a blue cross.
    if (holy) r.classList.add('holy');
    roundsEl.append(r);
    rounds.push(r);
  }
  builtFor = `${weapon}:${size}:${akimbo}:${holy}`;
}

export function updateAmmoHud(player: PlayerState): void {
  const size = magazineSize(player, player.weapon);
  const akimbo = player.weapon === 'revolver' && isAkimbo(player);
  const holy = player.weapon === 'dynamite' && player.forged.dynamite > 0;
  if (builtFor !== `${player.weapon}:${size}:${akimbo}:${holy}`) build(player.weapon, size, akimbo, holy);

  // Full rounds on the left, spent ones on the right (they're fired from the right).
  const ammo = currentAmmo(player);
  rounds.forEach((r, i) => r.classList.toggle('spent', i >= ammo));

  // Reloading: the rounds dim and blink (CSS animation on .reloading).
  box.classList.toggle('reloading', player.reloadTicks > 0);

  // Spare rounds ("∞" with the debug infinite ammo); empty pockets turn red.
  reserveEl.textContent = tuning.infiniteAmmo ? '∞' : String(player.reserve[AMMO_TYPE[player.weapon]]);
  box.classList.toggle('dry', !tuning.infiniteAmmo && player.reserve[AMMO_TYPE[player.weapon]] === 0);
}
