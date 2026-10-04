// Design canvas contract for the companion surfaces (T-0136). Tokens and class names are copied from the canvas
// (docs/design/canvas: Dock.dc.html, Buddy.dc.html, FloatPanel.dc.html); design.test.ts checks the shipped CSS against them.

/** CSS custom properties from the canvas .gl block, with their canvas values. */
export const CANVAS_TOKENS: Readonly<Record<string, string>> = {
  "--tx": "#111111",
  "--mu": "#626262",
  "--fa": "#8C8C8C",
  "--ln": "rgba(0,0,0,.08)",
  "--ln2": "rgba(0,0,0,.12)",
  "--s2": "rgba(0,0,0,.04)",
  "--s3": "rgba(0,0,0,.07)",
  "--bl": "#0F7FFF",
  "--bls": "rgba(15,127,255,.12)",
  "--gr": "#13784B",
  "--grs": "rgba(19,120,75,.12)",
  "--rd": "#E5484D",
  "--rds": "rgba(229,72,77,.12)",
  "--te": "#0B7468",
  "--tes": "rgba(11,116,104,.12)",
  "--co": "#C2410C",
  "--cos": "rgba(194,65,12,.11)",
};

/** Shared canvas classes defined in static/canvas.css. */
export const CANVAS_CLASSES = ["gl", "glass", "pill", "btn", "bk", "bw", "bt", "kc", "eb", "xs", "mu", "fa", "mono", "ic", "rec"] as const;

/** Per surface: the page, its stylesheet, its renderer, the canvas files it follows and the classes it must use. */
export const SURFACES = [
  { canvas: ["Dock.dc.html", "DockCollapsed.dc.html", "OffRecord.dc.html"], html: "dock.html", css: "dock.css", js: "dock.js", viewModel: "src/dock.mts dockViewModel", classes: ["glass", "pill", "btn", "bk", "bw", "tile", "rec", "eb"] },
  { canvas: ["Buddy.dc.html", "BuddyStop.dc.html"], html: "overlay.html", css: "overlay.css", js: "overlay.js", viewModel: "src/overlay.mts (overlay view), static/flightPath.js", classes: ["glass", "caption", "halo", "flight"] },
  { canvas: ["FloatPanel.dc.html"], html: "panel.html", css: "panel.css", js: "panel.js", viewModel: "src/panel.mts panelViewModel, surfaceMaterial", classes: ["glass", "pill", "btn", "bk", "bw", "kc", "eb"] },
  { canvas: ["(first-run setup, companion style)"], html: "setup.html", css: "setup.css", js: "setup.js", viewModel: "src/appUrl.mts checkAppUrl", classes: ["glass", "btn", "bk", "eb"] },
] as const;

export const FONT_FILES = ["fonts/Geist-Variable.woff2", "fonts/GeistMono-Variable.woff2"] as const;
export const FONT_LICENSE = "fonts/OFL.txt";
