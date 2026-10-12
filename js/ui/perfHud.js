// Frame monitor, on with ?perf in the address: frame rate, slow frames, and what ran in each one
// (Chrome's Long Animation Frames timing), with a report to copy. For hitches that only show on a
// real screen and GPU.
export function perfHud(app) {
  const slow = [], gaps = [], t0 = performance.now();
  let frames = [], last = performance.now();
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;bottom:34px;z-index:5000;font:11px/1.35 monospace;background:#000c;color:#e2e2e2;padding:6px 8px;border-radius:4px;pointer-events:auto;white-space:pre';
  const txt = document.createElement('div'), btn = document.createElement('button');
  btn.textContent = 'Copy report'; btn.style.cssText = 'margin-top:4px;font:inherit;cursor:pointer';
  el.append(txt, btn); document.body.append(el);
  const ctx = () => ({ stroke: app.input?.active != null, tool: app.tool?.id, zoom: +app.view.zoom.toFixed(2) });
  const tick = now => {
    const d = now - last; last = now; frames.push(d);
    if (frames.length > 600) frames.shift();
    const med = [...frames].sort((a, b) => a - b)[frames.length >> 1] || 16.7;
    if (frames.length > 30 && d > med * 1.5) { gaps.push({ at: Math.round(now - t0), ms: +d.toFixed(1), ...ctx() }); if (gaps.length > 80) gaps.shift(); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver(list => list.getEntries().forEach(e => {
      slow.push({ at: Math.round(e.startTime - t0), ms: Math.round(e.duration), blocking: Math.round(e.blockingDuration ?? 0),
        render: Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), ...ctx(),
        scripts: (e.scripts ?? []).map(s => `${Math.round(s.duration)}ms ${s.invoker} ${s.sourceFunctionName || ''} ${(s.sourceURL || '').split('/').pop()}:${s.sourceCharPosition}`) });
      if (slow.length > 60) slow.shift();
    })).observe({ type: 'long-animation-frame', buffered: false });
  } catch { slow.push({ note: 'long-animation-frame timing not supported in this browser' }); }
  setInterval(() => {
    const s = [...frames].sort((a, b) => a - b), med = s[s.length >> 1] || 0;
    txt.textContent = `${med ? Math.round(1000 / med) : 0} Hz  worst ${Math.round(s.at(-1) || 0)}ms\nhitches ${gaps.length}  long frames ${slow.length}`;
  }, 500);
  btn.onclick = () => {
    const s = [...frames].sort((a, b) => a - b), d = app.doc;
    const report = JSON.stringify({ ua: navigator.userAgent, dpr: devicePixelRatio, screen: `${screen.width}x${screen.height}`, hz: Math.round(1000 / (s[s.length >> 1] || 16.7)),
      doc: `${d.w}x${d.h}`, layers: d.layers?.length ?? null, brush: app.brush?.size, gaps, slow }, null, 1);
    navigator.clipboard.writeText(report).then(() => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy report'; }, 1500); }, () => console.log(report));
  };
}
