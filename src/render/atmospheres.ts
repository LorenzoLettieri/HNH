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

  /** Directional light coming from the sun/moon: color and strength. */
  sunLightColor: number;
  sunLightIntensity: number;

  /** Lanterns: color and strength (they matter much more at night). */
  lanternColor: number;
  lanternIntensity: number;

  /** Fog: no fog before `fogNear` meters, solid fog after `fogFar`. */
  fogNear: number;
  fogFar: number;

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
  sunElevation: 14,
  sunAzimuth: 15,
  sunGlow: 0.9,
  sunGlowTightness: 6,
  sunBrightness: 3,
  stars: 0,
  sunLightColor: 0xffa060,
  sunLightIntensity: 3.2,
  lanternColor: 0xffa040,
  lanternIntensity: 6,
  fogNear: 10,
  fogFar: 60,
  ambientSky: 0xc06040,
  ambientGround: 0x301510,
  ambientIntensity: 0.7,
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
  sunLightColor: 0x9080e0,
  sunLightIntensity: 1.1,
  lanternColor: 0xff9030,
  lanternIntensity: 14,
  fogNear: 6,
  fogFar: 45,
  ambientSky: 0x5040a0,
  ambientGround: 0x100818,
  ambientIntensity: 0.45,
};

export const ATMOSPHERES = [HIGH_NOON, HIGH_MIDNIGHT];
