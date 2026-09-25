// Layer blend modes map 1:1 onto GPU-accelerated canvas composite operations.
export const BLEND_MODES = [
  ['source-over', 'Normal'], ['multiply', 'Multiply'], ['darken', 'Darken'], ['color-burn', 'Color Burn'],
  ['screen', 'Screen'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['lighter', 'Add'],
  ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'],
  ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'],
];
export const GROUP_MODES = [['pass', 'Pass Through'], ...BLEND_MODES];
