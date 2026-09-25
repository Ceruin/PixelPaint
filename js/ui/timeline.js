import { h, icon, iconBtn, select } from './dom.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';
import { actions } from '../core/actions.js';
import { DIRECTIONS } from '../engine/animation.js';
import { form } from './dialogs.js';

// Animation timeline (after Aseprite): transport, frame durations, onion skin, tags strip and
// a layers × frames cel grid. Collapses to a one-line summary like the Pixel editor's.
export function initTimeline(app, el) {
  const doc = () => app.doc;
  let collapsed = local.get('pp.tlCollapsed', true), range = null;
  const bar = h('div.tl-bar'), body = h('div.tl-body');
  el.append(bar, body);
  const act = (id, ic, tip) => iconBtn(ic, tip, () => actions.run(id), { 'data-action': id });

  const renderBar = () => {
    const d = doc(), n = d.frames.length, o = app.opts, playing = app.player.playing;
    const dur = h('input.tl-num', { type: 'number', min: 10, max: 10000, step: 10, value: d.frames[d.frame].duration, 'data-tip': 'Frame duration (ms) — Shift+Enter applies to all frames' });
    dur.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') d.setDuration(Math.max(10, +dur.value || 100), e.shiftKey); });
    dur.addEventListener('change', () => d.setDuration(Math.max(10, +dur.value || 100)));
    const onion = iconBtn('onion', 'Onion skin (F3)', () => actions.run('anim.onion'), { className: o.onion ? 'on' : '' });
    bar.replaceChildren(
      h('button.tl-toggle', { type: 'button', onclick: () => { collapsed = !collapsed; local.set('pp.tlCollapsed', collapsed); render(); } },
        icon(collapsed ? 'chevronRight' : 'chevron'), icon('film'), h('span', {}, `Animation · ${n} frame${n > 1 ? 's' : ''}`)),
      ...(collapsed ? [] : [
        h('span.tl-sep'),
        act('anim.first', 'first', 'First frame'), act('anim.prev', 'chevronLeft', 'Previous frame'),
        iconBtn(playing ? 'pause' : 'play', playing ? 'Pause' : 'Play', () => actions.run('anim.play'), { 'data-action': 'anim.play', className: playing ? 'on' : '' }),
        act('anim.next', 'chevronRight', 'Next frame'), act('anim.last', 'last', 'Last frame'),
        h('span.tl-pos', {}, `${d.frame + 1} / ${n}`),
        h('label.inline', {}, icon('history'), dur, 'ms'),
        select(DIRECTIONS, o.playDir, v => app.setOpt('playDir', v), { 'data-tip': 'Playback direction' }),
        h('span.tl-sep'), onion,
        o.onion && select([[1, '±1'], [2, '±2'], [3, '±3']], o.onionPrev, v => { app.setOpt('onionPrev', +v); app.setOpt('onionNext', +v); }, { 'data-tip': 'Onion skin frames' }),
        h('span.tl-sep'),
        act('anim.newFrame', 'plus', 'New frame'), act('anim.dupFrame', 'copy', 'Duplicate frame'),
        act('anim.delFrame', 'trash', 'Delete frame'), act('anim.clearCel', 'eraser', 'Blank cel'), act('anim.holdCel', 'last', 'Hold previous cel'),
        act('anim.tag', 'tag', 'New tag from selected frames (Shift+click frame numbers)'),
        h('span.spacer'),
        act('anim.import', 'upload', 'Import image sequence as frames'),
        h('button.btn.sm', { type: 'button', 'data-action': 'anim.export', onclick: () => actions.run('anim.export') }, icon('download'), 'Export'),
      ].filter(Boolean)));
  };

  const rows = () => {
    const out = [];
    const walk = (g, depth) => { for (let i = g.children.length - 1; i >= 0; i--) { const n = g.children[i]; out.push({ n, depth }); if (n.type === 'group' && !n.collapsed) walk(n, depth + 1); } };
    walk(doc().root, 0);
    return out;
  };

  const renderGrid = () => {
    const d = doc(), N = d.frames.length, inRange = f => range && f >= Math.min(range.a, range.b) && f <= Math.max(range.a, range.b);
    const grid = h('div.tl-grid', { style: { gridTemplateColumns: `180px repeat(${N}, 30px)` } });
    grid.append(h('div.tl-name.tl-head', { style: { gridRow: 1 } }, icon('tag'), 'Tags'));
    d.tags.forEach((t, i) => grid.append(h('button.tl-tag', {
      type: 'button', className: app.player.tag === i ? 'on' : '', 'data-tip': `${t.name} (${DIRECTIONS.find(x => x[0] === t.dir)?.[1]}) — click to loop, double-click to edit`,
      style: { gridRow: 1, gridColumn: `${t.from + 2} / ${t.to + 3}`, '--c': t.color },
      onclick: () => { app.player.tag = app.player.tag === i ? -1 : i; render(); },
      ondblclick: () => editTag(i),
    }, t.name)));
    grid.append(h('div.tl-name.tl-head', { style: { gridRow: 2 } }, icon('film'), 'Frames'));
    for (let f = 0; f < N; f++) {
      const hd = h('div.tl-frame', { className: [f === d.frame && 'on', inRange(f) && 'sel'].filter(Boolean).join(' '), style: { gridRow: 2 }, 'data-tip': `Frame ${f + 1} · ${d.frames[f].duration} ms — drag to reorder, Shift+click to select range` }, String(f + 1));
      hd.addEventListener('pointerdown', e => frameDrag(f, e));
      grid.append(hd);
    }
    rows().forEach(({ n, depth }, r) => {
      const row = r + 3, active = n === d.active;
      grid.append(h('div.tl-name', { className: active ? 'on' : '', style: { gridRow: row, paddingLeft: `${6 + depth * 12}px` }, onclick: () => d.setActive(n) },
        icon(n.type === 'group' ? 'folder' : n.type === 'filter' ? 'sparkle' : 'layers'), h('span', {}, n.name)));
      for (let f = 0; f < N; f++) {
        const k = n.type === 'layer' ? n.cels[f] : null, kind = k ? 'key' : k === 0 ? 'blank' : n.type === 'layer' && n.view(f) ? 'hold' : '';
        grid.append(h('div.tl-cel', {
          className: [f === d.frame && 'col', active && 'row', f === d.frame && active && 'on', inRange(f) && 'sel'].filter(Boolean).join(' '),
          style: { gridRow: row },
          onclick: () => { app.player.stop(); d.setFrame(f); if (d.active !== n) d.setActive(n); },
        }, kind && h('i', { className: kind })));
      }
    });
    body.replaceChildren(grid);
    grid.querySelector('.tl-frame.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  // Click selects; Shift+click extends a range (for tags); drag moves the frame.
  const frameDrag = (f, e) => {
    const d = doc();
    if (e.shiftKey) { range = { a: range?.a ?? d.frame, b: f }; render(); return; }
    range = null;
    let to = f;
    const move = ev => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-frame');
      if (!hit) return;
      to = [...body.querySelectorAll('.tl-frame')].indexOf(hit);
      body.querySelectorAll('.tl-frame').forEach((x, i) => x.classList.toggle('drop', i === to && to !== f));
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      app.player.stop();
      if (to !== f) d.moveFrame(f, to); else { d.setFrame(f); render(); }
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const editTag = async i => {
    const d = doc(), t = d.tags[i], N = d.frames.length;
    const v = await form('Tag', [
      { id: 'name', label: 'Name', type: 'text', value: t.name },
      { id: 'from', label: 'From frame', value: t.from + 1, min: 1, max: N },
      { id: 'to', label: 'To frame', value: t.to + 1, min: 1, max: N },
      { id: 'dir', label: 'Direction', type: 'select', options: DIRECTIONS, value: t.dir },
      { id: 'color', label: 'Color', type: 'color', value: t.color },
      { id: 'del', label: 'Delete this tag', type: 'checkbox', value: false },
    ], 'Save');
    if (!v) return;
    if (v.del) { if (app.player.tag === i) app.player.tag = -1; return d.removeTag(i); }
    const a = Math.max(0, Math.min(N - 1, v.from - 1)), b = Math.max(0, Math.min(N - 1, v.to - 1));
    d.editTag(i, { name: v.name || t.name, from: Math.min(a, b), to: Math.max(a, b), dir: v.dir, color: v.color });
  };

  const render = () => {
    el.classList.toggle('collapsed', collapsed);
    renderBar();
    if (!collapsed) renderGrid();
  };
  let raf = 0;
  const soon = () => { raf ||= requestAnimationFrame(() => { raf = 0; render(); }); };
  ['frames', 'frame', 'layers', 'history', 'play', 'opts', 'doc'].forEach(ev => bus.on(ev, soon));
  bus.on('doc', d => { if (d.frames.length > 1 && collapsed) { collapsed = false; soon(); } });
  return { tagRange: () => (range ? [Math.min(range.a, range.b), Math.max(range.a, range.b)] : null), expand: () => { collapsed = false; local.set('pp.tlCollapsed', false); render(); } };
}
