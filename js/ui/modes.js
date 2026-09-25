import { h, icon } from './dom.js';

// One switch shared by every mode (and mirrored in the Pixel editor's top bar).
export const MODES = [
  ['paint', 'Paint', 'brush', 'Alt+1'], ['zen', 'Zen', 'zen', 'Alt+2'], ['notes', 'Notes', 'note', 'Alt+3'],
  ['paper', 'Paper', 'paper', 'Alt+4'], ['pixel', 'Pixel', 'pixel', 'Alt+5'],
];

export function modeSwitch(current, onPick) {
  return h('div.mode-switch', { role: 'tablist' }, MODES.map(([id, label, ic]) =>
    h('button.mode-btn', { type: 'button', role: 'tab', className: id === current ? 'on' : '', 'data-tip': `${label} mode`, 'data-action': `mode.${id}`, onclick: () => onPick(id) },
      icon(ic), h('span', {}, label))));
}
