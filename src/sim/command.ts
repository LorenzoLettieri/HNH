// What the player wants to do during ONE tick. The simulation only ever sees
// this, never the keyboard or mouse directly. Later, the same object will be
// sent over the network to the server.
export interface InputCommand {
  /** Which tick this command is for. */
  tick: number;
  /** -1 = backward, 0 = none, 1 = forward. */
  forward: number;
  /** -1 = left, 0 = none, 1 = right. */
  strafe: number;
  /** Jump button held down during this tick. */
  jump: boolean;
  /** Crouch button held (crouch, or slide if running fast enough). */
  crouch: boolean;
  /** Fire button held (left mouse). */
  fire: boolean;
  /** Reload button held. */
  reload: boolean;
  /** Go back to the spawn point (debug/testing). */
  respawn: boolean;
  /** View angles (radians) at the time the command was built. */
  yaw: number;
  pitch: number;
}
