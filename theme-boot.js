// Runs synchronously in <head>, before anything is painted.
//
// The theme (and the other look-and-feel preferences) live in the database and
// are only known once app.js has logged in and read them back. Painting the
// page in the default dark theme first and switching to light mode afterwards
// made every page load flash. So:
//
//   1. app.js leaves a small hint cookie ("sar-ui-hint") with the theme it
//      last applied for this login. It is read here so the very first paint is
//      already in the right theme. It holds no data - only "light"/"dark" and
//      whether Geek Mode was on - and app.js overwrites it on every load.
//   2. Until app.js has applied the preferences read from the server the page
//      sits under an 80% overlay (dark or light, matching the hint) with a
//      spinner, see html.sar-booting in styles.css. app.js removes the class
//      in finishPageBoot(); a timer below is the fail-safe so a page never
//      stays covered if the script fails to load.
(function () {
    var html = document.documentElement;
    if (!html || !html.classList) return;

    var hint = '';
    try {
        var match = document.cookie.match(/(?:^|;\s*)sar-ui-hint=([^;]*)/);
        hint = match ? decodeURIComponent(match[1]) : '';
    } catch (e) { /* no cookie access: default dark */ }

    var flags = hint.split(',');
    if (flags.indexOf('light') !== -1) html.classList.add('light-mode');
    if (flags.indexOf('geek') !== -1) html.classList.add('geek-mode');

    html.classList.add('sar-booting');
    window.setTimeout(function () {
        html.classList.remove('sar-booting');
        html.classList.remove('sar-boot-done');
    }, 15000);
})();
