// The game's fonts, files in public/fonts/ (licenses in CREDITS.md).
//
// Same thing as an @font-face rule in CSS, written in JS with the FontFace API:
// this way the path is built with BASE_URL, like every other file in public/
// (the site may live in a sub-folder), and the download starts right away.
// Once added, the CSS can use it by name: font-family: 'Rye'.

/** Rye: western wood type, the one on "wanted" posters. Used by the style meter. */
const rye = new FontFace('Rye', `url(${import.meta.env.BASE_URL}fonts/Rye-Regular.ttf)`);
document.fonts.add(rye);
// Start the download now: the browser would otherwise wait until some text
// actually needs it, and the first rank letter would pop in with Georgia.
rye.load().catch((err) => console.warn('Font Rye not loaded:', err));
