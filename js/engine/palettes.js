// Built-in palettes plus parsers for common palette files (GIMP .gpl, JASC .pal, .hex lists).
export const PALETTES = {
  'PixelPaint': ['#000000', '#3c3f47', '#8c93a5', '#ffffff', '#ff3b47', '#ff8a3d', '#ffd23f', '#9be15d', '#17c06b', '#1fb5a8',
    '#84cee0', '#3b7bff', '#5b4bff', '#a445ff', '#ff5fa2', '#7a4a2e', '#c89f7c', '#f5deb3', '#2e4a7a', '#233d2b'],
  'Pyxl': ['#c8413c', '#e8c33a', '#2f9a88', '#3d78d8', '#4a3a3f', '#f6e2cf', '#26212a', '#8a5a3c', '#ffffff', '#9bd0c6'],
  'DawnBringer 32': ['#000000', '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a', '#fbf236', '#99e550', '#6abe30',
    '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74', '#306082', '#5b6ee1', '#639bff', '#5fcde4', '#cbdbfc', '#ffffff', '#9badb7',
    '#847e87', '#696a6a', '#595652', '#76428a', '#ac3232', '#d95763', '#d77bba', '#8f974a', '#8a6f30'],
  'PICO-8': ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27',
    '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa'],
  'Game Boy': ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  'Skin tones': ['#ffe0c7', '#f6c9a6', '#e8b08a', '#d2956b', '#b67651', '#8d5a3b', '#6a4029', '#46291a'],
};

const hex2 = v => (+v).toString(16).padStart(2, '0');
export function parsePalette(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const hex = line.match(/^\s*#?([0-9a-f]{6})\b/i);
    const rgb = line.match(/^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(\s|$)/);
    if (hex) out.push(`#${hex[1].toLowerCase()}`);
    else if (rgb) out.push(`#${hex2(rgb[1])}${hex2(rgb[2])}${hex2(rgb[3])}`);
  }
  return [...new Set(out)];
}
