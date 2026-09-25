import { h } from './dom.js';
import { bus } from '../core/bus.js';

export function historyPanel(app) {
  const list = h('div.history-list');
  let raf = 0;
  const render = () => {
    raf = 0;
    const hist = app.doc.history, n = hist.done.length;
    const items = [['Open', 0], ...hist.done.map((c, i) => [c.label, i + 1]), ...[...hist.undone].reverse().map((c, i) => [c.label, n + i + 1])];
    list.replaceChildren(...items.map(([label, k]) => h('button.hist-row', {
      type: 'button', className: k === n ? 'on' : k > n ? 'future' : '',
      onclick: () => { app.tool.interrupt?.(); hist.jump(k); },
    }, label)));
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };
  bus.on('history', () => { raf ||= requestAnimationFrame(render); });
  return list;
}
