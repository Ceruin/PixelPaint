import { h, icon } from './dom.js';
import { bus } from '../core/bus.js';
import { actions } from '../core/actions.js';
import { ZOOM_LEVELS } from '../engine/viewport.js';
import { TOOL_META } from '../tools/index.js';

export function statusbar(app, el, canvas) {
  const zoom = h('button.st-btn', { type: 'button', 'data-tip': 'Fit to screen', 'data-action': 'view.fit', onclick: () => actions.run('view.fit') });
  const zoomStep = (ic, tip, id) => h('button.st-btn', { type: 'button', 'data-tip': tip, 'data-action': id, onclick: () => actions.run(id) }, icon(ic));
  // type a percentage and press Enter; anything unreadable puts the current zoom back
  const zin = h('input.st-zoom', { spellcheck: false, 'data-tip': 'Zoom: type a percentage',
    onfocus: () => zin.select(),
    onkeydown: e => { if (e.key === 'Enter' || e.key === 'Escape') zin.blur(); },
    onchange: () => { const n = parseFloat(zin.value); if (n > 0) app.view.set(n / 100, app.view.rot); showZoom(); } });
  // a zoom slider (log scale, like Krita's) and the view's turn, which resets on click
  const zlo = Math.log(ZOOM_LEVELS[0]), zhi = Math.log(ZOOM_LEVELS.at(-1));
  const zs = h('input.st-zslider', { type: 'range', min: 0, max: 1000, 'aria-label': 'Zoom', 'data-tip': 'Zoom',
    oninput: () => app.view.set(Math.exp(zlo + (zhi - zlo) * zs.value / 1000), app.view.rot) });
  const rot = h('button.st-btn.st-rot', { type: 'button', 'data-tip': 'View rotation: click to reset', 'data-action': 'view.resetRot', onclick: () => actions.run('view.resetRot') }, icon('rotCW'), h('b', { style: { fontWeight: 400 } }));
  // a pixel canvas says so; click to switch it back to painting (or use Image > Pixel Art Canvas)
  const px = h('button.st-px', { type: 'button', 'data-action': 'image.pixelArt', 'data-tip': 'Pixel art canvas: click to make it a painting canvas', onclick: () => actions.run('image.pixelArt') }, 'Pixel');
  // recording a timelapse: a red dot that stops it
  const rec = h('button.st-rec', { type: 'button', hidden: true, 'data-action': 'file.timelapse', 'data-tip': 'Recording a timelapse: click to stop and watch it', onclick: () => actions.run('file.timelapse') }, h('i'), 'Rec');
  const showRec = () => { rec.hidden = !app.timelapse?.recording(); };
  bus.on('timelapse', showRec); bus.on('doc', () => setTimeout(showRec));
  const showZoom = () => { const z = app.view.zoom; zin.value = `${(z * 100).toFixed(z < 0.1 ? 1 : 0)}%`; };
  const t = () => h('b', { style: { fontWeight: 400 } });
  const [st, pt, mt, svt, tt] = [t(), t(), t(), t(), t()];
  zoom.append(icon('fit'));
  el.append(h('span.st-zoomer', {}, zoom, zoomStep('minus', 'Zoom out', 'view.out'), zin, zoomStep('plus', 'Zoom in', 'view.in'), zs), rot, h('span.st-size', {}, icon('image'), st, px), h('span.st-pos', {}, icon('transform'), pt), h('div.spacer'), rec, h('span.st-brush', {}, icon('brush'), tt), h('span.st-mem', {}, icon('history'), mt), h('span.st-save', {}, icon('save'), svt));
  svt.textContent = 'Not saved yet';
  bus.on('view', v => {
    if (document.activeElement !== zin) showZoom();
    if (document.activeElement !== zs) zs.value = Math.round((Math.log(v.zoom) - zlo) / (zhi - zlo) * 1000);
    const r = Math.round((((v.rot % 360) + 540) % 360) - 180), txt = `${r}°`;
    if (rot.lastChild.textContent !== txt) rot.lastChild.textContent = txt;
    rot.classList.toggle('turned', r !== 0);
  });
  bus.on('doc', d => { st.textContent = `${d.w} × ${d.h}`; px.hidden = !d.pixelArt; });
  bus.on('resize', d => { st.textContent = `${d.w} × ${d.h}`; });
  bus.on('history', hist => { mt.textContent = `${(hist.bytes / 2 ** 20).toFixed(0)} MB undo`; });
  // what the current tool paints with: the brush and its size, the pixel pencil's size, or just the tool
  const brushInfo = () => {
    const id = app.tool.id;
    tt.textContent = ['brush', 'eraser', 'smudge'].includes(id) ? `${app.brush.name} · ${app.brush.size}px`
      : id === 'pencil' || id === 'pxshape' ? `${id === 'pencil' ? 'Pixel Pencil' : 'Pixel Shapes'} · ${app.opts.pixelSize}px` : TOOL_META.find(m => m[0] === id)?.[1] ?? '';
  };
  bus.on('opts', brushInfo);
  bus.on('brush', brushInfo); bus.on('tool', brushInfo); brushInfo();
  bus.on('saved', e => { svt.textContent = `${e?.auto ? 'Auto-saved' : 'Saved'} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; });
  // Never cut off: drop the least important readouts until the rest fits (text can be enlarged).
  const order = ['.st-zslider', '.st-rot', '.st-pos', '.st-mem', '.st-brush', '.st-size'].map(q => el.querySelector(q));
  let fitting = 0;
  const fit = () => {
    fitting = 0;
    el.classList.add('measuring');            // measure the save label at its full width
    order.forEach(n => { n.hidden = false; });
    for (const n of order) if (el.scrollWidth > el.clientWidth + 1) n.hidden = true;
    el.classList.remove('measuring');
  };
  const refit = () => { fitting ||= requestAnimationFrame(fit); };
  new ResizeObserver(refit).observe(el);
  ['saved', 'brush', 'tool', 'doc', 'history'].forEach(ev => bus.on(ev, refit));
  let zr = '';   // panning changes the view every frame but not the zoom readout: re-fit (layout reads) only when it does
  bus.on('view', v => { const k = `${v.zoom}|${v.rot}`; if (k !== zr) { zr = k; refit(); } });
  // Cursor position: at most once per frame, from the input's cached canvas rect (no layout reads).
  let last = null, raf = 0;
  canvas.addEventListener('pointermove', e => {
    last = e;
    raf ||= requestAnimationFrame(() => {
      raf = 0;
      const r = app.input.rect, p = app.view.toDoc(last.clientX - r.left, last.clientY - r.top), s = `${Math.floor(p.x)}, ${Math.floor(p.y)}`;
      if (pt.textContent !== s) pt.textContent = s;
    });
  }, { passive: true });
}
