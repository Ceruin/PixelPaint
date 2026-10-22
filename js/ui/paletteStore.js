// The working palette, shared by every colour picker and the Palette panel (one list, kept in sync
// through the bus). Built-ins and imported files (.gpl / .pal / .hex) are loaded into it, replacing
// its colours; a palette you built yourself is kept as "My palette" first.
import { PALETTES, parsePalette } from '../engine/palettes.js';
import { pickFile, download } from '../core/util.js';
import { bus } from '../core/bus.js';
import { local } from '../core/storage.js';

export const allPalettes = () => ({ ...PALETTES, ...local.get('pp.palettes', {}) });
let mine = local.get('pp.swatches', null) ?? allPalettes()[local.get('pp.palette', 'PixelPaint')] ?? PALETTES.PixelPaint;
const savePalette = (name, colors) => local.set('pp.palettes', { ...local.get('pp.palettes', {}), [name]: colors });

export const palette = {
  get colors() { return mine; },
  set(colors) { mine = colors; local.set('pp.swatches', mine); bus.emit('palette', mine); },
  load(colors) {
    if (!Object.values(allPalettes()).some(p => p.join() === mine.join())) savePalette('My palette', mine);
    palette.set(colors);
  },
  add(c) { if (!mine.includes(c)) palette.set([...mine, c]); },
  remove(c) { palette.set(mine.filter(m => m !== c)); },
  async import() {
    const f = await pickFile('.gpl,.pal,.hex,.txt');
    const colors = f && parsePalette(await f.text());
    if (!colors?.length) return;
    savePalette(f.name.replace(/\.\w+$/, ''), colors.slice(0, 256));
    palette.load(colors.slice(0, 256));
  },
  // GIMP .gpl: opens in Krita, GIMP, Aseprite, Pixelorama and LibreSprite
  export(name = 'PixelPaint palette') {
    const rows = mine.map(c => { const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)); return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c}`; });
    download(new Blob([`GIMP Palette\nName: ${name}\nColumns: 8\n#\n${rows.join('\n')}\n`], { type: 'text/plain' }), `${name}.gpl`);
  },
};
