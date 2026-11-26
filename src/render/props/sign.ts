// Hanging western sign: a post, an arm with a diagonal brace, and a painted
// board hanging from two chains, gently swinging in the wind.
import * as THREE from 'three';
import { PIXELS_PER_METER } from '../materials';
import { propMaterial, solid, texturedBox, type PropModel } from './common';
import { ironTexture, postWoodTexture, signTexture } from './textures';

const POST_HEIGHT = 2.8;
const POST_SIZE = 0.14;
const ARM_Y = 2.6; // height of the arm's center
const CHAIN_LENGTH = 0.22;
const BOARD_THICKNESS = 0.05;
/** Swing in the wind: max angle (radians) and speed. */
const SWING_ANGLE = 0.07;
const SWING_SPEED = 1.3;

export function createSign(text: string): PropModel {
  const group = new THREE.Group();
  const wood = postWoodTexture();

  // The board's size comes from the text: the texture is exactly as many
  // pixels as the text needs, converted to meters with our texel density.
  const sign = signTexture(text);
  const boardW = sign.width / PIXELS_PER_METER;
  const boardH = sign.height / PIXELS_PER_METER;
  const armLength = boardW + 0.35;

  // Post.
  const post = texturedBox(POST_SIZE, POST_HEIGHT, POST_SIZE, wood);
  post.position.y = POST_HEIGHT / 2;
  group.add(post);

  // Arm: built vertical (so the wood grain runs along it), then laid down
  // along +X by rotating 90° around Z.
  const arm = texturedBox(0.1, armLength, 0.1, wood);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(armLength / 2, ARM_Y, 0);
  group.add(arm);

  // Diagonal brace between post and arm, at 45°.
  const braceLength = 0.65;
  const brace = texturedBox(0.07, braceLength, 0.07, wood);
  brace.rotation.z = -Math.PI / 4;
  const half = (braceLength / 2) * Math.SQRT1_2;
  brace.position.set(POST_SIZE / 2 + half, ARM_Y - 0.05 - half, 0);
  group.add(brace);

  // The hanging part pivots around the arm: we rotate this group to swing it.
  const pivot = new THREE.Group();
  pivot.position.set(0.25 + boardW / 2, ARM_Y - 0.05, 0);
  group.add(pivot);

  const iron = propMaterial(ironTexture());
  for (const side of [-1, 1]) {
    const chain = solid(new THREE.BoxGeometry(0.02, CHAIN_LENGTH, 0.02), iron);
    chain.position.set(side * (boardW / 2 - 0.08), -CHAIN_LENGTH / 2, 0);
    pivot.add(chain);
  }

  // Board: a box with the painted texture on front and back (+Z and -Z faces)
  // and plain wood on the 4 thin edges. BoxGeometry accepts one material per
  // face, in this order: +X, -X, +Y, -Y, +Z, -Z.
  const painted = propMaterial(sign.texture);
  const edge = propMaterial(wood);
  const board = solid(new THREE.BoxGeometry(boardW, boardH, BOARD_THICKNESS), [
    edge,
    edge,
    edge,
    edge,
    painted,
    painted,
  ]);
  board.position.y = -CHAIN_LENGTH - boardH / 2;
  board.rotation.z = 0.02; // hung a little crooked, nobody's perfect
  pivot.add(board);

  const phase = Math.random() * 10;
  return {
    object: group,
    moving: [pivot], // the board swings: it can't be baked into the static props
    update(time) {
      // Two sines: a slow sway plus a smaller, faster one = irregular gusts.
      const t = time * SWING_SPEED + phase;
      pivot.rotation.x = SWING_ANGLE * (Math.sin(t) + 0.3 * Math.sin(t * 2.7));
    },
  };
}
