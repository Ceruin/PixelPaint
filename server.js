// Tiny static server for PixelPaint so Chrome can install it as an app.
// PWA install requires a secure origin (http://localhost counts; file:// does not).
const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const ROOT = __dirname;
const PORT = 8137;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".pxpaint": "application/json"
};

http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/" || url === "") url = "/PixelPaint.html";
  const file = path.normalize(path.join(ROOT, url));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => {
  const url = "http://localhost:" + PORT + "/PixelPaint.html";
  console.log("PixelPaint is running at " + url);
  console.log("Open the browser's menu and choose \"Install PixelPaint\" (or click Install in the app).");
  console.log("Close this window to stop the server.");
  exec('start "" "' + url + '"');
});
