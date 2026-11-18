// All the levels, by name. Pick one with ?level=<name> in the URL.
import type { World } from '../sim/world';
import { testArena } from './testArena';
import { town } from './town';

export const LEVELS: Record<string, World> = {
  town,
  arena: testArena,
};

export const DEFAULT_LEVEL = 'town';
