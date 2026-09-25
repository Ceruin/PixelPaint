import { h } from './dom.js';
import { bus } from '../core/bus.js';

// E-ink simulation for the E-ink theme (after williamchong/e-ink-sim): the whole app — Draw, Notes
// and Pixel — shown in 16 grey levels with e-ink contrast and a faint paper grain, the canvas and
// animations refreshed at ~12 Hz, and the black/white flash of a full refresh on big changes (a
// workspace switch, a new canvas, every 24 strokes). Toggle it in View; a real e-ink tablet
// doesn't need it.
const HZ = 12, STROKES_PER_FLASH = 24;
const levels = Array.from({ length: 16 }, (_, i) => (i / 15).toFixed(3)).join(' ');

export function initEink(app, mascot) {
  document.body.append(h('div', { innerHTML: `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="eink" color-interpolation-filters="sRGB">
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncR type="discrete" tableValues="${levels}"/><feFuncG type="discrete" tableValues="${levels}"/><feFuncB type="discrete" tableValues="${levels}"/></feComponentTransfer>
  </filter></svg>` }).firstChild);
  const flashEl = h('div.eink-flash');
  let strokes = 0, on = false;
  const flash = () => {
    if (!on) return;
    flashEl.remove(); flashEl.classList.remove('go');
    document.body.append(flashEl);
    void flashEl.offsetWidth;   // restart the animation
    flashEl.classList.add('go');
  };
  const apply = () => {
    const was = on;
    on = document.body.dataset.theme === 'paper' && app.settings.einkSim !== false;
    document.documentElement.classList.toggle('eink-sim', on);
    const ms = on ? 1000 / HZ : 0;
    app.view.minFrame = ms; mascot.minFrame = ms;
    if (on && !was) flash();
  };
  bus.on('theme', apply);
  bus.on('eink', apply);
  bus.on('mode', flash);
  bus.on('doc', flash);
  bus.on('history', () => { if (on && ++strokes % STROKES_PER_FLASH === 0) flash(); });
  apply();
  return { flash };
}
