import { PaintTool } from './paint.js';
import { FillTool, PickerTool, HandTool, ZoomTool } from './misc.js';
import { MarqueeTool, LassoTool, WandTool } from './select.js';
import { TransformTool } from './transform.js';
import { ShapeTool } from './shape.js';
import { TextTool } from './text.js';
import { AssistTool } from './assist.js';

export const TOOL_META = [
  ['brush', 'Brush', 'B'], ['eraser', 'Eraser', 'E'], ['smudge', 'Smudge', 'S'], ['fill', 'Fill', 'G'],
  ['picker', 'Eyedropper', 'I'], ['marquee', 'Rectangle Select', 'M'], ['ellipse', 'Ellipse Select', 'O'],
  ['lasso', 'Lasso', 'L'], ['wand', 'Magic Wand', 'W'], ['transform', 'Transform / Warp', 'V'],
  ['shape', 'Shapes & Bubbles', 'U'], ['text', 'Text', 'T'], ['assist', 'Drawing Assistants', 'A'],
  ['hand', 'Hand', 'H'], ['zoom', 'Zoom', 'Z'],
];

export function createTools(app) {
  return {
    brush: new PaintTool(app, 'brush'), eraser: new PaintTool(app, 'eraser'), smudge: new PaintTool(app, 'smudge'),
    fill: new FillTool(app), picker: new PickerTool(app),
    marquee: new MarqueeTool(app, 'marquee', false), ellipse: new MarqueeTool(app, 'ellipse', true),
    lasso: new LassoTool(app), wand: new WandTool(app), transform: new TransformTool(app),
    shape: new ShapeTool(app), text: new TextTool(app), assist: new AssistTool(app),
    hand: new HandTool(app), zoom: new ZoomTool(app),
  };
}
