// Garment Designer — prototype (AI image generation flow)
// BOUNDARY: this tool only ever produces front + back on-model renders.
// No flat-lay generation — the model shots (with logo/name/number applied)
// are what get shown to the customer AND emailed to the reseller + Brad.
// BOUNDARY: every generated/edited image must show the FULL garment,
// shoulders/collar to hem, never cropped — this is appended to every
// image prompt below, not left to chance.

const API_BASE = ""; // same-origin — works locally AND through a shared/tunnel URL
const MAX_TWEAKS = 3;

// Each Kit Builder deployment is a cloned, branded site for ONE reseller —
// this would be set per site at deploy time, not entered by the customer.
const RESELLER_CONFIG = {
  name: "NZ Uniforms",
  notifyEmail: "francine.miller@nzuniforms.com",
};

// Custom team/name fonts, loaded from local files rather than relying on
// whatever's installed on the customer's device. "Impact Custom" (not
// "Impact") so this always renders TPR's exact font file, not a
// similarly-named system font that may look different on the customer's device.
const FONT_FILES = [
  { label: "Gotham Bold", family: "Gotham Bold", file: "gotham-bold.ttf" },
  { label: "Impact", family: "Impact Custom", file: "impact.ttf" },
  { label: "Norwester", family: "Norwester", file: "norwester.otf" },
  { label: "Sablon Up College", family: "Sablon Up College", file: "sablon-up-college.otf" },
  { label: "Airstrike", family: "Airstrike", file: "airstrike.ttf" },
];
const FONT_OPTIONS = [
  { label: "Classic", family: "Arial, sans-serif", weight: "bold" },
  ...FONT_FILES.map((f) => ({ label: f.label, family: f.family, weight: "normal" })),
];
// Canvas text rendering does NOT wait for @font-face to finish loading --
// if you draw before it's ready you silently get the fallback font with no
// error. Loading explicitly via the FontFace API (rather than just a CSS
// @font-face rule) gives a promise to await before the font picker/preview
// ever draws with a custom font.
const fontsReady = Promise.all(
  FONT_FILES.map((f) =>
    new FontFace(f.family, `url(fonts/${f.file})`)
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch((err) => console.warn(`Font failed to load: ${f.label}`, err))
  )
);

const state = {
  designRaw: "",
  tweaks: [],
  tweakCount: 0,
  images: { modelFront: null, modelBack: null, flatFront: null, flatBack: null },
  logo: { wanted: false, placement: "", dataUrl: null },
  name: { wanted: false, text: "", placement: "", font: FONT_OPTIONS[0] },
  number: { wanted: false, text: "", placement: "" },
  contactName: "",
  contactEmail: "",
  clubName: "",
  contactPhone: "",
  extraGarments: [], // [{ name, image }] — same design applied to other garment types
  history: [], // [{ id, label, front, back }] — every version generated, for click-to-revert
  // Logo/name/number are never baked into state.images -- they live here as
  // persistent, always-draggable layers on top of the base photo, and only
  // get composited into a flat image on demand (download, quote, extra
  // garments). This is what lets the customer keep repositioning any of
  // them at any point in the session instead of locking each one in place
  // the moment it's placed.
  layers: [], // [{ id, kind, view, type, content, left, top, width, height, curve, rotationDeg, fontFamily, fontWeight, overlay, applyStyle }]
};
let historyIdCounter = 0;

// ---------- Prompt building ----------
const FRAMING_RULE = "Full-length shot: EVERY piece of the outfit must be completely visible in frame with nothing cropped off. If the outfit has multiple pieces (e.g. a top AND shorts/pants), frame wide enough to show the full length of ALL pieces together, from the shoulders/collar all the way down to the bottom hem of the LOWEST garment (not just the top) - step the camera back if needed rather than cropping any piece out.";

// BOUNDARY: colours only change when explicitly asked. A tweak request like
// "make it look like ocean waves" describes a PATTERN/STYLE, not permission
// to recolour the garment to blue just because the theme suggests it.
const COLOR_LOCK_RULE = "Colour rule: keep the exact colours already established on this garment unless the customer explicitly asks to change a colour. Apply any requested pattern, style, or theme (e.g. \"ocean waves\", \"flames\", \"camo\") using ONLY the existing colour palette - do not reinterpret a theme word as a reason to change the colours.";

// BOUNDARY: never invent or substitute a real third-party brand logo/mark
// (observed happening: a Nike swoosh and a New Balance-style logo appeared
// on generated garments, completely unprompted). Any logo shown must be
// EXACTLY whatever the customer's own reference/upload shows -- nothing
// invented, nothing borrowed from a real brand.
const NO_TRADEMARKS_RULE = "Logo/brand rule: do NOT add, invent, or substitute any logo, brand mark, or trademark that is not explicitly part of this design brief. In particular, never generate real-world brand logos (e.g. Nike, Adidas, New Balance, Puma, Under Armour, or any other real company's mark) under any circumstances. If a logo is already shown on the reference image, reproduce that exact logo unchanged -- do not redraw, restyle, or replace it with a different mark. If no logo is shown on the reference, the garment has NO logo: leave the chest, sleeve, and every other area of plain fabric completely blank -- no icon, symbol, emblem, swoosh, leaf, animal, letter mark, or any other small graphic of any kind. A blank plain surface is the correct and required result whenever no logo was requested, even though real sportswear almost always has one -- this design must not.";

function fullDesignDescription() {
  let desc = state.designRaw;
  if (state.tweaks.length) desc += ". Adjustments: " + state.tweaks.join("; ");
  return desc;
}


function buildModelFrontPrompt() {
  return `Professional sportswear catalog photograph of a model wearing a custom sublimated garment, front view, facing the camera. Design: ${fullDesignDescription()}. Studio lighting, plain light grey background, realistic fabric texture. ${FRAMING_RULE} ${NO_TRADEMARKS_RULE}`;
}

function buildModelBackEditPrompt() {
  return `Show the same model wearing the exact same garment, same design, same colours and pattern, but now viewed from behind (back facing the camera). Keep the studio lighting and background identical. ${FRAMING_RULE} ${NO_TRADEMARKS_RULE}`;
}

// ---------- Backend calls ----------
async function generateImage(prompt) {
  const res = await fetch(`${API_BASE}/api/generate-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, size: "1024x1024" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Image generation failed");
  return `data:image/png;base64,${data.image_b64}`;
}

async function editImage(sourceDataUrls, prompt) {
  const images_b64 = sourceDataUrls.map((u) => u.split(",")[1]);
  const res = await fetch(`${API_BASE}/api/edit-image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images_b64, prompt, size: "1024x1024" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Image edit failed");
  return `data:image/png;base64,${data.image_b64}`;
}

// ---------- Preview pane ----------
const els = {
  placeholder: document.getElementById("image-placeholder"),
  loading: document.getElementById("image-loading"),
  loadingText: document.getElementById("image-loading-text"),
  img: document.getElementById("preview-image"),
  downloadBtn: document.getElementById("download-image-btn"),
  tabsContainer: document.getElementById("image-tabs"),
};
let activeTab = "modelFront";
// While a layer is mid-creation (between being created and the customer
// hitting "Continue"), switching Front/Back should move THAT layer to the
// tapped side, matching the old "whichever tab is active when you confirm"
// behavior -- but only during creation, not on every ordinary tab click.
let placingLayer = null;

function getTabs() { return [...els.tabsContainer.querySelectorAll(".view-btn")]; }

function setLoading(text) {
  els.placeholder.style.display = "none";
  els.img.style.display = "none";
  els.downloadBtn.style.display = "none";
  els.loading.style.display = "flex";
  els.loadingText.textContent = text;
}

function showTab(tab) {
  activeTab = tab;
  getTabs().forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const src = state.images[tab];
  els.loading.style.display = "none";
  if (src) {
    els.placeholder.style.display = "none";
    els.img.src = src;
    els.img.style.display = "block";
    els.downloadBtn.style.display = "inline-block";
  } else {
    els.img.style.display = "none";
    els.downloadBtn.style.display = "none";
    els.placeholder.style.display = "block";
  }
  state.layers.forEach((layer) => {
    if (layer.overlay) layer.overlay.style.display = layer.view === tab ? "" : "none";
  });
}

// Delegated (not per-button) so tabs added later for extra garments work
// without needing their own listener wired up.
els.tabsContainer.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-btn");
  if (!btn || btn.disabled) return;
  if (placingLayer && (btn.dataset.tab === "modelFront" || btn.dataset.tab === "modelBack")) {
    placingLayer.view = btn.dataset.tab;
  }
  showTab(btn.dataset.tab);
});

function enableTab(tab) {
  const btn = els.tabsContainer.querySelector(`.view-btn[data-tab="${tab}"]`);
  if (btn) btn.disabled = false;
}

function addGarmentTab(key, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "view-btn";
  btn.dataset.tab = key;
  btn.textContent = label;
  els.tabsContainer.appendChild(btn);
}

els.downloadBtn.addEventListener("click", async () => {
  const dataUrl = await compositeView(activeTab);
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `design-${activeTab}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

// ---------- Version history ----------
const historyStrip = document.getElementById("history-strip");
const historyThumbs = document.getElementById("history-thumbs");

function pushHistory(label) {
  if (!state.images.modelFront || !state.images.modelBack) return;
  state.history.push({
    id: ++historyIdCounter,
    label,
    front: state.images.modelFront,
    back: state.images.modelBack,
  });
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) { historyStrip.style.display = "none"; return; }
  historyStrip.style.display = "block";
  historyThumbs.innerHTML = "";
  state.history.forEach((entry) => {
    const isActive = state.images.modelFront === entry.front;
    const thumb = document.createElement("div");
    thumb.className = `history-thumb${isActive ? " active" : ""}`;
    const img = document.createElement("img");
    img.src = entry.front;
    img.alt = entry.label;
    const labelDiv = document.createElement("div");
    labelDiv.className = "history-thumb-label";
    labelDiv.textContent = entry.label;
    thumb.appendChild(img);
    thumb.appendChild(labelDiv);
    thumb.addEventListener("click", () => {
      if (state.images.modelFront === entry.front) return;
      state.images.modelFront = entry.front;
      state.images.modelBack = entry.back;
      showTab("modelFront");
      renderHistory();
      addMessage(`Went back to: ${entry.label}`, "user");
    });
    historyThumbs.appendChild(thumb);
  });
  historyThumbs.scrollLeft = historyThumbs.scrollWidth;
}

// ---------- Drag-to-position compositor ----------
// Logo/name/number are placed by the CUSTOMER dragging them directly onto
// the photo and flattened in with canvas -- zero AI calls, so it's instant.
// (No AI blending means it can look "pasted on" rather than wrapped into
// the fabric -- traded on purpose for speed; easy to revert if it doesn't
// hold up.)
const imageWrap = document.querySelector(".image-wrap");

// The placement box's width MUST match the text's real rendered width in
// its actual font, not a character-count guess -- a mismatch there is
// what let curved letters spill past the box and get clipped (the box
// thought the text was narrower than it actually rendered). Same font
// string drawStyledText uses, so the measurement always matches the draw.
const _measureCtx = document.createElement("canvas").getContext("2d");
function measureTextWidth(text, fontFamily, fontWeight, fontSize) {
  _measureCtx.font = `${fontWeight || "bold"} ${fontSize}px ${fontFamily || "Arial, sans-serif"}`;
  return _measureCtx.measureText(text).width;
}

// Shared arc math: given a curve amount and the flat text width, returns
// the circle radius/angle used to place letters along an arc, plus the
// "sagitta" (how far the curve bulges vertically) the live preview box
// uses to grow/shrink to fit as the curve changes.
//
// Letters are positioned by walking along the arc by their actual pixel
// width (arc length), so the radius must satisfy arcLength = radius *
// angle -- NOT the chord (straight-line endpoint-to-endpoint) formula.
// Using the chord formula here previously caused a chord/arc-length
// mismatch that over-rotated every letter, worse the more the text
// curved (visible as letters tipping almost sideways at moderate curve).
function curveGeometry(curveVal, textWidth) {
  const c = Math.max(-1, Math.min(1, curveVal / 100));
  if (c === 0 || !textWidth) return { radius: 0, totalAngle: 0, sagitta: 0, curveSign: 1 };
  // Max total sweep kept modest (was 140deg) -- text-on-a-path only looks
  // "clean" like a badge/logo curve at gentle-to-moderate angles; beyond
  // that individual letters read as tilted rather than smoothly arced.
  const maxSpread = (60 * Math.PI) / 180;
  const totalAngle = c * maxSpread;
  const halfAngle = Math.abs(totalAngle) / 2;
  const radius = halfAngle > 0.001 ? textWidth / (2 * halfAngle) : 0;
  const sagitta = radius ? radius * (1 - Math.cos(halfAngle)) : 0;
  return { radius, totalAngle, sagitta, curveSign: c > 0 ? 1 : -1 };
}

// Dashed guide shown while dragging: a plain rectangle when flat, or an
// arc tracing the same curve as the text when curved -- so the guide
// always reflects the actual shape being placed instead of a static box.
function drawCurveGuide(ctx, { x, y, width, height, curve = 0 }) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const { radius, totalAngle, curveSign } = curveGeometry(curve, width);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(200,16,46,0.9)";
  ctx.lineWidth = 1.5;
  if (!radius) {
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, width - 1), Math.max(0, height - 1));
    ctx.restore();
    return;
  }
  const halfAngle = Math.abs(totalAngle) / 2;
  const steps = 24;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const angle = -halfAngle + (i / steps) * (2 * halfAngle);
    const px = cx + radius * Math.sin(angle);
    const py = cy + radius * (Math.cos(angle) - 1) * curveSign;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

// Shared by the live drag-preview canvas AND the final flatten-to-image
// canvas, so what the customer sees while positioning is exactly what
// gets baked into the final picture.
function drawStyledText(ctx, text, { x, y, width, height, curve = 0, color = "#fff", strokeColor = "#000", fontFamily = "Arial, sans-serif", fontWeight = "bold" }) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const n = text.length;
  if (n === 0) return;

  const fontSize = height;
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, fontSize * 0.08);
  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = color;

  const chars = text.split("");
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalWidth = widths.reduce((a, w) => a + w, 0);

  const drawChar = (ch, px, py, angle) => {
    ctx.save();
    ctx.translate(px, py);
    if (angle) ctx.rotate(angle);
    ctx.strokeText(ch, 0, 0);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  };

  const c = Math.max(-1, Math.min(1, curve / 100));
  if (c === 0) {
    ctx.textBaseline = "middle";
    let cursor = cx - totalWidth / 2;
    chars.forEach((ch, i) => {
      drawChar(ch, cursor + widths[i] / 2, cy, 0);
      cursor += widths[i];
    });
    return;
  }

  // Curve (-100..100): letters follow an arc, same convention as text
  // wrapped around a circle (dome = top half of the circle, smile =
  // bottom half), not just "sit on top either way":
  // Negative (dome): ends dip DOWN, middle lifts up -- like the TOP of a
  // circle, circle center below the text -- letters stand on TOP of the
  // line, extending away from that center.
  // Positive (smile): ends lift UP, middle dips down -- like the BOTTOM
  // of a circle, circle center above the text -- letters HANG BELOW the
  // line instead, extending away from that (now-above) center.
  // Each letter is placed by its cumulative arc-length position (i.e.
  // where it would sit in the flat layout, converted to an angle) rather
  // than an equal angle slot per character -- otherwise wider/narrower
  // letters end up unevenly spaced or overlapping along the curve.
  const { radius, totalAngle, curveSign } = curveGeometry(curve, totalWidth);
  ctx.textBaseline = curveSign > 0 ? "top" : "alphabetic";
  const halfAngle = Math.abs(totalAngle) / 2;

  let cumulative = 0;
  chars.forEach((ch, i) => {
    const center = cumulative + widths[i] / 2;
    cumulative += widths[i];
    const t = totalWidth > 0 ? (center / totalWidth) * 2 - 1 : 0; // -1 (start) .. 1 (end)
    const angle = t * halfAngle;
    const dx = radius ? radius * Math.sin(angle) : 0;
    const dy = radius ? radius * (Math.cos(angle) - 1) * curveSign : 0;
    // Rotation must match the tangent of the (dx,dy) path at this point, not
    // just the raw angle -- verified by comparing each letter's assigned
    // rotation against the actual direction to its neighbor; the un-negated
    // angle was consistently backwards (e.g. first letter tilted left when
    // the path there tangents right), which read as letters not sitting
    // cleanly on the line even though their up/down side was already correct.
    drawChar(ch, cx + dx, cy + dy, -angle * curveSign);
  });
}

// Draws one layer (logo image or name/number text) onto an already-scaled
// canvas context. Shared by compositeView (the only place layers actually
// get baked into pixels) -- the live on-screen overlay never flattens
// anything, it just stays a draggable DOM element indefinitely.
function drawLayerOnCanvas(ctx, layer, scaleX, scaleY) {
  return new Promise((resolve, reject) => {
    const x = layer.left * scaleX;
    const y = layer.top * scaleY;
    const w = layer.width * scaleX;
    const h = layer.height * scaleY;
    if (layer.type === "image") {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, x, y, w, h);
        resolve();
      };
      img.onerror = reject;
      img.src = layer.content;
    } else {
      ctx.save();
      if (layer.rotationDeg) {
        const cx = x + w / 2;
        const cy = y + h / 2;
        ctx.translate(cx, cy);
        ctx.rotate((layer.rotationDeg * Math.PI) / 180);
        ctx.translate(-cx, -cy);
      }
      drawStyledText(ctx, layer.content, { x, y, width: w, height: h, curve: layer.curve, fontFamily: layer.fontFamily, fontWeight: layer.fontWeight });
      ctx.restore();
      resolve();
    }
  });
}

// The base photo (state.images[view]) is NEVER mutated by placing a logo/
// name/number -- this composites the current base plus every live layer
// for that view into one flat image, computed fresh every time it's
// needed (download, quote, extra-garment reference), so it always
// reflects wherever the customer has currently dragged things.
function compositeView(view) {
  return new Promise((resolve, reject) => {
    const baseDataUrl = state.images[view];
    if (!baseDataUrl) { resolve(baseDataUrl); return; }
    const baseImg = new Image();
    baseImg.onload = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = baseImg.naturalWidth;
      canvas.height = baseImg.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);

      const containerWidth = imageWrap.clientWidth;
      const containerHeight = imageWrap.clientHeight;
      const scaleX = canvas.width / containerWidth;
      const scaleY = canvas.height / containerHeight;

      try {
        for (const layer of state.layers.filter((l) => l.view === view)) {
          await drawLayerOnCanvas(ctx, layer, scaleX, scaleY);
        }
      } catch (err) {
        reject(err);
        return;
      }
      resolve(canvas.toDataURL("image/png"));
    };
    baseImg.onerror = reject;
    baseImg.src = baseDataUrl;
  });
}

const DEFAULT_PLACEMENTS = {
  logo: { view: "modelFront", leftPct: 0.58, topPct: 0.20, size: 60 },
  name: { view: "modelBack", leftPct: 0.5, topPct: 0.16, size: 32 },
  number: { view: "modelBack", leftPct: 0.5, topPct: 0.40, size: 60 },
};

// Mounts a layer as a permanently-draggable/resizable(/rotatable for name)
// DOM overlay bound directly to the layer object -- dragging, resizing,
// rotating and curve changes mutate the layer's own left/top/width/height/
// curve/rotationDeg in place, so the change persists for the rest of the
// session. Nothing here ever flattens or removes the overlay; the only
// thing that ever changes its visibility is showTab() hiding layers that
// belong to the other side.
function mountPersistentLayer(layer) {
  const shapeControlsEnabled = layer.kind === "name";

  const overlay = document.createElement("div");
  overlay.className = layer.type === "image" ? "drag-overlay-logo" : "drag-overlay-text";
  overlay.dataset.layerId = String(layer.id);
  layer.overlay = overlay;

  let previewCanvas = null;
  if (layer.type === "image") {
    const innerImg = document.createElement("img");
    innerImg.src = layer.content;
    innerImg.style.width = "100%";
    innerImg.style.height = "100%";
    innerImg.style.display = "block";
    innerImg.style.pointerEvents = "none";
    overlay.appendChild(innerImg);
  } else {
    previewCanvas = document.createElement("canvas");
    previewCanvas.style.position = "absolute";
    previewCanvas.style.left = "0";
    previewCanvas.style.top = "0";
    previewCanvas.style.width = "100%";
    previewCanvas.style.height = "100%";
    previewCanvas.style.pointerEvents = "none";
    overlay.appendChild(previewCanvas);
  }

  function redrawTextPreview(effectiveHeight) {
    if (!previewCanvas) return;
    const ch = Math.max(1, Math.round(effectiveHeight));
    previewCanvas.width = Math.max(1, Math.round(layer.width));
    previewCanvas.height = ch;
    const pctx = previewCanvas.getContext("2d");
    pctx.clearRect(0, 0, previewCanvas.width, ch);
    const boxY = (ch - layer.height) / 2;
    drawCurveGuide(pctx, { x: 0, y: boxY, width: previewCanvas.width, height: layer.height, curve: layer.curve });
    drawStyledText(pctx, layer.content, { x: 0, y: boxY, width: previewCanvas.width, height: layer.height, curve: layer.curve, fontFamily: layer.fontFamily, fontWeight: layer.fontWeight });
  }

  const minSize = layer.type === "image" ? 24 : 16;
  const maxSize = layer.type === "image" ? 220 : 110;

  function setSize(newHeight) {
    layer.height = Math.max(minSize, Math.min(maxSize, newHeight));
    layer.width = layer.type === "image"
      ? layer.height
      : Math.min(imageWrap.clientWidth * 0.9, measureTextWidth(layer.content, layer.fontFamily, layer.fontWeight, layer.height) + 16);
  }
  function clamp() {
    const containerWidth = imageWrap.clientWidth;
    const containerHeight = imageWrap.clientHeight;
    layer.left = Math.max(0, Math.min(containerWidth - layer.width, layer.left));
    layer.top = Math.max(0, Math.min(containerHeight - layer.height, layer.top));
  }
  function applyStyle() {
    clamp();
    const sagitta = layer.type === "image" ? 0 : curveGeometry(layer.curve, layer.width).sagitta;
    const effectiveHeight = layer.height + sagitta;
    overlay.style.left = `${layer.left}px`;
    overlay.style.top = `${layer.top - sagitta / 2}px`;
    overlay.style.width = `${layer.width}px`;
    overlay.style.height = `${effectiveHeight}px`;
    overlay.style.transform = layer.rotationDeg ? `rotate(${layer.rotationDeg}deg)` : "";
    if (layer.type !== "image") redrawTextPreview(effectiveHeight);
  }
  layer.applyStyle = applyStyle; // exposed so the curve slider can trigger a redraw

  applyStyle();
  overlay.style.display = layer.view === activeTab ? "" : "none";
  imageWrap.appendChild(overlay);

  const handle = document.createElement("div");
  handle.className = "resize-handle";
  overlay.appendChild(handle);

  let rotateHandle = null;
  if (shapeControlsEnabled) {
    rotateHandle = document.createElement("div");
    rotateHandle.className = "rotate-handle";
    rotateHandle.title = "Drag to rotate";
    rotateHandle.textContent = "↻";
    overlay.appendChild(rotateHandle);
  }

  let dragging = false, startX, startY, startLeft, startTop;
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === handle || e.target === rotateHandle) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = layer.left;
    startTop = layer.top;
    try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture too */ }
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    layer.left = startLeft + (e.clientX - startX);
    layer.top = startTop + (e.clientY - startY);
    applyStyle();
  });
  overlay.addEventListener("pointerup", () => { dragging = false; });
  overlay.addEventListener("pointercancel", () => { dragging = false; });

  let resizing = false, resizeStartX, resizeStartY, resizeStartHeight;
  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    resizing = true;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartHeight = layer.height;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture too */ }
  });
  handle.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    e.stopPropagation();
    // Rotate the raw mouse delta back into the box's own (unrotated) frame
    // first, so dragging still feels like grow/shrink even when the box
    // itself is angled.
    const rawDx = e.clientX - resizeStartX;
    const rawDy = e.clientY - resizeStartY;
    const rad = (-layer.rotationDeg * Math.PI) / 180;
    const dx = rawDx * Math.cos(rad) - rawDy * Math.sin(rad);
    const dy = rawDx * Math.sin(rad) + rawDy * Math.cos(rad);
    setSize(resizeStartHeight + (dx + dy) / 2);
    applyStyle();
  });
  handle.addEventListener("pointerup", (e) => { e.stopPropagation(); resizing = false; });
  handle.addEventListener("pointercancel", (e) => { e.stopPropagation(); resizing = false; });

  if (rotateHandle) {
    let rotating = false;
    rotateHandle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      rotating = true;
      try { rotateHandle.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture too */ }
    });
    rotateHandle.addEventListener("pointermove", (e) => {
      if (!rotating) return;
      e.stopPropagation();
      const rect = overlay.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const angle = (Math.atan2(e.clientY - cy, e.clientX - cx) * 180) / Math.PI;
      layer.rotationDeg = Math.round(angle + 90);
      overlay.style.transform = `rotate(${layer.rotationDeg}deg)`;
    });
    rotateHandle.addEventListener("pointerup", (e) => { e.stopPropagation(); rotating = false; });
    rotateHandle.addEventListener("pointercancel", (e) => { e.stopPropagation(); rotating = false; });
  }
}

// ---------- Chat engine ----------
// Every interactive prompt (buttons AND inputs) mounts as an inline widget
// inside the chat log itself, right where the conversation is — not in a
// separate fixed bar. Once answered, the widget is replaced by an echoed
// user message, same as a normal chat thread.
const chatLog = document.getElementById("chat-log");

function addMessage(text, from) {
  const div = document.createElement("div");
  div.className = `msg ${from}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function mountWidget(buildFn) {
  const wrap = document.createElement("div");
  wrap.className = "inline-widget";
  buildFn(wrap);
  chatLog.appendChild(wrap);
  chatLog.scrollTop = chatLog.scrollHeight;
  return wrap;
}

function composerText(placeholder, onSubmit) {
  mountWidget((wrap) => {
    const row = document.createElement("div");
    row.className = "composer-row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    const btn = document.createElement("button");
    btn.className = "btn-primary";
    btn.textContent = "Continue";
    const submit = () => {
      const val = input.value.trim();
      if (!val) return;
      wrap.remove();
      addMessage(val, "user");
      onSubmit(val);
    };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    row.appendChild(input);
    row.appendChild(btn);
    wrap.appendChild(row);
    input.focus();
  });
}

function composerChips(options) {
  mountWidget((wrap) => {
    const row = document.createElement("div");
    row.className = "chip-row";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "chip-btn";
      btn.textContent = opt.label;
      btn.addEventListener("click", () => {
        wrap.remove();
        addMessage(opt.label, "user");
        opt.onClick();
      });
      row.appendChild(btn);
    });
    wrap.appendChild(row);
  });
}

// Two separate steps on purpose: upload first (can't proceed with no file
// actually chosen), then placement as its own follow-up question.
function composerUploadOnly(uploadLabel, onSkip, onUploaded) {
  mountWidget((wrap) => {
    wrap.innerHTML = `<div class="field"><label>Upload file</label><input type="file" id="c-file" accept="image/*" /></div>`;
    const btnRow = document.createElement("div");
    btnRow.className = "chip-row";
    const skipBtn = document.createElement("button");
    skipBtn.className = "chip-btn";
    skipBtn.textContent = "Skip — not needed";
    skipBtn.addEventListener("click", () => { wrap.remove(); addMessage("Skip", "user"); onSkip(); });
    const addBtn = document.createElement("button");
    addBtn.className = "btn-primary";
    addBtn.textContent = uploadLabel;
    addBtn.disabled = true; // only enabled once a real file is chosen
    const fileInput = wrap.querySelector("#c-file");
    fileInput.addEventListener("change", () => { addBtn.disabled = !fileInput.files[0]; });
    addBtn.addEventListener("click", () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        wrap.remove();
        addMessage("Uploaded file", "user");
        onUploaded(reader.result);
      };
      reader.readAsDataURL(file);
    });
    btnRow.appendChild(skipBtn);
    btnRow.appendChild(addBtn);
    wrap.appendChild(btnRow);
  });
}

function composerTextOnly(placeholder, onSkip, onSubmit) {
  mountWidget((wrap) => {
    const row = document.createElement("div");
    row.className = "composer-row";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn-secondary";
    skipBtn.textContent = "Skip";
    skipBtn.addEventListener("click", () => { wrap.remove(); addMessage("Skip", "user"); onSkip(); });
    const btn = document.createElement("button");
    btn.className = "btn-primary";
    btn.textContent = "Continue";
    const submit = () => {
      const val = input.value.trim();
      if (!val) return;
      wrap.remove();
      addMessage(val, "user");
      onSubmit(val);
    };
    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    row.appendChild(input);
    row.appendChild(skipBtn);
    row.appendChild(btn);
    wrap.appendChild(row);
    input.focus();
  });
}

function composerContactForm(onDone) {
  mountWidget((wrap) => {
    wrap.innerHTML = `
      <div class="field"><label>Club name</label><input type="text" id="c-club" placeholder="e.g. Eastside Hockey Club" /></div>
      <div class="field"><label>Your name</label><input type="text" id="c-name" placeholder="e.g. Francine Miller" /></div>
      <div class="field"><label>Your email</label><input type="email" id="c-email" placeholder="you@example.com" /></div>
      <div class="field"><label>Your phone number</label><input type="tel" id="c-phone" placeholder="e.g. 021 234 5678" /></div>
    `;
    const btnRow = document.createElement("div");
    btnRow.className = "chip-row";
    const btn = document.createElement("button");
    btn.className = "btn-primary";
    btn.textContent = "Continue";
    btn.addEventListener("click", () => {
      state.clubName = wrap.querySelector("#c-club").value.trim();
      state.contactName = wrap.querySelector("#c-name").value.trim();
      state.contactEmail = wrap.querySelector("#c-email").value.trim();
      state.contactPhone = wrap.querySelector("#c-phone").value.trim();
      wrap.remove();
      addMessage(`${state.clubName} — ${state.contactName} — ${state.contactEmail} — ${state.contactPhone}`, "user");
      onDone();
    });
    btnRow.appendChild(btn);
    wrap.appendChild(btnRow);
  });
}

function composerReview() {
  mountWidget((wrap) => {
    const row = document.createElement("div");
    row.className = "chip-row";
    const quoteBtn = document.createElement("button");
    quoteBtn.className = "btn-primary";
    quoteBtn.textContent = "Request a Quote";
    quoteBtn.addEventListener("click", () => { wrap.remove(); onFinalAction("quote"); });
    const emailBtn = document.createElement("button");
    emailBtn.className = "btn-secondary";
    emailBtn.textContent = "Email Design";
    emailBtn.addEventListener("click", () => { wrap.remove(); onFinalAction("email"); });
    row.appendChild(quoteBtn);
    row.appendChild(emailBtn);
    wrap.appendChild(row);
  });
}

// ---------- Conversation script ----------
function startConversation() {
  addMessage("Hi! What garment and design did you want? (e.g. \"Black/red/white netball dress with a swirl pattern\")", "bot");
  composerText("e.g. Black/red/white football tee with swirls", (val) => {
    state.designRaw = val;
    generateModelShots();
  });
}

async function generateModelShots() {
  setLoading("Generating your design concept…");
  showTab("modelFront");
  document.querySelector('#image-tabs .view-btn[data-tab="modelBack"]').disabled = true;
  try {
    const front = await generateImage(buildModelFrontPrompt());
    state.images.modelFront = front;
    showTab("modelFront");

    setLoading("Generating the back view…");
    const back = await editImage([front], buildModelBackEditPrompt());
    state.images.modelBack = back;
    enableTab("modelBack");
    showTab("modelFront");
    pushHistory("Original concept");

    addMessage("Here's a concept — front and back. Want any changes, or does this look good?", "bot");
    addMessage("(Once you're happy with this, logos, names and numbers are next.)", "bot");
    offerTweakOrContinue();
  } catch (err) {
    addMessage(`Image generation failed: ${err.message}. Let's try describing it again.`, "bot");
    composerText("Describe the design again", (val) => { state.designRaw = val; generateModelShots(); });
  }
}

// Tweaks EDIT the existing image (img2img) rather than regenerating from
// text alone -- keeps colours/design anchored to what's already there
// instead of the model re-rolling the whole thing fresh each time.
async function applyTweak(tweakText) {
  setLoading("Applying your changes…");
  try {
    const frontPrompt = `Modify this exact garment based on this request: "${tweakText}". ${COLOR_LOCK_RULE} Original design brief for reference: "${state.designRaw}". ${FRAMING_RULE} ${NO_TRADEMARKS_RULE}`;
    const front = await editImage([state.images.modelFront], frontPrompt);
    state.images.modelFront = front;
    showTab("modelFront");

    setLoading("Updating the back view…");
    const back = await editImage([front], buildModelBackEditPrompt());
    state.images.modelBack = back;
    showTab("modelFront");
    pushHistory(`Tweak: ${tweakText}`);

    addMessage("Here's the updated concept — front and back. Want any further changes, or does this look good?", "bot");
    offerTweakOrContinue();
  } catch (err) {
    addMessage(`Couldn't apply that change (${err.message}). Let's continue with what we have.`, "bot");
    offerTweakOrContinue();
  }
}

function offerTweakOrContinue() {
  const remaining = MAX_TWEAKS - state.tweakCount;
  if (remaining <= 0) {
    addMessage("We've used up the quick preview tweaks — our design team will handle any further refinement from here. Let's lock this in.", "bot");
    composerChips([{ label: "Continue", onClick: askLogo }]);
    return;
  }
  composerChips([
    { label: "Looks good", onClick: askLogo },
    { label: `Request changes (${remaining} left)`, onClick: () => {
      composerText("What should we change?", (val) => {
        state.tweaks.push(val);
        state.tweakCount += 1;
        applyTweak(val);
      });
    } },
  ]);
}

let layerIdCounter = 0;

// Creates a layer, mounts it as a permanently-draggable overlay, and shows
// a one-time "Continue" prompt to move the conversation on -- the layer
// itself is never removed or flattened, so the customer can come back and
// drag/resize/rotate it again at any later point in the session.
function createLayer({ kind, view, type, content, size, fontFamily, fontWeight }) {
  const defaults = DEFAULT_PLACEMENTS[kind];
  const containerWidth = imageWrap.clientWidth;
  const containerHeight = imageWrap.clientHeight;
  const height = size || defaults.size;
  const width = type === "image" ? height : Math.min(containerWidth * 0.9, measureTextWidth(content, fontFamily, fontWeight, height) + 16);
  const layer = {
    id: ++layerIdCounter,
    kind,
    view: view || defaults.view,
    type,
    content,
    left: containerWidth * defaults.leftPct - width / 2,
    top: containerHeight * defaults.topPct - height / 2,
    width,
    height,
    curve: 0,
    rotationDeg: 0,
    fontFamily,
    fontWeight,
  };
  state.layers.push(layer);
  showTab(layer.view);
  mountPersistentLayer(layer);
  return layer;
}

// Places the SAME content (logo file / name text / number text) once, then
// asks if it should go anywhere else too (e.g. the other side) before
// moving on -- so the same logo/name/number can end up on both front and
// back without re-uploading or re-typing it.
function askLogo() {
  addMessage("Want a logo added? Upload the file, or skip if you don't need one.", "bot");
  composerUploadOnly("Upload logo", () => { state.logo.wanted = false; askName(); }, (dataUrl) => {
    state.logo = { wanted: true, placement: "positioned by drag", dataUrl };
    createLogoLayer(dataUrl);
  });
}

// Each of logo/name/number re-asks for fresh content on "add another" --
// a second logo/name/number is usually DIFFERENT (e.g. a sponsor logo on
// the back, a different name for a different spot), not the same one
// just repositioned.
function createLogoLayer(dataUrl) {
  const layer = createLayer({ kind: "logo", type: "image", content: dataUrl });
  placingLayer = layer;
  addMessage("Drag it into place, resize with the corner handle, and switch Front/Back if you want it on the other side. You can always come back and move it again later.", "bot");
  composerChips([{ label: "Continue", onClick: () => {
    placingLayer = null;
    addMessage("Do you want to upload another logo?", "bot");
    composerChips([
      { label: "Yes", onClick: () => {
        composerUploadOnly("Upload logo", askName, (newDataUrl) => createLogoLayer(newDataUrl));
      } },
      { label: "No, that's it", onClick: askName },
    ]);
  } }]);
}

function askName() {
  addMessage("Want a team or player name added? Tell me what it should say — or skip.", "bot");
  composerTextOnly("e.g. EAGLES", () => { state.name.wanted = false; askNumber(); }, (text) => {
    askNameFont(text, (fontOpt) => {
      state.name = { wanted: true, text, placement: "positioned by drag", font: fontOpt };
      createNameLayer(text, fontOpt);
    });
  });
}

// A specimen grid -- each option shows the customer's own name text
// rendered in that font, not just a generic label, so the choice is
// judged on how their actual name looks rather than an abstract sample.
async function askNameFont(text, onDone) {
  addMessage("Pick a font style for the name:", "bot");
  await fontsReady;
  mountWidget((wrap) => {
    const grid = document.createElement("div");
    grid.className = "font-grid";
    FONT_OPTIONS.forEach((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "font-choice";
      const sample = document.createElement("span");
      sample.className = "font-choice-sample";
      sample.textContent = text;
      sample.style.fontFamily = opt.family;
      sample.style.fontWeight = opt.weight;
      const label = document.createElement("span");
      label.className = "font-choice-label";
      label.textContent = opt.label;
      btn.appendChild(sample);
      btn.appendChild(label);
      btn.addEventListener("click", () => {
        wrap.remove();
        addMessage(opt.label, "user");
        onDone(opt);
      });
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);
  });
}

// Same reasoning as logo: re-asks for fresh text on "yes" (could be a
// different name for a different spot) rather than assuming a repeat of
// the same text.
function createNameLayer(text, fontOpt) {
  const layer = createLayer({ kind: "name", type: "text", content: text, fontFamily: fontOpt.family, fontWeight: fontOpt.weight });
  placingLayer = layer;
  addMessage("Drag it into place, resize with the corner handle, drag the round handle above it to rotate, and switch Front/Back if you want it elsewhere. You can always come back and adjust it later.", "bot");

  mountWidget((wrap) => {
    const shapeRow = document.createElement("div");
    shapeRow.className = "field-row";
    const curveField = document.createElement("div");
    curveField.className = "field";
    const curveLabel = document.createElement("label");
    curveLabel.textContent = "Curve";
    const curveInput = document.createElement("input");
    curveInput.type = "range";
    curveInput.min = "-100";
    curveInput.max = "100";
    curveInput.value = "0";
    curveInput.addEventListener("input", () => {
      layer.curve = Number(curveInput.value);
      layer.applyStyle();
    });
    curveField.appendChild(curveLabel);
    curveField.appendChild(curveInput);
    shapeRow.appendChild(curveField);
    wrap.appendChild(shapeRow);

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "chip-btn";
    resetBtn.textContent = "Reset shape";
    resetBtn.addEventListener("click", () => {
      layer.curve = 0;
      layer.rotationDeg = 0;
      curveInput.value = "0";
      layer.applyStyle();
    });
    wrap.appendChild(resetBtn);

    const btnRow = document.createElement("div");
    btnRow.className = "chip-row";
    const continueBtn = document.createElement("button");
    continueBtn.className = "btn-primary";
    continueBtn.textContent = "Continue";
    continueBtn.addEventListener("click", () => {
      wrap.remove();
      addMessage("Continue", "user");
      placingLayer = null;
      addMessage("Do you want to add another name?", "bot");
      composerChips([
        { label: "Yes", onClick: () => {
          composerTextOnly("e.g. EAGLES", askNumber, (newText) => {
            askNameFont(newText, (newFontOpt) => createNameLayer(newText, newFontOpt));
          });
        } },
        { label: "No, that's it", onClick: askNumber },
      ]);
    });
    btnRow.appendChild(continueBtn);
    wrap.appendChild(btnRow);
  });
}

function askNumber() {
  addMessage("Want a number added? Tell me the number — or skip.", "bot");
  composerTextOnly("e.g. 9", () => { state.number.wanted = false; askOtherGarments(); }, (text) => {
    state.number = { wanted: true, text, placement: "positioned by drag" };
    createNumberLayer(text);
  });
}

function createNumberLayer(text) {
  // Matches whatever font was picked for the name, so the two agree on the
  // finished garment instead of the number defaulting to plain Arial.
  const fontOpt = state.name.font || FONT_OPTIONS[0];
  const layer = createLayer({ kind: "number", type: "text", content: text, fontFamily: fontOpt.family, fontWeight: fontOpt.weight });
  placingLayer = layer;
  addMessage("Drag it into place, resize with the corner handle, and switch Front/Back if you want it elsewhere. You can always come back and move it again later.", "bot");
  composerChips([{ label: "Continue", onClick: () => {
    placingLayer = null;
    addMessage("Do you want to add another number?", "bot");
    composerChips([
      { label: "Yes", onClick: () => {
        composerTextOnly("e.g. 9", askOtherGarments, (newText) => createNumberLayer(newText));
      } },
      { label: "No, that's it", onClick: askOtherGarments },
    ]);
  } }]);
}

function askOtherGarments() {
  addMessage("Did you want this design on any other garments?", "bot");
  composerChips([
    { label: "Yes", onClick: () => {
      composerText("e.g. shorts, socks, jacket", (val) => {
        const names = val.split(/,|\n|&|\band\b/i).map((s) => s.trim()).filter(Boolean);
        generateExtraGarments(names);
      });
    } },
    { label: "No", onClick: finalReviewCheck },
  ]);
}

// Final checkpoint once everything (design, logo/name/number, extra
// garments) is in place. A "yes" here edits front and back INDEPENDENTLY
// from themselves (not one derived from the other), so whatever's already
// been placed on each side isn't lost in the process.
function finalReviewCheck() {
  addMessage("How's everything looking? Did you want to change anything?", "bot");
  composerChips([
    { label: "Yes", onClick: () => {
      composerText("What would you like to change?", (val) => applyFinalTweak(val, finalReviewCheck));
    } },
    { label: "No", onClick: askContact },
  ]);
}

// Edits the CLEAN base photo -- logo/name/number are never baked into it,
// they're separate layers recomposited fresh on top afterward, so there's
// nothing here for the AI to accidentally preserve or disturb.
async function applyFinalTweak(tweakText, onDone) {
  setLoading("Applying your changes…");
  const buildPrompt = () => `Modify this exact garment based on this request: "${tweakText}". ${COLOR_LOCK_RULE} ${FRAMING_RULE} ${NO_TRADEMARKS_RULE}`;
  try {
    state.images.modelFront = await editImage([state.images.modelFront], buildPrompt());
    showTab("modelFront");
    setLoading("Applying your changes to the back…");
    state.images.modelBack = await editImage([state.images.modelBack], buildPrompt());
    showTab("modelFront");
    pushHistory(`Tweak: ${tweakText}`);
    addMessage("Here's the updated look.", "bot");
  } catch (err) {
    showTab("modelFront");
    addMessage(`Couldn't apply that change (${err.message}). Continuing with what we have.`, "bot");
  }
  onDone();
}

// Extra garments reuse the CONFIRMED hero image as a reference (img2img),
// so the same colours/pattern/logo carry over consistently instead of
// each item being re-imagined independently. Each one gets its own tab in
// the main preview -- so everything (hero front/back + every extra
// garment) lives on the one preview pane, not scattered through the chat.
// The reference is the COMPOSITED front (base + logo/name/number layers as
// currently positioned), not the clean base, so the AI can see and
// replicate whatever branding is actually on the hero shot right now.
async function generateExtraGarments(names) {
  const heroReference = await compositeView("modelFront");
  for (const name of names) {
    addMessage(`Generating ${name}…`, "bot");
    setLoading(`Generating ${name}…`);
    try {
      const prompt = `Generate a professional product photograph of a single ${name} ONLY -- not a combination or set with any other garment. Replicate the reference garment's pattern EXACTLY: same stripe/pattern layout, same stripe widths, same colours, same logo, in the same positions relative to the garment. Do not invent, add, or embellish with any new graphic elements, shapes, or decorations that are not present in the reference -- this must look like the same design family manufactured as a ${name}, nothing more, nothing less. ${COLOR_LOCK_RULE} ${FRAMING_RULE} ${NO_TRADEMARKS_RULE} Show only the ${name} by itself, full item visible, plain studio background.`;
      const img = await editImage([heroReference], prompt);
      const label = name[0].toUpperCase() + name.slice(1);
      let key = `extra_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      if (state.images[key]) key += `_${state.extraGarments.length}`; // avoid collisions on repeated/similar names
      state.images[key] = img;
      state.extraGarments.push({ name, image: img, key });
      addGarmentTab(key, label);
      showTab(key);
      addMessage(`${label} added — see the tabs above.`, "bot");
    } catch (err) {
      showTab("modelFront");
      addMessage(`Couldn't generate the ${name} (${err.message}).`, "bot");
    }
  }
  showTab("modelFront");
  addMessage("All done with extra garments — every item's viewable in the tabs above.", "bot");
  finalReviewCheck();
}

function askContact() {
  addMessage("Almost done — just need your details so we can get back to you.", "bot");
  composerContactForm(() => {
    addMessage("Perfect — request your quote whenever you're ready.", "bot");
    composerReview();
  });
}

// ---------- Quote capture ----------
function buildSpec(actionType) {
  return {
    submitted_at: "PROTOTYPE — timestamp would be set server-side",
    action: actionType, // "quote" | "email"
    reseller: RESELLER_CONFIG.name,
    notify_emails: actionType === "quote" ? [RESELLER_CONFIG.notifyEmail, "brad@theprocurementroom.co.nz"] : [state.contactEmail],
    club_name: state.clubName || null,
    contact_name: state.contactName || null,
    contact_email: state.contactEmail || null,
    contact_phone: state.contactPhone || null,
    design_description_raw: state.designRaw,
    tweaks_requested: state.tweaks,
    logo: state.logo.wanted ? { placement: state.logo.placement, uploaded: Boolean(state.logo.dataUrl) } : null,
    team_name: state.name.wanted ? { text: state.name.text, placement: state.name.placement } : null,
    back_number: state.number.wanted ? { text: state.number.text, placement: state.number.placement } : null,
    extra_garments: state.extraGarments.map((g) => g.name),
    images_attached: ["model_front", "model_back", ...state.extraGarments.map((g) => g.name)],
    next_step: "On approval + order placed, this spec + reference images go to production artwork (Stage 4) for true vector redraw — not generated automatically here.",
  };
}

const quoteModal = document.getElementById("quote-modal");
const quoteJson = document.getElementById("quote-json");
const quoteImages = document.getElementById("quote-images");

function renderImageFigure(container, src, label) {
  const fig = document.createElement("figure");
  fig.style.margin = "0";
  fig.innerHTML = `<img src="${src}" alt="${label}" /><div class="img-label">${label}</div>`;
  container.appendChild(fig);
}

async function onFinalAction(actionType) {
  const isQuote = actionType === "quote";
  document.getElementById("modal-title").textContent = isQuote
    ? "Thanks — your design request is in!"
    : "Your design is on its way!";
  document.getElementById("modal-note").innerHTML = isQuote
    ? `Nothing was actually sent (this is a prototype). In the live version, <strong>${RESELLER_CONFIG.name}</strong> and our team would be emailed right now with these images attached.`
    : `Nothing was actually sent (this is a prototype). In the live version, a copy of this design would be emailed to <strong>${state.contactEmail || "your email"}</strong> right now.`;
  quoteJson.textContent = JSON.stringify(buildSpec(actionType), null, 2);
  quoteImages.innerHTML = "";
  // Composited (base + current logo/name/number layer positions) -- these
  // are what actually gets attached, not the clean untouched base photo.
  const [frontComposite, backComposite] = await Promise.all([
    compositeView("modelFront"),
    compositeView("modelBack"),
  ]);
  renderImageFigure(quoteImages, frontComposite, "Model — Front");
  renderImageFigure(quoteImages, backComposite, "Model — Back");
  state.extraGarments.forEach((g) => renderImageFigure(quoteImages, g.image, g.name[0].toUpperCase() + g.name.slice(1)));
  quoteModal.classList.remove("hidden");
}

document.getElementById("close-modal-btn").addEventListener("click", () => quoteModal.classList.add("hidden"));

startConversation();
