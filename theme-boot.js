// Runs synchronously in <head>, as the FIRST thing on the page - before the
// stylesheet is even requested - so nothing has been painted yet.
//
// The theme (and the other look-and-feel preferences) live in the database and
// are only known once app.js has logged in and read them back. Painting the
// page in the default dark theme first and switching to light mode afterwards
// (or the browser's white canvas first and dark afterwards) made every page
// load flash. So:
//
//   1. app.js leaves a small hint cookie ("sar-ui-hint") with the theme it
//      last applied for this login. It is read here so the very first paint is
//      already in the right theme. It holds no data - only "light"/"dark",
//      whether Geek Mode was on and its padding reduction ("pad67") - and
//      app.js overwrites it on every load.
//   2. The canvas colour, the overlay and the spinner are injected here as an
//      inline <style>, so they apply even while styles.css is still on its way
//      (a stylesheet loaded later would otherwise leave a white or dark flash),
//      and a stale cached styles.css can never hide them.
//   3. Until app.js has applied the preferences read from the server the page
//      sits under an 80% overlay (dark or light, matching the hint) with a
//      spinner. app.js removes the class in finishPageBoot(); a timer below is
//      the fail-safe so a page never stays covered if the script fails to load.
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
    if (flags.indexOf('geek') !== -1) {
        html.classList.add('geek-mode');
        // "pad<percent>": how much Geek Mode takes off every padding. Written
        // as the --space-scale factor app.js will set again (applyGeekMode),
        // so the compact layout is already right on the first paint.
        for (var i = 0; i < flags.length; i++) {
            var pad = /^pad(\d{1,3})$/.exec(flags[i]);
            if (pad && html.style && html.style.setProperty) {
                var percent = Math.min(100, Math.max(0, parseInt(pad[1], 10)));
                html.style.setProperty('--geek-space-scale', String(Math.round((100 - percent) * 10) / 1000));
            }
        }
    }

    // Critical CSS: the page's own canvas colour per theme (what shows before
    // styles.css has arrived) and the boot overlay + spinner. Kept here, not in
    // styles.css, so it is in force from the first paint. The colours match the
    // dark / light palettes in styles.css (--glass-strong base, --text base).
    var css = [
        'html { background: #071022; color-scheme: dark; }',
        'html.light-mode { background: #f4f7fb; color-scheme: light; }',
        'html.sar-booting::before, html.sar-booting::after { content: ""; position: fixed; pointer-events: none; transition: opacity 0.28s ease; }',
        'html.sar-booting::before { top: 0; right: 0; bottom: 0; left: 0; z-index: 100000; background: rgba(7, 16, 34, 0.8); pointer-events: auto; }',
        'html.sar-booting.light-mode::before { background: rgba(244, 247, 251, 0.8); }',
        'html.sar-booting::after { top: 50%; left: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; border: 4px solid rgba(255, 255, 255, 0.22); border-top-color: var(--accent, #7dc6ff); z-index: 100001; animation: sar-boot-spin 0.85s linear infinite; }',
        'html.sar-booting.light-mode::after { border-color: rgba(26, 34, 48, 0.16); border-top-color: var(--accent, #1f6fb8); }',
        'html.sar-booting.sar-boot-done::before, html.sar-booting.sar-boot-done::after { opacity: 0; pointer-events: none; }',
        '@keyframes sar-boot-spin { to { transform: rotate(360deg); } }'
    ].join('\n');
    try {
        var style = document.createElement('style');
        style.id = 'sar-boot-style';
        style.textContent = css;
        var parent = document.head || html;
        // Placed before this script, i.e. ahead of every stylesheet that follows.
        var here = document.currentScript;
        if (here && here.parentNode === parent) parent.insertBefore(style, here);
        else parent.appendChild(style);
    } catch (e) { /* no DOM: styles.css still carries the theme palette */ }

    html.classList.add('sar-booting');
    window.setTimeout(function () {
        html.classList.remove('sar-booting');
        html.classList.remove('sar-boot-done');
    }, 15000);
})();
