// Our own cursors, so they look the same on every system (the OS "crosshair" varies wildly — a
// thick +, a circled cross…). A thin gapped cross, white with a dark outline so it shows on any colour.
const svg = s => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
const cross = '<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21"><g stroke-linecap="square"><path d="M10.5 2v5M10.5 14v5M2 10.5h5M14 10.5h5" stroke="#1b1d23" stroke-width="3"/><path d="M10.5 2v5M10.5 14v5M2 10.5h5M14 10.5h5" stroke="#fff" stroke-width="1"/></g><rect x="9.5" y="9.5" width="2" height="2" fill="#fff" stroke="#1b1d23" stroke-width="1"/></svg>';
export const CROSS = `${svg(cross)} 10 10, crosshair`;
