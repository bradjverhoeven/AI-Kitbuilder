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

const state = {
  designRaw: "",
  tweaks: [],
  tweakCount: 0,
  images: { modelFront: null, modelBack: null, flatFront: null, flatBack: null },
  logo: { wanted: false, placement: "", dataUrl: null },
  name: { wanted: false, text: "", placement: "" },
  number: { wanted: false, text: "", placement: "" },
  contactName: "",
  contactEmail: "",
  clubName: "",
  contactPhone: "",
  extraGarments: [], // [{ name, image }] — same design applied to other garment types
  history: [], // [{ id, label, front, back }] — every version generated, for click-to-revert
};
let historyIdCounter = 0;

// ---------- Prompt building ----------
const FRAMING_RULE = "Full-length shot: EVERY piece of the outfit must be completely visible in frame with nothing cropped off. If the outfit has multiple pieces (e.g. a top AND shorts/pants), frame wide enough to show the full length of ALL pieces together, from the shoulders/collar all the way down to the bottom hem of the LOWEST garment (not just the top) - step the camera back if needed rather than cropping any piece out.";

// BOUNDARY: colours only change when explicitly asked. A tweak request like
// "make it look like ocean waves" describes a PATTERN/STYLE, not permission
// to recolour the garment to blue just because the theme suggests it.
const COLOR_LOCK_RULE = "Colour rule: keep the exact colours already established on this garment unless the customer explicitly asks to change a colour. Apply any requested pattern, style, or theme (e.g. \"ocean waves\", \"flames\", \"camo\") using ONLY the existing colour palette - do not reinterpret a theme word as a reason to change the colours.";

function fullDesignDescription() {
  let desc = state.designRaw;
  if (state.tweaks.length) desc += ". Adjustments: " + state.tweaks.join("; ");
  return desc;
}


function buildModelFrontPrompt() {
  return `Professional sportswear catalog photograph of a model wearing a custom sublimated garment, front view, facing the camera. Design: ${fullDesignDescription()}. Studio lighting, plain light grey background, realistic fabric texture. ${FRAMING_RULE}`;
}

function buildModelBackEditPrompt() {
  return `Show the same model wearing the exact same garment, same design, same colours and pattern, but now viewed from behind (back facing the camera). Keep the studio lighting and background identical. ${FRAMING_RULE}`;
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
  tabs: document.querySelectorAll("#image-tabs .view-btn"),
};
let activeTab = "modelFront";

function setLoading(text) {
  els.placeholder.style.display = "none";
  els.img.style.display = "none";
  els.downloadBtn.style.display = "none";
  els.loading.style.display = "flex";
  els.loadingText.textContent = text;
}

function showTab(tab) {
  activeTab = tab;
  els.tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
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
}

els.tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    showTab(btn.dataset.tab);
  });
});

function enableTab(tab) {
  const btn = document.querySelector(`#image-tabs .view-btn[data-tab="${tab}"]`);
  if (btn) btn.disabled = false;
}

els.downloadBtn.addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = state.images[activeTab];
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

function flattenOverlayToImage(baseDataUrl, type, content, left, top, width, height, containerWidth, containerHeight) {
  return new Promise((resolve, reject) => {
    const baseImg = new Image();
    baseImg.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = baseImg.naturalWidth;
      canvas.height = baseImg.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);

      const scaleX = canvas.width / containerWidth;
      const scaleY = canvas.height / containerHeight;
      const x = left * scaleX;
      const y = top * scaleY;
      const w = width * scaleX;
      const h = height * scaleY;

      if (type === "image") {
        const logoImg = new Image();
        logoImg.onload = () => {
          ctx.drawImage(logoImg, x, y, w, h);
          resolve(canvas.toDataURL("image/png"));
        };
        logoImg.onerror = reject;
        logoImg.src = content;
      } else {
        const fontSize = h;
        ctx.font = `bold ${fontSize}px Arial, sans-serif`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.lineWidth = Math.max(2, fontSize * 0.08);
        ctx.strokeStyle = "black";
        ctx.fillStyle = "white";
        ctx.strokeText(content, x, y);
        ctx.fillText(content, x, y);
        resolve(canvas.toDataURL("image/png"));
      }
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

function mountDraggablePlacement({ kind, type, content, onConfirm, onCancel }) {
  const defaults = DEFAULT_PLACEMENTS[kind];
  showTab(defaults.view);
  // Tabs stay enabled on purpose -- the customer can switch Front/Back
  // while positioning (e.g. to put the same logo on both sides across
  // repeat placements). Whichever tab is active at "Confirm" time is the
  // one the overlay gets flattened onto (read via `activeTab`).

  const containerWidth = imageWrap.clientWidth;
  const containerHeight = imageWrap.clientHeight;

  // Always a <div> for the positioned/draggable/resizable box -- <img> can't
  // render child nodes (like the resize handle), so the logo image goes
  // INSIDE this div rather than the div itself being the <img>.
  const overlay = document.createElement("div");
  overlay.className = type === "image" ? "drag-overlay-logo" : "drag-overlay-text";
  if (type === "image") {
    const innerImg = document.createElement("img");
    innerImg.src = content;
    innerImg.style.width = "100%";
    innerImg.style.height = "100%";
    innerImg.style.display = "block";
    innerImg.style.pointerEvents = "none";
    overlay.appendChild(innerImg);
  } else {
    overlay.textContent = content;
  }

  const minSize = type === "image" ? 24 : 16;
  const maxSize = type === "image" ? 220 : 110;
  let height = defaults.size;
  let width = type === "image" ? defaults.size : Math.min(containerWidth * 0.9, content.length * defaults.size * 0.62 + 16);
  let left = containerWidth * defaults.leftPct - width / 2;
  let top = containerHeight * defaults.topPct - height / 2;

  function setSize(newHeight) {
    height = Math.max(minSize, Math.min(maxSize, newHeight));
    width = type === "image" ? height : Math.min(containerWidth * 0.9, content.length * height * 0.62 + 16);
  }
  function clamp() {
    left = Math.max(0, Math.min(containerWidth - width, left));
    top = Math.max(0, Math.min(containerHeight - height, top));
  }
  function applyStyle() {
    clamp();
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.width = `${width}px`;
    if (type === "image") overlay.style.height = `${height}px`;
    else overlay.style.fontSize = `${height}px`;
  }
  applyStyle();
  imageWrap.appendChild(overlay);

  const handle = document.createElement("div");
  handle.className = "resize-handle";
  overlay.appendChild(handle);

  let dragging = false, startX, startY, startLeft, startTop;
  overlay.addEventListener("pointerdown", (e) => {
    if (e.target === handle) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startLeft = left;
    startTop = top;
    try { overlay.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture too */ }
  });
  overlay.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    left = startLeft + (e.clientX - startX);
    top = startTop + (e.clientY - startY);
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
    resizeStartHeight = height;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* fine without capture too */ }
  });
  handle.addEventListener("pointermove", (e) => {
    if (!resizing) return;
    e.stopPropagation();
    const delta = ((e.clientX - resizeStartX) + (e.clientY - resizeStartY)) / 2;
    setSize(resizeStartHeight + delta);
    applyStyle();
  });
  handle.addEventListener("pointerup", (e) => { e.stopPropagation(); resizing = false; });
  handle.addEventListener("pointercancel", (e) => { e.stopPropagation(); resizing = false; });

  function cleanup() {
    overlay.remove();
  }

  mountWidget((wrap) => {
    wrap.innerHTML = `<div class="hint" style="margin:0;">Drag to move, drag the corner handle to resize. Switch Front/Back above if you want it on the other side.</div>`;

    const btnRow = document.createElement("div");
    btnRow.className = "chip-row";
    const skipBtn = document.createElement("button");
    skipBtn.className = "chip-btn";
    skipBtn.textContent = "Cancel";
    skipBtn.addEventListener("click", () => { cleanup(); wrap.remove(); addMessage("Cancel", "user"); onCancel(); });
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "btn-primary";
    confirmBtn.textContent = `Confirm ${kind} position`;
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.textContent = "Placing…";
      const targetView = activeTab; // whichever tab is showing right now
      try {
        const newDataUrl = await flattenOverlayToImage(
          state.images[targetView], type, content, left, top, width, height, containerWidth, containerHeight
        );
        state.images[targetView] = newDataUrl;
        cleanup();
        showTab(targetView);
        wrap.remove();
        addMessage(`Positioned ${kind} (${targetView === "modelBack" ? "back" : "front"})`, "user");
        pushHistory(`Added ${kind}`);
        onConfirm();
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = `Confirm ${kind} position`;
        addMessage(`Couldn't place the ${kind} (${err.message || err}). Try dragging again.`, "bot");
      }
    });
    btnRow.appendChild(skipBtn);
    btnRow.appendChild(confirmBtn);
    wrap.appendChild(btnRow);
  });
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
    const frontPrompt = `Modify this exact garment based on this request: "${tweakText}". ${COLOR_LOCK_RULE} Original design brief for reference: "${state.designRaw}". ${FRAMING_RULE}`;
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

// Places the SAME content (logo file / name text / number text) once, then
// asks if it should go anywhere else too (e.g. the other side) before
// moving on -- so the same logo/name/number can end up on both front and
// back without re-uploading or re-typing it.
function placementLoop(kind, type, content, onDone) {
  function placeOnce() {
    addMessage(`Position the ${kind}: drag it into place, switch Front/Back if needed, resize with the corner handle, then confirm.`, "bot");
    mountDraggablePlacement({
      kind,
      type,
      content,
      onConfirm: () => {
        addMessage(`Add this ${kind} anywhere else too (e.g. the other side)?`, "bot");
        composerChips([
          { label: "Yes, add another", onClick: placeOnce },
          { label: "No, that's it", onClick: onDone },
        ]);
      },
      onCancel: onDone,
    });
  }
  placeOnce();
}

function askLogo() {
  addMessage("Want a logo added? Upload the file, or skip if you don't need one.", "bot");
  composerUploadOnly("Upload logo", () => { state.logo.wanted = false; askName(); }, (dataUrl) => {
    state.logo = { wanted: true, placement: "positioned by drag", dataUrl };
    placementLoop("logo", "image", dataUrl, askName);
  });
}

function askName() {
  addMessage("Want a team or player name added? Tell me what it should say — or skip.", "bot");
  composerTextOnly("e.g. EAGLES", () => { state.name.wanted = false; askNumber(); }, (text) => {
    state.name = { wanted: true, text, placement: "positioned by drag" };
    placementLoop("name", "text", text, askNumber);
  });
}

function askNumber() {
  addMessage("Want a number added? Tell me the number — or skip.", "bot");
  composerTextOnly("e.g. 9", () => { state.number.wanted = false; askOtherGarments(); }, (text) => {
    state.number = { wanted: true, text, placement: "positioned by drag" };
    placementLoop("number", "text", text, askOtherGarments);
  });
}

function askOtherGarments() {
  addMessage("Did you want this design on any other garments?", "bot");
  composerChips([
    { label: "Yes", onClick: () => {
      composerText("e.g. shorts, socks, jacket", (val) => {
        const names = val.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        generateExtraGarments(names);
      });
    } },
    { label: "No", onClick: askContact },
  ]);
}

function addImageMessage(dataUrl, caption) {
  const div = document.createElement("div");
  div.className = "msg bot";
  div.innerHTML = `<img src="${dataUrl}" alt="${caption}" style="max-width:220px;border-radius:8px;display:block;margin-bottom:6px;" /><div>${caption}</div>`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// Extra garments reuse the CONFIRMED hero image as a reference (img2img),
// so the same colours/pattern/logo carry over consistently instead of
// each item being re-imagined independently.
async function generateExtraGarments(names) {
  for (const name of names) {
    addMessage(`Generating ${name}…`, "bot");
    setLoading(`Generating ${name}…`);
    try {
      const prompt = `Generate a professional product photograph of a ${name}, using the exact same colours, pattern, and design style as the reference garment shown -- same design family, different item. ${COLOR_LOCK_RULE} ${FRAMING_RULE} Show the ${name} by itself, full item visible, plain studio background.`;
      const img = await editImage([state.images.modelFront], prompt);
      state.extraGarments.push({ name, image: img });
      showTab("modelFront");
      addImageMessage(img, name[0].toUpperCase() + name.slice(1));
    } catch (err) {
      showTab("modelFront");
      addMessage(`Couldn't generate the ${name} (${err.message}).`, "bot");
    }
  }
  addMessage("All done with extra garments.", "bot");
  askContact();
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

function onFinalAction(actionType) {
  const isQuote = actionType === "quote";
  document.getElementById("modal-title").textContent = isQuote
    ? "Thanks — your design request is in!"
    : "Your design is on its way!";
  document.getElementById("modal-note").innerHTML = isQuote
    ? `Nothing was actually sent (this is a prototype). In the live version, <strong>${RESELLER_CONFIG.name}</strong> and our team would be emailed right now with these images attached.`
    : `Nothing was actually sent (this is a prototype). In the live version, a copy of this design would be emailed to <strong>${state.contactEmail || "your email"}</strong> right now.`;
  quoteJson.textContent = JSON.stringify(buildSpec(actionType), null, 2);
  quoteImages.innerHTML = "";
  renderImageFigure(quoteImages, state.images.modelFront, "Model — Front");
  renderImageFigure(quoteImages, state.images.modelBack, "Model — Back");
  state.extraGarments.forEach((g) => renderImageFigure(quoteImages, g.image, g.name[0].toUpperCase() + g.name.slice(1)));
  quoteModal.classList.remove("hidden");
}

document.getElementById("close-modal-btn").addEventListener("click", () => quoteModal.classList.add("hidden"));

startConversation();
