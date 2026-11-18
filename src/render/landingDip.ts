// Camera "landing dip": when you land, the view drops a bit and springs back.
// Pure visual feedback: it lives on the rendering side and never touches the
// simulation (where you actually are doesn't change, only where the camera is).

/** Meters of camera drop per m/s of falling speed. */
const DIP_PER_SPEED = 0.012;
/** Biggest possible dip, meters. */
const MAX_DIP = 0.2;
/** How fast the camera recovers. Higher = snappier. */
const RECOVER_RATE = 14;

let dip = 0;

/** Call when the player touches the ground. `fallSpeed` is positive, in m/s. */
export function triggerLandingDip(fallSpeed: number): void {
  dip = Math.min(fallSpeed * DIP_PER_SPEED, MAX_DIP);
}

/** Call once per frame: returns how many meters to lower the camera. */
export function updateLandingDip(frameTime: number): number {
  // Exponential decay: every frame we remove a fraction of what's left.
  // Fast at first, then it settles smoothly, independently of the frame rate.
  dip *= Math.exp(-RECOVER_RATE * frameTime);
  return dip;
}
