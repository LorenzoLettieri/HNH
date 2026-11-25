// The loading screen (#loading in index.html): a burning fuse while the game
// gets ready, then it fades out and shows the menu under it.
//
// The screen itself is plain HTML, so it shows the moment the page opens,
// even before this file is downloaded. Here we only move the fuse and write
// what we're doing.
//
// Why `await` between the steps: JavaScript and drawing share ONE thread.
// While main.ts builds the level, the browser can't repaint, so a progress
// bar updated in the middle of synchronous code would never move. Awaiting
// a frame hands the thread back to the browser for a moment: it paints the
// new state of the bar, then the loading goes on. (Same reason a long loop
// freezes a web page.)

const screen = document.getElementById('loading')!;
const stepText = document.getElementById('loading-step')!;

/** Resolves once the browser has painted: a frame (requestAnimationFrame), then right after it. */
function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

/**
 * Starts a step of the loading: the fuse burns to `progress` (0..1, how much
 * is done when this step starts) and the label says what's happening.
 * Await it, so the screen is painted before the (blocking) work of the step.
 */
export async function loadingStep(progress: number, label: string): Promise<void> {
  screen.style.setProperty('--progress', String(progress));
  stepText.textContent = label;
  await painted();
}

/** Everything is ready: the fuse burns to the end and the screen fades out (CSS transition). */
export function finishLoading(): void {
  screen.style.setProperty('--progress', '1');
  stepText.textContent = 'Pronto';
  screen.classList.add('done');
  // Once faded out it's gone for good: out of the page (and of the way of clicks).
  // (The fuse's own transitions bubble up here too: only the screen's fade counts.)
  screen.addEventListener('transitionend', (e) => {
    if (e.target === screen) screen.remove();
  });
}
