// Atmosphere presets: everything that sets the mood of the scene.
// Sky, fog and ambient light are tuned together, because they must match:
// a purple sky with orange fog would look broken.
// Colors are hex like in CSS (0xff8800 = #ff8800). Angles in degrees.

export interface Atmosphere {
  name: string;
  /** Sky color straight above. */
  skyTop: number;
  /** Sky color at the horizon. Also used as fog color, so geometry fades into the sky. */
  skyHorizon: number;
  /** How fast the sky goes from horizon to top color. Higher = horizon band is thinner. */
  skyCurve: number;

  /** Sun (or moon) color, angular size and position. */
  sunColor: number;
  sunSize: number;
  /** Height above the horizon: 0 = on the horizon, 90 = straight up. */
  sunElevation: number;
  /** Compass direction: 0 = north (in front of the spawn), 90 = east. */
  sunAzimuth: number;
  /** Halo around the sun: strength and how tight it is (higher = tighter). */
  sunGlow: number;
  sunGlowTightness: number;
  /** Disk brightness: above 1 it's "brighter than white" and blooms. */
  sunBrightness: number;

  /** 0 = no stars, 1 = full stars. */
  stars: number;
  /**
   * Eclipse: how far the black moon has slid over the sun (0 = no moon,
   * 1 = sun fully covered, only the corona of flames around it). Going from 0
   * to 1 the moon visibly slides in from the side.
   */
  eclipse: number;

  /** Directional light coming from the sun/moon: color and strength. */
  sunLightColor: number;
  sunLightIntensity: number;

  /** Lanterns: color and strength (they matter much more at night). */
  lanternColor: number;
  lanternIntensity: number;

  /** Floating specks: color, how many (0..1), base visibility, wind (m/s), blinking (0..1). */
  dustColor: number;
  dustAmount: number;
  dustAlpha: number;
  dustWindX: number;
  dustWindZ: number;
  dustBlink: number;

  /** Fog: no fog before `fogNear` meters, solid fog after `fogFar`. */
  fogNear: number;
  fogFar: number;

  /** Ground mist: thickness (0 = none) and how fast it thins with height. */
  groundFogDensity: number;
  groundFogFalloff: number;

  /** Light shafts from the sun/moon (0 = none). */
  godRays: number;

  /** Ambient (hemisphere) light: color from above, color from below, strength. */
  ambientSky: number;
  ambientGround: number;
  ambientIntensity: number;
}

export const HIGH_NOON: Atmosphere = {
  name: 'High Noon',
  skyTop: 0x3a0806,
  skyHorizon: 0xa8401a,
  skyCurve: 0.6,
  sunColor: 0xffc070,
  sunSize: 7,
  // Readability (playtest): at 14° the sun sat right at the height of the enemies,
  // at the end of Main Street. At 22° its glare is above the rooftops, the street
  // gets sunlight, and the shadows are still long.
  sunElevation: 22,
  sunAzimuth: 15,
  sunGlow: 0.7,
  sunGlowTightness: 6,
  sunBrightness: 2.2,
  stars: 0,
  eclipse: 0,
  sunLightColor: 0xffa060,
  sunLightIntensity: 3.2,
  lanternColor: 0xffa040,
  lanternIntensity: 6,
  // Sand blown by a hot wind from the west.
  dustColor: 0xffb070,
  dustAmount: 1,
  dustAlpha: 0.35,
  dustWindX: 2.2,
  dustWindZ: 0.4,
  dustBlink: 0,
  // Less haze than before (fog from 12-85 m, ground mist 0.02, rays 0.7): an
  // enemy 20 m away against the sun was a smudge in an orange veil.
  fogNear: 20,
  fogFar: 110,
  groundFogDensity: 0.012,
  groundFogFalloff: 0.5,
  godRays: 0.45,
  ambientSky: 0xc06040,
  ambientGround: 0x301510,
  ambientIntensity: 0.85, // the sides in shadow (facing you, when you face the sun) aren't black
};

export const HIGH_MIDNIGHT: Atmosphere = {
  name: 'High Midnight',
  skyTop: 0x06030e,
  skyHorizon: 0x3a2050,
  skyCurve: 0.45,
  sunColor: 0xe0d0ff,
  sunSize: 4,
  sunElevation: 28,
  sunAzimuth: -30,
  sunGlow: 0.35,
  sunGlowTightness: 12,
  sunBrightness: 2,
  stars: 1,
  eclipse: 0,
  sunLightColor: 0x9080e0,
  sunLightIntensity: 1.1,
  lanternColor: 0xff9030,
  lanternIntensity: 14,
  // Fireflies / will-o'-the-wisps: few, slow, blinking, bright (they bloom).
  dustColor: 0xb8ff70,
  dustAmount: 0.35,
  dustAlpha: 0.9,
  dustWindX: 0.15,
  dustWindZ: 0,
  dustBlink: 1,
  fogNear: 8,
  fogFar: 65,
  groundFogDensity: 0.045,
  groundFogFalloff: 0.8,
  godRays: 0.7,
  ambientSky: 0x5040a0,
  ambientGround: 0x100818,
  ambientIntensity: 0.45,
};

/**
 * The Fire Eclipse: the Damned Smith's waves (render/eclipse.ts). A black moon
 * in front of the sun with a crown of flames around it; the sky goes dark but
 * the horizon burns all around (in a real total eclipse you're in the moon's
 * shadow, but far away there's still sunlight: a sunset in every direction).
 * The sun is about where High Noon's is, so the moon slides over THAT sun.
 */
export const FIRE_ECLIPSE: Atmosphere = {
  name: 'Fire Eclipse',
  skyTop: 0x0a0103,
  skyHorizon: 0x7a1806,
  skyCurve: 0.35,
  sunColor: 0xff5a18,
  sunSize: 9,
  sunElevation: 26,
  sunAzimuth: 15,
  sunGlow: 0.9,
  sunGlowTightness: 4,
  sunBrightness: 3,
  stars: 0.35, // a total eclipse shows the brightest stars
  eclipse: 1,
  sunLightColor: 0xff3010,
  sunLightIntensity: 0.9,
  lanternColor: 0xff8030,
  lanternIntensity: 12,
  // Ash and embers drifting from the forges of hell.
  dustColor: 0xff6020,
  dustAmount: 0.8,
  dustAlpha: 0.8,
  dustWindX: 0.8,
  dustWindZ: 0.3,
  dustBlink: 0.5,
  fogNear: 10,
  fogFar: 75,
  groundFogDensity: 0.03,
  groundFogFalloff: 0.6,
  godRays: 0.9,
  ambientSky: 0x802010,
  ambientGround: 0x200404,
  ambientIntensity: 0.5,
};

export const ATMOSPHERES = [HIGH_NOON, HIGH_MIDNIGHT, FIRE_ECLIPSE];

/**
 * The devil's night: the wager's "darkness" curse (render/darkness.ts). Not a
 * preset you pick: the town goes pitch black on top of whatever sky it had.
 * No moon, no stars, almost no ambient light, the fog 20 m away and the color
 * of dried blood: you see the enemies when they're on you. Only the lanterns
 * stay lit (stronger): islands of light in the dark, the places to fight in.
 */
export const DEVIL_NIGHT: Atmosphere = {
  name: 'Devil Night',
  skyTop: 0x000000,
  skyHorizon: 0x120204,
  skyCurve: 0.5,
  sunColor: 0x400808,
  sunSize: 3,
  sunElevation: 20,
  sunAzimuth: 15,
  sunGlow: 0.05,
  sunGlowTightness: 12,
  sunBrightness: 0.3,
  stars: 0,
  eclipse: 0,
  sunLightColor: 0x401010,
  sunLightIntensity: 0.15,
  lanternColor: 0xff7020,
  lanternIntensity: 18,
  dustColor: 0xff3010,
  dustAmount: 0.25,
  dustAlpha: 0.7,
  dustWindX: 0.1,
  dustWindZ: 0,
  dustBlink: 1,
  fogNear: 4,
  fogFar: 24,
  groundFogDensity: 0.06,
  groundFogFalloff: 0.7,
  godRays: 0,
  ambientSky: 0x301018,
  ambientGround: 0x080204,
  ambientIntensity: 0.22,
};

/**
 * A preset in between a and b: t = 0 is a, t = 1 is b. Every number goes
 * straight from one value to the other (linear interpolation, "lerp"), every
 * color channel by channel: 0xRRGGBB is three numbers packed together, so we
 * unpack red, green and blue, lerp each one and pack them back. It's how a CSS
 * `transition` on a color works. (Mixing in sRGB, like CSS does, not in the
 * linear space of the lights: in between it looks a bit darker, a dusk.)
 */
export function mixAtmosphere(a: Atmosphere, b: Atmosphere, t: number): Atmosphere {
  const mixed = { ...a };
  for (const key of Object.keys(a) as (keyof Atmosphere)[]) {
    if (key === 'name') continue;
    (mixed[key] as number) = COLOR_KEYS.has(key)
      ? mixColor(a[key] as number, b[key] as number, t)
      : (a[key] as number) + ((b[key] as number) - (a[key] as number)) * t;
  }
  mixed.name = t < 0.5 ? a.name : b.name;
  return mixed;
}

/** Which fields are colors (they're lerped channel by channel, not as one number). */
const COLOR_KEYS = new Set<keyof Atmosphere>([
  'skyTop', 'skyHorizon', 'sunColor', 'sunLightColor', 'lanternColor', 'dustColor', 'ambientSky', 'ambientGround',
]);

function mixColor(a: number, b: number, t: number): number {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 0xff; // ">> 16" moves red down, "& 0xff" keeps one byte
    const cb = (b >> shift) & 0xff;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return out;
}
