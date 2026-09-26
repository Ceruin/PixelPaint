import { h, icon, iconBtn } from './dom.js';
import { actions } from '../core/actions.js';

// Two workspaces: Draw (painting and pixel art — pixel tools, sprite sheets and frames live there) and
// Notes. Focus (full screen, what Zen used to be) and the theme (Dark / Light / E-ink) are toggles.
// The classic pixel editor lives on as Sprite Studio (tiles, voxels, .aseprite), opened from Draw.
export const MODES = [['paint', 'Draw', 'brush', 'Alt+1'], ['notes', 'Notes', 'note', 'Alt+2']];
export const THEMES = [['dark', 'Dark', 'zen'], ['light', 'Light', 'sun'], ['paper', 'E-ink', 'paper']];
// Old saved modes → workspace + toggle.
export const LEGACY = { zen: { mode: 'paint', focus: true }, paper: { mode: 'paint', theme: 'paper' } };

export function modeSwitch(current, { focus, theme }) {
  const [, tLabel, tIcon] = THEMES.find(t => t[0] === theme) ?? THEMES[0];
  return h('div.mode-bar', {},
    h('div.mode-switch', { role: 'tablist' }, MODES.map(([id, label, ic]) =>
      h('button.mode-btn', { type: 'button', role: 'tab', className: id === current ? 'on' : '', 'data-tip': `${label} workspace`, 'data-action': `mode.${id}`, onclick: () => actions.run(`mode.${id}`) },
        icon(ic), h('span', {}, label)))),
    current === 'paint' && iconBtn('folder', 'My Art: your saved drawings (Ctrl+Shift+O)', () => actions.run('file.library'), { 'data-action': 'file.library' }),
    current !== 'pixel' && iconBtn('expand', 'Focus: full-screen canvas', () => actions.run('view.focus'), { className: `ibtn${focus ? ' on' : ''}`, 'data-action': 'view.focus' }),
    iconBtn(tIcon, `Theme: ${tLabel} (click for the next)`, () => actions.run('view.theme'), { 'data-action': 'view.theme' }));
}
