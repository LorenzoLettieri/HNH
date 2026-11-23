// A random western name for players who didn't choose one ("Randy Coffin").
// Drawn once and saved in the settings (settings.ts): the leaderboard groups
// games by name, so a name that changed every game would scatter your scores
// over many rows.
//
// First name × surname: with 50 × 50 the game can hand out 2500 names. Two
// players can still get the same one (then they share a leaderboard row), but
// among friends it's unlikely: with n players the chance is about n² / (2 × 2500),
// ~2% with 10 players (the "birthday paradox": collisions come much sooner than
// you'd guess, because every PAIR of players is a chance to collide).
// To add names, just add them to the lists.
import { NAME_MAX_LENGTH } from './leaderboard';

const FIRST_NAMES = [
  'Randy', 'Albert', 'Jesse', 'Wyatt', 'Doc', 'Billy', 'Clint', 'Silas', 'Ezekiel', 'Amos',
  'Virgil', 'Cletus', 'Earl', 'Hank', 'Buck', 'Cyrus', 'Elmer', 'Otis', 'Rufus', 'Walter',
  'Floyd', 'Harold', 'Boone', 'Calvin', 'Dusty', 'Jasper', 'Luther', 'Mortimer', 'Abe', 'Ike',
  'Nate', 'Wade', 'Zeke', 'Bart', 'Gus', 'Lefty', 'Jeb', 'Roscoe', 'Tobias', 'Homer',
  'Clem', 'Waylon', 'Eli', 'Percy', 'Hiram', 'Ned', 'Chester', 'Mabel', 'Edna', 'Annie',
];

const SURNAMES = [
  'McGraw', 'Callahan', 'Dalton', 'Holloway', 'Blackwood', 'Grimes', 'Graves', 'Coffin', 'Crowe', 'Bishop',
  'Thorne', 'Ashby', 'Cassidy', 'Hatch', 'Mercer', 'Pike', 'Slade', 'Stone', 'Vance', 'Whitlock',
  'Brimstone', 'Gallows', 'Cinder', 'Marrow', 'Bones', 'Hellman', 'Kettle', 'Redd', 'Burns', 'Moss',
  'Tombs', 'Skinner', 'Hawke', 'Colt', 'Barlow', 'Gunn', 'Rattler', 'Mudd', 'Buzzard', 'Sawyer',
  'Lockjaw', 'Doyle', 'Duggan', 'Crane', 'Pickett', 'Wolfe', 'Ruckus', 'Tumbleweed', 'Spurr', 'Dredd',
];

function pick<T>(list: readonly T[]): T {
  // Math.random is fine here: this is not the simulation (no seed to replay).
  return list[Math.floor(Math.random() * list.length)];
}

/** A random "First Surname" that fits the leaderboard (NAME_MAX_LENGTH). */
export function randomName(): string {
  // Some pairs are too long ("Mortimer Tumbleweed" = 19): draw again.
  // Most pairs fit, so this loops only a couple of times at worst.
  for (;;) {
    const name = `${pick(FIRST_NAMES)} ${pick(SURNAMES)}`;
    if (name.length <= NAME_MAX_LENGTH) return name;
  }
}
