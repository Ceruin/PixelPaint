// Pseudo-3D and the 3D Voxel Studio, moved here from Sprite Studio (js/pixel/editor.js) unchanged
// apart from this header: it gives the moved code the few things it used from Sprite Studio — the
// current picture and its frames, the paint colour, toasts and a modal — from Draw's document, and
// bakes results into a new Draw canvas. Image > Pseudo-3D… and Image > 3D Voxel Studio… open them.
import { hexToRgb, rgbToHex } from '../core/color.js';
import { makeCanvas } from '../core/util.js';
import { flatten } from '../engine/compositor.js';
import { Doc } from '../engine/document.js';
import { bus } from '../core/bus.js';

let app = null, root = null, modalResolve = null;
let W = 1, H = 1, flat = null, frames = [], primary = '#000000';
const $ = s => root?.querySelector(s);
const PX = { querySelectorAll: s => root?.querySelectorAll(s) ?? [] };
const canvasOf = (w, h) => makeCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const showToast = msg => app.toast(msg);
const normHex = v => { const m = String(v).trim().match(/^#?([0-9a-f]{6})$/i); return m ? `#${m[1].toLowerCase()}` : null; };
const hydrateIcons = () => {};
const spriteBaseName = () => app.doc.name || 'sprite';
const compositeFrameInto = (ctx, fr) => ctx.drawImage(fr.canvas, 0, 0);
// what the dialogs read: the current frame flattened, and every frame (for the back / side views)
function readDoc() {
  const d = app.doc;
  W = d.w; H = d.h; primary = app.color.fg;
  frames = d.frames.map((_, i) => ({ canvas: flatten(d, i, { camera: false }) }));
  flat = frames[d.frame].canvas;
}
function openModal(o) {
  return new Promise(resolve => {
    modalResolve = resolve;
    const done = v => closeModal(v);
    root = document.createElement('div');
    root.className = 'modal-back vox-modal-back';
    root.innerHTML = `<div class="modal vox-modal${o.wide ? ' wide' : ''}"><h3></h3><p class="muted vox-msg"></p><div class="modal-body" id="modalBody"></div><div class="modal-foot"><button type="button" class="btn" data-v="0">Cancel</button><button type="button" class="btn primary" data-v="1"></button></div></div>`;
    root.querySelector('h3').textContent = o.title || '';
    root.querySelector('.vox-msg').textContent = o.message || '';
    root.querySelector('#modalBody').innerHTML = o.bodyHTML || '';
    root.querySelector('[data-v="1"]').textContent = o.okText || 'OK';
    root.querySelectorAll('.modal-foot button').forEach(b => { b.onclick = () => done(b.dataset.v === '1'); });
    root.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); });
    document.body.append(root);
  });
}
function closeModal(result) {
  if (!root) return;
  root.remove(); root = null;
  const r = modalResolve; modalResolve = null;
  r?.(result);
}
// a bake: one frame per view, in a new pixel canvas
function bakeFrames(views, name, dur) {
  const OUT = views[0].width, d = new Doc(OUT, OUT, { bg: null });
  d.layers[0].name = 'Sprite';
  d.frames = views.map(() => ({ duration: dur || 120 }));
  const l = d.layers[0];
  views.forEach((v, i) => { const c = l.cel(i, true).getContext('2d'); c.imageSmoothingEnabled = false; c.drawImage(v, 0, 0); });
  Object.assign(d, { name, frame: 0 });
  d.pixelArt = true;
  app.setDoc(d); app.setTool('pencil');
}

export function initVoxels(a) { app = a; bus.on('color', () => { primary = app.color.fg; }); }
export function pseudo3D() { readDoc(); return showVoxelDialog(); }
export function voxelStudio() { readDoc(); return openStudioFromSprite(); }

// ------------------------------------------------------------------ pseudo-3D: front+back → voxels → 8 directions
// Extrudes a front and back sprite into a rough voxel volume you can spin, then bakes 8 facings.
// The outline is treated as a 2D convention, not geometry: it's kept on the front/back faces but never
// packed through the depth (which would smear it into a black slab along the sides), and a clean 1px
// outline is redrawn around the rendered silhouette instead — so edges stay sharp from any angle.
let vx={front:null, back:null, side:null, mode:"round", model:null, yaw:32, pitch:0,
        outline:[0,0,0], useOutline:true, reoutline:true, mirror:true, depth:12};
function imgDataOf(cv){ return cv.getContext("2d").getImageData(0,0,cv.width,cv.height); }
function vxIsOutline(r,g,b,a){ if(!vx.useOutline||a<8) return false; const o=vx.outline;
  return Math.abs(r-o[0])+Math.abs(g-o[1])+Math.abs(b-o[2])<=40; }
// prepare the back as an ImageData the size of the front (resized, optionally mirrored). null src -> front mirrored.
function setVoxBack(srcCanvas){
  if(!vx.front) return;
  const W=vx.front.width, H=vx.front.height, c=canvasOf(W,H), x=c.getContext("2d"); x.imageSmoothingEnabled=false;
  x.save();
  if(vx.mirror){ x.translate(W,0); x.scale(-1,1); }
  if(srcCanvas){ x.drawImage(srcCanvas,0,0,W,H); }
  else { const f=canvasOf(W,H); f.getContext("2d").putImageData(vx.front,0,0); x.drawImage(f,0,0); }  // reuse the front
  x.restore();
  vx.back=imgDataOf(c);
}
// A copy of an image with outline pixels flooded over by neighbouring body colour, so the volume can
// be built from clean colour. Only opaque (outline) pixels are filled — transparent stays transparent.
function vxDeoutline(data,W,H){
  const out=new Uint8ClampedArray(data), work=new Uint8Array(W*H);
  for(let i=0;i<W*H;i++){ const a=data[i*4+3]; work[i]=(a>=8 && !vxIsOutline(data[i*4],data[i*4+1],data[i*4+2],a))?1:0; }
  for(let it=0; it<8; it++){ let changed=false;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=y*W+x; if(work[i]) continue; if(data[i*4+3]<8) continue;
      let r=0,g=0,b=0,n=0;
      if(x>0&&work[i-1]){ r+=out[(i-1)*4];g+=out[(i-1)*4+1];b+=out[(i-1)*4+2];n++; }
      if(x<W-1&&work[i+1]){ r+=out[(i+1)*4];g+=out[(i+1)*4+1];b+=out[(i+1)*4+2];n++; }
      if(y>0&&work[i-W]){ r+=out[(i-W)*4];g+=out[(i-W)*4+1];b+=out[(i-W)*4+2];n++; }
      if(y<H-1&&work[i+W]){ r+=out[(i+W)*4];g+=out[(i+W)*4+1];b+=out[(i+W)*4+2];n++; }
      if(n){ out[i*4]=r/n; out[i*4+1]=g/n; out[i*4+2]=b/n; out[i*4+3]=255; work[i]=1; changed=true; }
    }
    if(!changed) break;
  }
  return out;
}
// distance from each masked pixel to the nearest edge (chamfer 3-4 style) — used to inflate the body
function vxDistanceTransform(mask,W,H){
  const d=new Float32Array(W*H); for(let i=0;i<W*H;i++) d[i]=mask[i]?1e6:0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const i=y*W+x; if(!mask[i]) continue; let v=d[i];
    if(x>0) v=Math.min(v,d[i-1]+1); if(y>0) v=Math.min(v,d[i-W]+1);
    if(x>0&&y>0) v=Math.min(v,d[i-W-1]+1.414); if(x<W-1&&y>0) v=Math.min(v,d[i-W+1]+1.414); d[i]=v; }
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){ const i=y*W+x; if(!mask[i]) continue; let v=d[i];
    if(x<W-1) v=Math.min(v,d[i+1]+1); if(y<H-1) v=Math.min(v,d[i+W]+1);
    if(x<W-1&&y<H-1) v=Math.min(v,d[i+W+1]+1.414); if(x>0&&y<H-1) v=Math.min(v,d[i+W-1]+1.414); d[i]=v; }
  return d;
}
// Modes: "flat" — straight front→back extrusion (a slab). "round" — inflate the silhouette by its
// distance to the edge, so cross-sections bulge instead of being a slab (a best guess with no side).
// "side" — carve the volume against a side profile you draw/pick (front ∩ side), a real visual hull.
function buildVoxels(){
  const F=vx.front; if(!F) return null;
  const W=F.width, H=F.height, fd=F.data, B=vx.back, bd=B?B.data:fd;
  const dF=vxDeoutline(fd,W,H), dB=vxDeoutline(bd,W,H);
  const pack=(r,g,b)=> ((r&255)|((g&255)<<8)|((b&255)<<16)|(255<<24))>>>0;
  const opaque=(d,x,y)=> x>=0&&y>=0&&x<W&&y<H && d[(y*W+x)*4+3]>=8;
  // silhouette-edge outline pixels would read as a black slab from the side, so they're stripped to
  // body colour; internal outline (eyes, seams) is kept on the face.
  const keepFace=(d,x,y)=>{ const i=(y*W+x)*4; if(!vxIsOutline(d[i],d[i+1],d[i+2],d[i+3])) return true;
    return opaque(d,x-1,y)&&opaque(d,x+1,y)&&opaque(d,x,y-1)&&opaque(d,x,y+1); };
  const faceCol=(d,dd,x,y)=>{ const i=(y*W+x)*4; return keepFace(d,x,y)?pack(d[i],d[i+1],d[i+2]):pack(dd[i],dd[i+1],dd[i+2]); };
  const blend=(i,t)=> pack(Math.round(dF[i]+(dB[i]-dF[i])*t), Math.round(dF[i+1]+(dB[i+1]-dF[i+1])*t), Math.round(dF[i+2]+(dB[i+2]-dF[i+2])*t));
  const mode=vx.mode||"flat";
  let D;

  if(mode==="side" && vx.side){
    const sd=vx.side.data, sw=vx.side.width; D=clamp(sw,2,96);
    const vox=new Uint32Array(W*H*D), at=(x,y,z)=>(z*H+y)*W+x;
    const sideOp=(z,y)=> z>=0&&y>=0&&z<sw&&y<H && sd[(y*sw+z)*4+3]>=8;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const i=(y*W+x)*4; if(fd[i+3]<8 && bd[i+3]<8) continue;
      let z0=-1,z1=-1; for(let z=0;z<D;z++) if(sideOp(z,y)){ if(z0<0)z0=z; z1=z; }
      if(z0<0){ z0=z1=Math.floor((D-1)/2); }                    // row with no side coverage: a thin core so nothing vanishes
      for(let z=z0;z<=z1;z++){ const t=D>1?z/(D-1):0;
        vox[at(x,y,z)] = (z===z0 && fd[i+3]>=8) ? faceCol(fd,dF,x,y) : (z===z1 && bd[i+3]>=8) ? faceCol(bd,dB,x,y) : blend(i,t); }
    }
    return {vox,W,H,D};
  }
  if(mode==="round"){
    D=clamp(vx.depth,2,96); const vox=new Uint32Array(W*H*D), at=(x,y,z)=>(z*H+y)*W+x;
    const mask=new Uint8Array(W*H); for(let i=0;i<W*H;i++) mask[i]=(fd[i*4+3]>=8||bd[i*4+3]>=8)?1:0;
    const dist=vxDistanceTransform(mask,W,H), center=(D-1)/2, maxHalf=Math.floor((D-1)/2);
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const p=y*W+x, i=p*4; if(!mask[p]) continue;
      const half=Math.min(maxHalf, Math.max(1, Math.round(dist[p]))), z0=Math.round(center-half), z1=Math.round(center+half);
      for(let z=z0;z<=z1;z++){ const t=D>1?z/(D-1):0;
        vox[at(x,y,z)] = (z===z0 && fd[i+3]>=8) ? faceCol(fd,dF,x,y) : (z===z1 && bd[i+3]>=8) ? faceCol(bd,dB,x,y) : blend(i,t); }
    }
    return {vox,W,H,D};
  }
  // flat slab
  D=clamp(vx.depth,2,96); const vox=new Uint32Array(W*H*D), at=(x,y,z)=>(z*H+y)*W+x;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const i=(y*W+x)*4, fa=fd[i+3], ba=bd[i+3]; if(fa<8&&ba<8) continue;
    if(fa>=8) vox[at(x,y,0)]=faceCol(fd,dF,x,y);
    if(ba>=8) vox[at(x,y,D-1)]=faceCol(bd,dB,x,y);
    if(fa>=8&&ba>=8) for(let z=1;z<D-1;z++) vox[at(x,y,z)]=blend(i,z/(D-1));
  }
  return {vox,W,H,D};
}
function frameToVoxCanvas(fr){ const c=canvasOf(W,H); compositeFrameInto(c.getContext("2d"), fr); return c; }
function setVoxSide(cv){ if(!cv||!vx.front){ vx.side=null; return; }
  const H=vx.front.height, sw=clamp(cv.width,2,96), c=canvasOf(sw,H), x=c.getContext("2d");
  x.imageSmoothingEnabled=false; x.drawImage(cv,0,0,sw,H); vx.side=imgDataOf(c); }
// Orthographic point-splat render with a small footprint (fills the gaps rotation opens up) + z-buffer.
function renderVoxel(m, yawDeg, pitchDeg){
  const {vox,W,H,D}=m, cx=(W-1)/2, cy=(H-1)/2, cz=(D-1)/2;
  const yaw=yawDeg*Math.PI/180, pit=pitchDeg*Math.PI/180;
  const cyaw=Math.cos(yaw),syaw=Math.sin(yaw),cpit=Math.cos(pit),spit=Math.sin(pit);
  const OUT=Math.ceil(Math.sqrt(W*W+H*H+D*D))+2, S=3, SW=OUT*S, off=OUT/2;
  const zbuf=new Float32Array(SW*SW).fill(1e9), col=new Uint32Array(SW*SW);
  for(let z=0;z<D;z++) for(let y=0;y<H;y++){ const row=(z*H+y)*W;
    for(let x=0;x<W;x++){ const v=vox[row+x]; if(!v) continue;
      const px=x-cx, py=y-cy, pz=z-cz;
      const rx=px*cyaw+pz*syaw, rz=-px*syaw+pz*cyaw;              // yaw about Y
      const ry2=py*cpit-rz*spit, rz2=py*spit+rz*cpit;            // pitch about X
      const sx=Math.round((rx+off)*S), sy=Math.round((ry2+off)*S);
      for(let dy=0;dy<S;dy++){ const yy=sy+dy; if(yy<0||yy>=SW) continue;
        for(let dx=0;dx<S;dx++){ const xx=sx+dx; if(xx<0||xx>=SW) continue;
          const idx=yy*SW+xx; if(rz2<zbuf[idx]){ zbuf[idx]=rz2; col[idx]=v; } } }
    }}
  const c=canvasOf(SW,SW), ctx=c.getContext("2d"), id=ctx.createImageData(SW,SW), dd=id.data;
  for(let i=0;i<col.length;i++){ const v=col[i]; if(!v) continue; const o=i*4;
    dd[o]=v&255; dd[o+1]=(v>>8)&255; dd[o+2]=(v>>16)&255; dd[o+3]=255; }
  ctx.putImageData(id,0,0);
  return {canvas:c, S, OUT};
}
function addSilhouetteOutline(c, rgb){
  const x=c.getContext("2d"), w=c.width, h=c.height, id=x.getImageData(0,0,w,h), d=id.data, mark=new Uint8Array(w*h);
  const op=i=> d[i*4+3]>8;
  for(let y=0;y<h;y++) for(let xx=0;xx<w;xx++){ const i=y*w+xx; if(op(i)) continue;
    if((xx>0&&op(i-1))||(xx<w-1&&op(i+1))||(y>0&&op(i-w))||(y<h-1&&op(i+w))) mark[i]=1; }
  for(let i=0;i<w*h;i++) if(mark[i]){ const o=i*4; d[o]=rgb[0]; d[o+1]=rgb[1]; d[o+2]=rgb[2]; d[o+3]=255; }
  x.putImageData(id,0,0);
}
function voxView(yawDeg, pitchDeg){
  const m=vx.model; if(!m) return canvasOf(4,4);
  const r=renderVoxel(m, yawDeg, pitchDeg), OUT=r.OUT, c=canvasOf(OUT,OUT), x=c.getContext("2d");
  x.imageSmoothingEnabled=false; x.drawImage(r.canvas,0,0,OUT*r.S,OUT*r.S,0,0,OUT,OUT);
  if(vx.reoutline && vx.useOutline) addSilhouetteOutline(c, vx.outline);
  return c;
}
function exportVoxelDirections(){
  vx.model=buildVoxels(); if(!vx.model){ showToast("Nothing to build a model from.","error"); return; }
  const views=[]; for(let i=0;i<8;i++) views.push(voxView(i*45, vx.pitch));
  bakeFrames(views, "3D "+spriteBaseName());
  showToast("Baked 8 directions ("+views[0].width+"×"+views[0].width+"), one per frame — export a spritesheet when ready.","success",5200);
}
function voxFrameOptions(){ return frames.map((f,i)=>`<option value="frame:${i}">Frame ${i+1}</option>`).join(""); }
async function showVoxelDialog(){
  if(!frames.length){ showToast("Draw a front view first.","info"); return; }
  vx.front=imgDataOf(flat);
  vx.depth=clamp(Math.round(W*0.4),3,24);
  vx.mirror=true; vx.useOutline=true; vx.reoutline=true; vx.mode="round"; vx.side=null; vx.yaw=32; vx.pitch=0;
  setVoxBack(null); vx.model=buildVoxels();
  const frOpts=voxFrameOptions();
  const body=`<div class="vx-wrap">
      <div class="vx-prev" id="vxPrevBox"><canvas id="vxPrev"></canvas><span class="vx-drag">drag to spin / tilt</span></div>
      <div class="vx-ctl">
        <div class="row"><label>Shape</label><select id="vxMode" style="flex:1">
          <option value="flat">Flat slab</option>
          <option value="round" selected>Rounded (guess)</option>
          <option value="side">Carve with side view</option></select></div>
        <div class="row"><label>Back view</label><select id="vxBack" style="flex:1">
          <option value="mirror">Front, mirrored</option>${frOpts}<option value="file">Image file…</option></select></div>
        <div class="row" id="vxSideRow" style="display:none"><label>Side view</label><select id="vxSideSrc" style="flex:1">
          <option value="none">— none (draw one as a frame) —</option>${frOpts}<option value="file">Image file…</option></select></div>
        <div class="row" id="vxDepthRow"><label>Depth</label>
          <input type="range" id="vxDepth" min="2" max="48" value="${vx.depth}" style="flex:1">
          <span id="vxDepthV" class="shi-hint" style="width:22px;text-align:right">${vx.depth}</span></div>
        <div class="row"><label>Outline</label>
          <input type="text" id="vxOutline" value="#000000" spellcheck="false" style="width:82px"></div>
        <label class="chk" style="gap:6px"><input type="checkbox" id="vxReout" checked>Redraw edge</label>
        <label class="chk" style="gap:6px"><input type="checkbox" id="vxUseOut" checked>Keep outline off the sides</label>
        <label class="chk" style="gap:6px"><input type="checkbox" id="vxMirror" checked>Mirror the back</label>
        <div class="vx-dirs" id="vxDirs"></div>
        <div class="shi-hint" id="vxHint" style="line-height:1.5"></div>
        <button id="vxStudio" style="width:100%">Edit in 3D Voxel Studio…</button>
      </div>
    </div>
    <input type="file" id="vxBackFile" accept="image/*" hidden>
    <input type="file" id="vxSideFile" accept="image/*" hidden>`;
  const p=openModal({title:"Pseudo-3D → 8 directions", bodyHTML:body, okText:"Export 8 directions", wide:true});
  hydrateIcons($("#modalBody"));
  const prev=$("#vxPrev");
  const hints={flat:"Straight front→back slab. Fast; ¾ views look thin.",
    round:"Bulges the body from the silhouette — best guess with no side art.",
    side:"Carves against a side view (front ∩ side) — a real hull. Draw one on a frame, then pick it."};
  const syncRows=()=>{ $("#vxSideRow").style.display=vx.mode==="side"?"":"none";
    $("#vxDepthRow").style.display=vx.mode==="side"?"none":""; $("#vxHint").textContent=hints[vx.mode]||""; };
  const rebuild=()=>{ vx.model=buildVoxels(); draw(); };
  const draw=()=>{
    const c=voxView(vx.yaw, vx.pitch), box=$("#vxPrevBox"), s=Math.max(1,Math.floor(Math.min((box.clientWidth-16)/c.width,(box.clientHeight-16)/c.height)));
    prev.width=c.width; prev.height=c.height; prev.getContext("2d").drawImage(c,0,0);
    prev.style.width=(c.width*s)+"px"; prev.style.height=(c.height*s)+"px";
    const dirs=$("#vxDirs"); dirs.innerHTML="";
    for(let i=0;i<8;i++){ const dc=voxView(i*45, vx.pitch), t=document.createElement("canvas");
      t.width=dc.width; t.height=dc.height; t.className="vx-dir"+(Math.round(((vx.yaw%360)+360)%360/45)%8===i?" on":"");
      t.getContext("2d").drawImage(dc,0,0); t.title="Face direction "+(i+1)+" (click)";
      t.onclick=()=>{ vx.yaw=i*45; draw(); }; dirs.appendChild(t); }
  };
  syncRows(); requestAnimationFrame(draw);
  // spin the preview by dragging
  let drag=null;
  prev.addEventListener("pointerdown",e=>{ e.preventDefault(); prev.setPointerCapture(e.pointerId); drag={x:e.clientX,y:e.clientY,yaw:vx.yaw,pitch:vx.pitch}; });
  prev.addEventListener("pointermove",e=>{ if(!drag) return;
    vx.yaw=drag.yaw+(e.clientX-drag.x)*0.8; vx.pitch=clamp(drag.pitch-(e.clientY-drag.y)*0.6,0,80); draw(); });
  prev.addEventListener("pointerup",()=>{ drag=null; });
  let backCanvas=null;
  const loadImg=(cb)=>{ const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*";
    inp.onchange=e=>{ const f=e.target.files[0]; if(!f) return; const url=URL.createObjectURL(f), img=new Image();
      img.onload=()=>{ URL.revokeObjectURL(url); const c=canvasOf(img.naturalWidth,img.naturalHeight); c.getContext("2d").drawImage(img,0,0); cb(c); };
      img.onerror=()=>{ URL.revokeObjectURL(url); showToast("Couldn't read that image.","error"); }; img.src=url; };
    inp.click(); };
  $("#vxMode").onchange=e=>{ vx.mode=e.target.value; syncRows(); rebuild(); };
  $("#vxDepth").oninput=e=>{ vx.depth=+e.target.value; $("#vxDepthV").textContent=vx.depth; rebuild(); };
  $("#vxOutline").onchange=e=>{ const h=normHex(e.target.value); if(h){ vx.outline=hexToRgb(h); rebuild(); } };
  $("#vxReout").onchange=e=>{ vx.reoutline=e.target.checked; draw(); };
  $("#vxUseOut").onchange=e=>{ vx.useOutline=e.target.checked; rebuild(); };
  $("#vxMirror").onchange=e=>{ vx.mirror=e.target.checked; setVoxBack(backCanvas); rebuild(); };
  $("#vxBack").onchange=e=>{ const v=e.target.value;
    if(v==="mirror"){ backCanvas=null; setVoxBack(null); rebuild(); }
    else if(v.startsWith("frame:")){ backCanvas=frameToVoxCanvas(frames[+v.slice(6)]); setVoxBack(backCanvas); rebuild(); }
    else if(v==="file"){ loadImg(c=>{ backCanvas=c; setVoxBack(c); rebuild(); }); } };
  $("#vxSideSrc").onchange=e=>{ const v=e.target.value;
    if(v==="none"){ setVoxSide(null); rebuild(); }
    else if(v.startsWith("frame:")){ setVoxSide(frameToVoxCanvas(frames[+v.slice(6)])); rebuild(); }
    else if(v==="file"){ loadImg(c=>{ setVoxSide(c); rebuild(); }); } };
  $("#vxStudio").onclick=()=>{ const m=vx.model||buildVoxels(); if(!m){ showToast("Nothing to build a model from.","error"); return; }
    closeModal(false); openVoxelStudio(m); };
  const ok=await p;
  if(ok) exportVoxelDirections();
}

/* ---------------- 3D Voxel Studio ---------------- */
// A live, editable voxel model: orbit to view, click to add/erase/paint voxels, then bake to sprites.
let studio={ model:null, yaw:32, pitch:20, tool:"add", mirror:true, brush:1, _n:[0,0,-1], undo:[], redo:[],
  mode:"sculpt", bones:[], keys:[], key:0, rigBone:0, frameMs:120, _play:null };
function packHex(hex){ const [r,g,b]=hexToRgb(hex); return ((r&255)|((g&255)<<8)|((b&255)<<16)|(255<<24))>>>0; }
function cloneModel(m){ return {vox:new Uint32Array(m.vox), W:m.W, H:m.H, D:m.D}; }
function voxViewOf(model, yawDeg, pitchDeg){
  const r=renderVoxel(model, yawDeg, pitchDeg), OUT=r.OUT, c=canvasOf(OUT,OUT), x=c.getContext("2d");
  x.imageSmoothingEnabled=false; x.drawImage(r.canvas,0,0,OUT*r.S,OUT*r.S,0,0,OUT,OUT);
  return c;
}
// Render + a pick buffer (which voxel each screen pixel belongs to) + the toward-camera direction for Add.
function studioRender(m, yawDeg, pitchDeg, S){
  const {vox,W,H,D}=m, cx=(W-1)/2, cy=(H-1)/2, cz=(D-1)/2;
  const yaw=yawDeg*Math.PI/180, pit=pitchDeg*Math.PI/180;
  const cyaw=Math.cos(yaw),syaw=Math.sin(yaw),cpit=Math.cos(pit),spit=Math.sin(pit);
  const OUT=Math.ceil(Math.sqrt(W*W+H*H+D*D))+2; S=S||3; const SW=OUT*S, off=OUT/2;
  const zbuf=new Float32Array(SW*SW).fill(1e9), col=new Uint32Array(SW*SW), pick=new Int32Array(SW*SW).fill(-1);
  for(let z=0;z<D;z++) for(let y=0;y<H;y++){ const row=(z*H+y)*W;
    for(let x=0;x<W;x++){ const v=vox[row+x]; if(!v) continue;
      const px=x-cx, py=y-cy, pz=z-cz;
      const rx=px*cyaw+pz*syaw, rz=-px*syaw+pz*cyaw;
      const ry2=py*cpit-rz*spit, rz2=py*spit+rz*cpit;
      const sx=Math.round((rx+off)*S), sy=Math.round((ry2+off)*S);
      for(let dy=0;dy<S;dy++){ const yy=sy+dy; if(yy<0||yy>=SW) continue;
        for(let dx=0;dx<S;dx++){ const xx=sx+dx; if(xx<0||xx>=SW) continue;
          const idx=yy*SW+xx; if(rz2<zbuf[idx]){ zbuf[idx]=rz2; col[idx]=v; pick[idx]=row+x; } } }
    }}
  const c=canvasOf(SW,SW), ctx=c.getContext("2d"), id=ctx.createImageData(SW,SW), dd=id.data;
  for(let i=0;i<col.length;i++){ const v=col[i]; if(!v) continue; const o=i*4;
    dd[o]=v&255; dd[o+1]=(v>>8)&255; dd[o+2]=(v>>16)&255; dd[o+3]=255; }
  ctx.putImageData(id,0,0);
  const n=[syaw*cpit, -spit, -cyaw*cpit];  // world-space direction toward the camera (for placing new voxels on the near face)
  return {canvas:c, col, pick, SW, S, OUT, n};
}
function addAxis(n){ const ax=Math.abs(n[0]),ay=Math.abs(n[1]),az=Math.abs(n[2]);
  if(ax>=ay&&ax>=az) return [Math.sign(n[0])||1,0,0];
  if(ay>=az) return [0,Math.sign(n[1])||1,0];
  return [0,0,Math.sign(n[2])||1]; }
function studioCount(){ const v=studio.model?studio.model.vox:null; if(!v) return 0; let n=0; for(let i=0;i<v.length;i++) if(v[i]) n++; return n; }
function studioPush(){ if(!studio.model) return; studio.undo.push(new Uint32Array(studio.model.vox)); if(studio.undo.length>40) studio.undo.shift(); studio.redo.length=0; }
function studioUndo(){ if(!studio.undo.length) return; studio.redo.push(new Uint32Array(studio.model.vox)); studio.model.vox=studio.undo.pop(); }
function studioRedo(){ if(!studio.redo.length) return; studio.undo.push(new Uint32Array(studio.model.vox)); studio.model.vox=studio.redo.pop(); }
// --- bones / posing ---
const BONE_COLS=[null,[86,170,255],[255,120,80],[120,220,120],[235,205,70],[205,120,235],[90,222,222],[240,140,185],[170,170,170]];
function boneTint(b){ const c=BONE_COLS[((b-1)%(BONE_COLS.length-1))+1]||[160,160,160]; return c; }
function ensureRig(m){ if(!m.bone) m.bone=new Int16Array(m.vox.length); }
function centroidOf(m, b){ const {vox,W,H,D,bone}=m; let sx=0,sy=0,sz=0,n=0;
  for(let z=0;z<D;z++)for(let y=0;y<H;y++)for(let x=0;x<W;x++){ const i=(z*H+y)*W+x; if(vox[i]&&(b<0||bone[i]===b)){ sx+=x;sy+=y;sz+=z;n++; } }
  return n?[sx/n,sy/n,sz/n]:[(W-1)/2,(H-1)/2,(D-1)/2]; }
// Per-bone world matrices (voxel space) from a rotation table [[rx,ry,rz],…]. Parents must precede children.
function boneMatrices(bones, rotArr){
  const world=new Array(bones.length);
  function build(b){ if(world[b]) return world[b]; const bn=bones[b], r=rotArr[b]||[0,0,0];
    let local=new DOMMatrix();
    local=local.translate(bn.pivot[0],bn.pivot[1],bn.pivot[2]).rotate(r[0],r[1],r[2]).translate(-bn.pivot[0],-bn.pivot[1],-bn.pivot[2]);
    const par=(bn.parent<0||bn.parent>=b)?new DOMMatrix():build(bn.parent);
    return world[b]=par.multiply(local); }
  for(let b=0;b<bones.length;b++) build(b);
  return world;
}
// Render with optional per-bone deformation (mats) and optional rig-colour tint. pick keeps the ORIGINAL
// voxel index so editing/assignment always map back to rest-pose voxels.
function studioRenderPosed(m, yawDeg, pitchDeg, S, mats, tint){
  const {vox,W,H,D}=m, bone=m.bone, cx=(W-1)/2, cy=(H-1)/2, cz=(D-1)/2;
  const yaw=yawDeg*Math.PI/180, pit=pitchDeg*Math.PI/180;
  const cyaw=Math.cos(yaw),syaw=Math.sin(yaw),cpit=Math.cos(pit),spit=Math.sin(pit);
  const margin=mats?Math.round(Math.max(W,H,D)*0.6):0;
  const OUT=Math.ceil(Math.sqrt(W*W+H*H+D*D))+margin+2; S=S||3; const SW=OUT*S, off=OUT/2;
  const zbuf=new Float32Array(SW*SW).fill(1e9), col=new Uint32Array(SW*SW), pick=new Int32Array(SW*SW).fill(-1);
  const P=(mats)?new DOMPoint():null;
  for(let z=0;z<D;z++) for(let y=0;y<H;y++){ const row=(z*H+y)*W;
    for(let x=0;x<W;x++){ const oi=row+x, v=vox[oi]; if(!v) continue;
      let X=x,Y=y,Z=z, b=bone?bone[oi]:0;
      if(mats && mats[b]){ P.x=x;P.y=y;P.z=z;P.w=1; const q=mats[b].transformPoint(P); X=q.x;Y=q.y;Z=q.z; }
      const px=X-cx, py=Y-cy, pz=Z-cz;
      const rx=px*cyaw+pz*syaw, rz=-px*syaw+pz*cyaw;
      const ry2=py*cpit-rz*spit, rz2=py*spit+rz*cpit;
      const sx=Math.round((rx+off)*S), sy=Math.round((ry2+off)*S);
      let cvl=v;
      if(tint && b>0){ const t=boneTint(b); cvl=(( (v&255)+t[0]>>1 &255) | (((v>>8&255)+t[1]>>1 &255)<<8) | (((v>>16&255)+t[2]>>1 &255)<<16) | (255<<24))>>>0; }
      for(let dy=0;dy<S;dy++){ const yy=sy+dy; if(yy<0||yy>=SW) continue;
        for(let dx=0;dx<S;dx++){ const xx=sx+dx; if(xx<0||xx>=SW) continue;
          const idx=yy*SW+xx; if(rz2<zbuf[idx]){ zbuf[idx]=rz2; col[idx]=cvl; pick[idx]=oi; } } }
    }}
  const c=canvasOf(SW,SW), ctx=c.getContext("2d"), id=ctx.createImageData(SW,SW), dd=id.data;
  for(let i=0;i<col.length;i++){ const v=col[i]; if(!v) continue; const o=i*4; dd[o]=v&255; dd[o+1]=(v>>8)&255; dd[o+2]=(v>>16)&255; dd[o+3]=255; }
  ctx.putImageData(id,0,0);
  const n=[syaw*cpit, -spit, -cyaw*cpit];
  return {canvas:c, col, pick, SW, S, OUT, n};
}
function voxViewPosed(m, yawDeg, pitchDeg, mats){
  const r=studioRenderPosed(m, yawDeg, pitchDeg, 3, mats, false), OUT=r.OUT, c=canvasOf(OUT,OUT), x=c.getContext("2d");
  x.imageSmoothingEnabled=false; x.drawImage(r.canvas,0,0,OUT*r.S,OUT*r.S,0,0,OUT,OUT);
  return c;
}
function studioBakeAnim(){ const m=studio.model; if(!m||!studioCount()){ showToast("The model is empty.","info"); return; }
  const keys=studio.keys, views=keys.map(k=> voxViewPosed(m, studio.yaw, studio.pitch, boneMatrices(studio.bones, k.rot)));
  bakeFrames(views, "Anim "+spriteBaseName(), studio.frameMs||120);
  showToast("Baked "+views.length+"-frame animation from the studio pose.","success",4200);
}
function studioBake(){ const m=studio.model; if(!m||!studioCount()){ showToast("The model is empty.","info"); return; }
  const views=[]; for(let i=0;i<8;i++) views.push(voxViewOf(m, i*45, studio.pitch));
  bakeFrames(views, "3D "+spriteBaseName());
  showToast("Baked 8 directions from the studio model.","success",4200);
}
function openStudioFromSprite(){
  if(!frames.length){ showToast("Draw a front view first.","info"); return; }
  vx.front=imgDataOf(flat); vx.depth=clamp(Math.round(W*0.4),3,24);
  vx.mode="round"; vx.side=null; vx.useOutline=true; setVoxBack(null);
  const m=buildVoxels(); if(!m){ showToast("Nothing to build a model from.","error"); return; }
  openVoxelStudio(m);
}
function openVoxelStudio(model){
  studio.model=cloneModel(model); ensureRig(studio.model);
  studio.undo.length=0; studio.redo.length=0;
  studio.bones=[{name:"Root", parent:-1, pivot:centroidOf(studio.model,-1)}];
  studio.keys=[{rot:[[0,0,0]]}]; studio.key=0; studio.rigBone=0; studio.mode="sculpt";
  if(studio._play){ clearInterval(studio._play); studio._play=null; }
  if(!["add","erase","paint"].includes(studio.tool)) studio.tool="add";
  const body=`<div class="st-wrap">
      <div class="st-view" id="stView"><canvas id="stCanvas"></canvas><span class="st-hint" id="stHintTxt">drag = orbit · click = edit</span></div>
      <div class="st-side">
        <div class="st-tabs">
          <button class="st-mode" data-mode="sculpt">Sculpt</button>
          <button class="st-mode" data-mode="rig">Rig</button>
          <button class="st-mode" data-mode="anim">Animate</button>
        </div>
        <div id="stSculpt">
          <div class="st-tools">
            <button class="st-tool" data-st="add">Add</button>
            <button class="st-tool" data-st="paint">Paint</button>
            <button class="st-tool" data-st="erase">Erase</button>
          </div>
          <label class="chk" style="gap:6px;margin-top:8px"><input type="checkbox" id="stMirror">Mirror across X</label>
          <div class="row" style="margin-top:8px"><label>Color</label><span id="stSwatch" class="st-swatch"></span><span id="stHex" class="shi-hint"></span></div>
          <div class="row"><button id="stUndo" style="flex:1">Undo</button><button id="stRedo" style="flex:1">Redo</button></div>
          <div class="row"><label>Voxels</label><span id="stCount" class="shi-hint"></span></div>
        </div>
        <div id="stRig" style="display:none">
          <div class="shi-hint" style="margin-bottom:6px">Pick a bone, then click voxels to assign them. Root holds everything you don't assign.</div>
          <div id="stBoneList" class="st-bones"></div>
          <div class="row" style="margin-top:6px"><button id="stAddBone" style="flex:1">+ Bone</button><button id="stDelBone" style="flex:1">Delete</button></div>
          <div class="row"><label>Parent</label><select id="stParent" style="flex:1"></select></div>
          <label class="chk" style="gap:6px;margin-top:6px"><input type="checkbox" id="stMirror2">Mirror across X</label>
        </div>
        <div id="stAnim" style="display:none">
          <div class="row"><label>Bone</label><select id="stPoseBone" style="flex:1"></select></div>
          <div class="row"><label>Rot X</label><input type="range" id="stRX" min="-180" max="180" value="0" style="flex:1"><span id="stRXv" class="shi-hint" style="width:30px;text-align:right">0</span></div>
          <div class="row"><label>Rot Y</label><input type="range" id="stRY" min="-180" max="180" value="0" style="flex:1"><span id="stRYv" class="shi-hint" style="width:30px;text-align:right">0</span></div>
          <div class="row"><label>Rot Z</label><input type="range" id="stRZ" min="-180" max="180" value="0" style="flex:1"><span id="stRZv" class="shi-hint" style="width:30px;text-align:right">0</span></div>
          <div class="shi-hint" style="margin:6px 0 2px">Keyframes</div>
          <div id="stKeys" class="st-keys"></div>
          <div class="row" style="margin-top:6px"><button id="stAddKey" style="flex:1">+ Key</button><button id="stDelKey" style="flex:1">Delete</button></div>
          <div class="row"><button id="stPlay" style="flex:1">Play</button><label>ms</label><input type="number" id="stMs" value="120" min="20" step="10" style="width:56px"></div>
        </div>
        <div style="flex:1"></div>
        <button id="stBakeAnim" class="primary" style="width:100%;display:none">Bake animation</button>
        <button id="stBake" class="primary" style="width:100%">Bake 8 directions</button>
      </div>
    </div>`;
  const p=openModal({title:"3D Voxel Studio", bodyHTML:body, okText:"Done", cancel:false, wide:true});
  p.then(()=>{ if(studio._play){ clearInterval(studio._play); studio._play=null; } });
  const cv=$("#stCanvas");
  const idxToXYZ=(i,W,H)=>({z:Math.floor(i/(W*H)), y:Math.floor((i%(W*H))/W), x:i%W});
  const curRot=()=>studio.keys[studio.key].rot;
  const posedMats=()=> boneMatrices(studio.bones, curRot());
  const draw=()=>{
    const m=studio.model, posed=(studio.mode==="anim"), tint=(studio.mode==="rig");
    const r=studioRenderPosed(m, studio.yaw, studio.pitch, 3, posed?posedMats():null, tint);
    studio._last=r; studio._n=r.n;
    const box=$("#stView"), s=Math.max(1,Math.floor(Math.min((box.clientWidth-16)/r.OUT,(box.clientHeight-16)/r.OUT)));
    cv.width=r.SW; cv.height=r.SW; cv.getContext("2d").drawImage(r.canvas,0,0);
    cv.style.width=(r.OUT*s)+"px"; cv.style.height=(r.OUT*s)+"px";
    $("#stSwatch").style.background=primary; $("#stHex").textContent=primary; $("#stCount").textContent=studioCount();
  };
  // ---- Sculpt ----
  const setTool=t=>{ studio.tool=t; PX.querySelectorAll(".st-tool").forEach(b=>b.classList.toggle("on", b.dataset.st===t)); };
  const sculptAt=(hit)=>{ const m=studio.model, {W,H,D}=m;
    const setV=(x,y,z,v)=>{ if(x<0||y<0||z<0||x>=W||y>=H||z>=D) return; m.vox[(z*H+y)*W+x]=v; };
    const has=(x,y,z)=> x>=0&&y>=0&&z>=0&&x<W&&y<H&&z<D && m.vox[(z*H+y)*W+x]!==0;
    if(hit<0) return; const {x,y,z}=idxToXYZ(hit,W,H); studioPush();
    if(studio.tool==="erase"){ setV(x,y,z,0); m.bone[(z*H+y)*W+x]=0; if(studio.mirror) setV(W-1-x,y,z,0); }
    else if(studio.tool==="paint"){ const c=packHex(primary); setV(x,y,z,c); if(studio.mirror) setV(W-1-x,y,z,c); }
    else { const a=addAxis(studio._n), c=packHex(primary), nx=x+a[0], ny=y+a[1], nz=z+a[2];
      if(!has(nx,ny,nz)) setV(nx,ny,nz,c); if(studio.mirror){ const mx=W-1-nx; if(!has(mx,ny,nz)) setV(mx,ny,nz,c); } } };
  // ---- Rig ----
  const assignAt=(hit)=>{ if(hit<0) return; const m=studio.model, {W,H}=m; const {x,y,z}=idxToXYZ(hit,W,H);
    m.bone[(z*m.H+y)*W+x]=studio.rigBone; if(studio.mirror){ const mx=W-1-x; if(m.vox[(z*m.H+y)*W+mx]) m.bone[(z*m.H+y)*W+mx]=studio.rigBone; }
    studio.bones[studio.rigBone].pivot=centroidOf(m, studio.rigBone); };
  const renderBoneList=()=>{ const el=$("#stBoneList"); el.innerHTML="";
    studio.bones.forEach((bn,i)=>{ const d=document.createElement("div"); d.className="st-bone"+(i===studio.rigBone?" on":"");
      const sw=i===0?"transparent":rgbToHex(...boneTint(i)); d.innerHTML=`<span class="st-bdot" style="background:${sw}"></span>${bn.name}`;
      d.onclick=()=>{ studio.rigBone=i; renderBoneList(); syncParent(); draw(); }; el.appendChild(d); }); };
  const syncParent=()=>{ const sel=$("#stParent"); sel.innerHTML=studio.bones.map((b,i)=>`<option value="${i}"${studio.bones[studio.rigBone].parent===i?" selected":""}>${i===studio.rigBone?"—":b.name}</option>`).join("");
    sel.disabled=studio.rigBone===0; };
  // ---- Animate ----
  const boneOpts=sel=>studio.bones.map((b,i)=>`<option value="${i}"${sel===i?" selected":""}>${b.name}</option>`).join("");
  const syncPoseSliders=()=>{ const r=curRot()[studio.rigBone]||[0,0,0];
    $("#stRX").value=r[0]; $("#stRY").value=r[1]; $("#stRZ").value=r[2];
    $("#stRXv").textContent=r[0]; $("#stRYv").textContent=r[1]; $("#stRZv").textContent=r[2]; };
  const renderKeys=()=>{ const el=$("#stKeys"); el.innerHTML="";
    studio.keys.forEach((k,i)=>{ const b=document.createElement("button"); b.className="st-key"+(i===studio.key?" on":""); b.textContent=i+1;
      b.onclick=()=>{ studio.key=i; syncPoseSliders(); renderKeys(); draw(); }; el.appendChild(b); }); };
  const setMode=mode=>{ studio.mode=mode;
    PX.querySelectorAll(".st-mode").forEach(b=>b.classList.toggle("on", b.dataset.mode===mode));
    $("#stSculpt").style.display=mode==="sculpt"?"":"none";
    $("#stRig").style.display=mode==="rig"?"":"none";
    $("#stAnim").style.display=mode==="anim"?"":"none";
    $("#stBakeAnim").style.display=mode==="anim"?"":"none";
    $("#stHintTxt").textContent=mode==="sculpt"?"drag = orbit · click = edit":mode==="rig"?"drag = orbit · click = assign bone":"drag = orbit";
    if(mode==="rig") renderBoneList(), syncParent();
    if(mode==="anim"){ $("#stPoseBone").innerHTML=boneOpts(studio.rigBone); syncPoseSliders(); renderKeys(); }
    if(studio._play){ clearInterval(studio._play); studio._play=null; $("#stPlay").textContent="Play"; }
    draw(); };
  // pointer: drag = orbit, click = mode action
  let dn=null;
  const pickAt=(clientX,clientY)=>{ const r=studio._last; if(!r) return -1; const b=cv.getBoundingClientRect();
    const sx=Math.floor((clientX-b.left)/b.width*r.SW), sy=Math.floor((clientY-b.top)/b.height*r.SW);
    if(sx<0||sy<0||sx>=r.SW||sy>=r.SW) return -1; return r.pick[sy*r.SW+sx]; };
  cv.addEventListener("pointerdown",e=>{ e.preventDefault(); cv.setPointerCapture(e.pointerId);
    dn={x:e.clientX,y:e.clientY,yaw:studio.yaw,pitch:studio.pitch,moved:false}; });
  cv.addEventListener("pointermove",e=>{ if(!dn) return; const dx=e.clientX-dn.x, dy=e.clientY-dn.y;
    if(!dn.moved && Math.abs(dx)+Math.abs(dy)<4) return; dn.moved=true;
    studio.yaw=dn.yaw+dx*0.8; studio.pitch=clamp(dn.pitch-dy*0.6,-85,85); draw(); });
  cv.addEventListener("pointerup",e=>{ if(dn && !dn.moved){ const hit=pickAt(e.clientX,e.clientY);
      if(studio.mode==="sculpt"){ sculptAt(hit); draw(); }
      else if(studio.mode==="rig"){ assignAt(hit); renderBoneList(); draw(); } }
    dn=null; });
  PX.querySelectorAll(".st-mode").forEach(b=> b.onclick=()=>setMode(b.dataset.mode));
  PX.querySelectorAll(".st-tool").forEach(b=> b.onclick=()=>setTool(b.dataset.st));
  $("#stMirror").checked=studio.mirror; $("#stMirror2").checked=studio.mirror;
  const setMirror=v=>{ studio.mirror=v; $("#stMirror").checked=v; $("#stMirror2").checked=v; };
  $("#stMirror").onchange=e=>setMirror(e.target.checked);
  $("#stMirror2").onchange=e=>setMirror(e.target.checked);
  $("#stUndo").onclick=()=>{ studioUndo(); draw(); };
  $("#stRedo").onclick=()=>{ studioRedo(); draw(); };
  $("#stAddBone").onclick=()=>{ const n=studio.bones.length; if(n>=8){ showToast("8 bones max for now.","info"); return; }
    studio.bones.push({name:"Bone "+n, parent:0, pivot:centroidOf(studio.model,-1)});
    studio.keys.forEach(k=>k.rot.push([0,0,0])); studio.rigBone=n; renderBoneList(); syncParent(); draw(); };
  $("#stDelBone").onclick=()=>{ const i=studio.rigBone; if(i===0){ showToast("Root can't be deleted.","info"); return; }
    const m=studio.model; for(let j=0;j<m.bone.length;j++){ if(m.bone[j]===i) m.bone[j]=0; else if(m.bone[j]>i) m.bone[j]--; }
    studio.bones.splice(i,1); studio.bones.forEach(b=>{ if(b.parent===i) b.parent=0; else if(b.parent>i) b.parent--; });
    studio.keys.forEach(k=>k.rot.splice(i,1)); studio.rigBone=0; renderBoneList(); syncParent(); draw(); };
  $("#stParent").onchange=e=>{ const v=+e.target.value; if(v!==studio.rigBone) studio.bones[studio.rigBone].parent=v; };
  $("#stPoseBone").onchange=e=>{ studio.rigBone=+e.target.value; syncPoseSliders(); };
  const setRot=(ax,val)=>{ const r=curRot(); if(!r[studio.rigBone]) r[studio.rigBone]=[0,0,0]; r[studio.rigBone][ax]=+val; };
  $("#stRX").oninput=e=>{ setRot(0,e.target.value); $("#stRXv").textContent=e.target.value; draw(); };
  $("#stRY").oninput=e=>{ setRot(1,e.target.value); $("#stRYv").textContent=e.target.value; draw(); };
  $("#stRZ").oninput=e=>{ setRot(2,e.target.value); $("#stRZv").textContent=e.target.value; draw(); };
  $("#stAddKey").onclick=()=>{ const src=curRot(); studio.keys.push({rot:src.map(r=>r.slice())}); studio.key=studio.keys.length-1; renderKeys(); syncPoseSliders(); draw(); };
  $("#stDelKey").onclick=()=>{ if(studio.keys.length<=1){ showToast("Keep at least one keyframe.","info"); return; }
    studio.keys.splice(studio.key,1); studio.key=Math.min(studio.key,studio.keys.length-1); renderKeys(); syncPoseSliders(); draw(); };
  $("#stMs").onchange=e=>{ studio.frameMs=clamp(+e.target.value||120,20,4000); };
  $("#stPlay").onclick=()=>{ if(studio._play){ clearInterval(studio._play); studio._play=null; $("#stPlay").textContent="Play"; return; }
    if(studio.keys.length<2){ showToast("Add a second keyframe to play.","info"); return; }
    $("#stPlay").textContent="Stop";
    studio._play=setInterval(()=>{ studio.key=(studio.key+1)%studio.keys.length; renderKeys(); syncPoseSliders(); draw(); }, studio.frameMs||120); };
  $("#stBake").onclick=()=>studioBake();
  $("#stBakeAnim").onclick=()=>studioBakeAnim();
  setTool(studio.tool); setMode("sculpt"); requestAnimationFrame(draw);
  return p;
}
