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
};

// ---------- Prompt building ----------
const FRAMING_RULE = "Full-length shot: the ENTIRE garment must be visible in frame, from the shoulders/collar all the way down to the hem - never crop off the bottom or any part of the garment.";

function fullDesignDescription() {
  let desc = state.designRaw;
  if (state.tweaks.length) desc += ". Adjustments: " + state.tweaks.join("; ");
  return desc;
}

function mentionsBack(placement) { return /back/i.test(placement || ""); }
function mentionsFront(placement) { return /front|chest/i.test(placement || ""); }

// Per-extra, per-view text — each returns '' unless that extra is wanted AND
// placed on that view, so logo/name/number only ever render where they belong.
function logoText(view) {
  if (!state.logo.wanted) return "";
  const onFront = mentionsFront(state.logo.placement) || !state.logo.placement;
  const onBack = mentionsBack(state.logo.placement);
  if ((view === "front" && onFront) || (view === "back" && onBack)) {
    return `Includes a logo positioned at ${state.logo.placement || "left chest"}.`;
  }
  return "";
}

function nameText(view) {
  if (!state.name.wanted) return "";
  const onBack = mentionsBack(state.name.placement) || !state.name.placement;
  const onFront = mentionsFront(state.name.placement);
  if ((view === "back" && onBack) || (view === "front" && onFront)) {
    return `Team/player name "${state.name.text}" positioned at ${state.name.placement || "upper back"}.`;
  }
  return "";
}

function numberText(view) {
  if (!state.number.wanted) return "";
  const onBack = mentionsBack(state.number.placement) || !state.number.placement;
  const onFront = mentionsFront(state.number.placement);
  if ((view === "back" && onBack) || (view === "front" && onFront)) {
    return `Number "${state.number.text}" positioned at ${state.number.placement || "centre back"}.`;
  }
  return "";
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

// ---------- Chat engine ----------
const chatLog = document.getElementById("chat-log");
const composer = document.getElementById("composer");

function addMessage(text, from) {
  const div = document.createElement("div");
  div.className = `msg ${from}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function clearComposer() { composer.innerHTML = ""; }

function composerText(placeholder, onSubmit) {
  clearComposer();
  const row = document.createElement("div");
  row.className = "composer-row";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.textContent = "Send";
  const submit = () => {
    const val = input.value.trim();
    if (!val) return;
    addMessage(val, "user");
    clearComposer();
    onSubmit(val);
  };
  btn.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  row.appendChild(input);
  row.appendChild(btn);
  composer.appendChild(row);
  input.focus();
}

function composerChips(options) {
  clearComposer();
  const row = document.createElement("div");
  row.className = "chip-row";
  options.forEach((opt) => {
    const btn = document.createElement("button");
    btn.className = "chip-btn";
    btn.textContent = opt.label;
    btn.addEventListener("click", () => { clearComposer(); opt.onClick(); });
    row.appendChild(btn);
  });
  composer.appendChild(row);
}

function composerUploadAndPlace(label, onSkip, onAdd) {
  clearComposer();
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="field"><label>Upload file</label><input type="file" id="c-file" accept="image/*" /></div>
    <div class="field"><label>Where should it go?</label><input type="text" id="c-place" placeholder="e.g. left chest, sleeve, back" /></div>
  `;
  composer.appendChild(wrap);
  const btnRow = document.createElement("div");
  btnRow.className = "chip-row";
  btnRow.style.marginTop = "8px";
  const skipBtn = document.createElement("button");
  skipBtn.className = "chip-btn";
  skipBtn.textContent = "Skip — not needed";
  skipBtn.addEventListener("click", () => { addMessage("Skip", "user"); clearComposer(); onSkip(); });
  const addBtn = document.createElement("button");
  addBtn.className = "btn-primary";
  addBtn.textContent = label;
  addBtn.addEventListener("click", () => {
    const fileInput = wrap.querySelector("#c-file");
    const place = wrap.querySelector("#c-place").value.trim();
    const file = fileInput.files[0];
    if (!file) {
      addMessage(`Placement: ${place || "(not specified)"}`, "user");
      clearComposer();
      onAdd({ placement: place, dataUrl: null });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      addMessage(`Uploaded file — placement: ${place || "(not specified)"}`, "user");
      clearComposer();
      onAdd({ placement: place, dataUrl: reader.result });
    };
    reader.readAsDataURL(file);
  });
  btnRow.appendChild(skipBtn);
  btnRow.appendChild(addBtn);
  composer.appendChild(btnRow);
}

function composerTextAndPlace(label, onSkip, onAdd) {
  clearComposer();
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="field"><label>Text</label><input type="text" id="c-text" placeholder="e.g. EAGLES or 9" /></div>
    <div class="field"><label>Where should it go?</label><input type="text" id="c-place" placeholder="e.g. back, front, sleeve" /></div>
  `;
  composer.appendChild(wrap);
  const btnRow = document.createElement("div");
  btnRow.className = "chip-row";
  btnRow.style.marginTop = "8px";
  const skipBtn = document.createElement("button");
  skipBtn.className = "chip-btn";
  skipBtn.textContent = "Skip — not needed";
  skipBtn.addEventListener("click", () => { addMessage("Skip", "user"); clearComposer(); onSkip(); });
  const addBtn = document.createElement("button");
  addBtn.className = "btn-primary";
  addBtn.textContent = label;
  addBtn.addEventListener("click", () => {
    const text = wrap.querySelector("#c-text").value.trim();
    const place = wrap.querySelector("#c-place").value.trim();
    if (!text) return;
    addMessage(`${text} — placement: ${place || "(not specified)"}`, "user");
    clearComposer();
    onAdd({ text, placement: place });
  });
  btnRow.appendChild(skipBtn);
  btnRow.appendChild(addBtn);
  composer.appendChild(btnRow);
}

function composerContactForm(onDone) {
  clearComposer();
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="field"><label>Your name</label><input type="text" id="c-name" placeholder="e.g. Francine Miller" /></div>
    <div class="field"><label>Your email</label><input type="email" id="c-email" placeholder="you@example.com" /></div>
  `;
  composer.appendChild(wrap);
  const btnRow = document.createElement("div");
  btnRow.className = "chip-row";
  btnRow.style.marginTop = "8px";
  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.textContent = "Continue";
  btn.addEventListener("click", () => {
    state.contactName = wrap.querySelector("#c-name").value.trim();
    state.contactEmail = wrap.querySelector("#c-email").value.trim();
    clearComposer();
    onDone();
  });
  btnRow.appendChild(btn);
  composer.appendChild(btnRow);
}

function composerReview() {
  clearComposer();
  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.textContent = "Request a Quote";
  btn.addEventListener("click", onRequestQuote);
  composer.appendChild(btn);
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

    addMessage("Here's a concept — front and back. Want any changes, or does this look good?", "bot");
    offerTweakOrContinue();
  } catch (err) {
    addMessage(`Image generation failed: ${err.message}. Let's try describing it again.`, "bot");
    composerText("Describe the design again", (val) => { state.designRaw = val; generateModelShots(); });
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
        generateModelShots();
      });
    } },
  ]);
}

function askLogo() {
  addMessage("Want a logo added? Upload it and tell me where it should go — or skip if you don't need one.", "bot");
  composerUploadAndPlace("Add logo", () => { state.logo.wanted = false; askName(); }, (result) => {
    state.logo = { wanted: true, placement: result.placement, dataUrl: result.dataUrl };
    applyExtraNow(logoText("front"), logoText("back"), true, askName, "logo");
  });
}

function askName() {
  addMessage("Want a team or player name added? Tell me what it should say and where it should go — or skip.", "bot");
  composerTextAndPlace("Add name", () => { state.name.wanted = false; askNumber(); }, (result) => {
    state.name = { wanted: true, text: result.text, placement: result.placement };
    applyExtraNow(nameText("front"), nameText("back"), false, askNumber, "name");
  });
}

function askNumber() {
  addMessage("Want a number added? Tell me the number and where it should go — or skip.", "bot");
  composerTextAndPlace("Add number", () => { state.number.wanted = false; askContact(); }, (result) => {
    state.number = { wanted: true, text: result.text, placement: result.placement };
    applyExtraNow(numberText("front"), numberText("back"), false, askContact, "number");
  });
}

// Renders ONE extra (logo, name, or number) onto the model shots immediately
// after that question is answered, then moves to the next step. Splitting
// the render into 3 smaller steps (instead of one batch at the end) spreads
// the wait across the conversation so it feels shorter.
async function applyExtraNow(frontText, backText, includeLogoImage, nextStepFn, label) {
  if (!frontText && !backText) { nextStepFn(); return; }
  addMessage(`Adding your ${label}…`, "bot");
  setLoading(`Adding your ${label}…`);
  try {
    if (frontText) {
      const imgs = [state.images.modelFront];
      if (includeLogoImage && state.logo.dataUrl) imgs.push(state.logo.dataUrl);
      const logoNote = includeLogoImage && state.logo.dataUrl
        ? " A logo reference image is included as an additional image — composite that exact logo onto the garment at the described position, sized like a real chest logo."
        : "";
      state.images.modelFront = await editImage(imgs, `Apply the following to this garment, changing nothing else about the model, pose, lighting, background, garment colours or pattern: ${frontText}${logoNote} ${FRAMING_RULE}`);
      showTab("modelFront");
    }
    if (backText) {
      const imgs = [state.images.modelBack];
      if (includeLogoImage && state.logo.dataUrl) imgs.push(state.logo.dataUrl);
      const logoNote = includeLogoImage && state.logo.dataUrl
        ? " A logo reference image is included as an additional image — composite that exact logo onto the garment at the described position."
        : "";
      state.images.modelBack = await editImage(imgs, `Apply the following to this garment, changing nothing else about the model, pose, lighting, background, garment colours or pattern: ${backText}${logoNote} ${FRAMING_RULE}`);
      showTab(frontText ? activeTab : "modelBack");
    }
    addMessage(`${label[0].toUpperCase()}${label.slice(1)} added.`, "bot");
  } catch (err) {
    showTab("modelFront");
    addMessage(`Couldn't add the ${label} (${err.message}) — your details are still captured, continuing.`, "bot");
  }
  nextStepFn();
}

function askContact() {
  addMessage("Almost done — just need your details so we can get back to you.", "bot");
  composerContactForm(() => {
    addMessage("Perfect — request your quote whenever you're ready.", "bot");
    composerReview();
  });
}

// ---------- Quote capture ----------
function buildSpec() {
  return {
    submitted_at: "PROTOTYPE — timestamp would be set server-side",
    reseller: RESELLER_CONFIG.name,
    notify_emails: [RESELLER_CONFIG.notifyEmail, "brad@theprocurementroom.co.nz"],
    contact_name: state.contactName || null,
    contact_email: state.contactEmail || null,
    design_description_raw: state.designRaw,
    tweaks_requested: state.tweaks,
    logo: state.logo.wanted ? { placement: state.logo.placement, uploaded: Boolean(state.logo.dataUrl) } : null,
    team_name: state.name.wanted ? { text: state.name.text, placement: state.name.placement } : null,
    back_number: state.number.wanted ? { text: state.number.text, placement: state.number.placement } : null,
    images_attached: ["model_front", "model_back"],
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

function onRequestQuote() {
  clearComposer();
  document.getElementById("modal-reseller-name").textContent = RESELLER_CONFIG.name;
  quoteJson.textContent = JSON.stringify(buildSpec(), null, 2);
  quoteImages.innerHTML = "";
  renderImageFigure(quoteImages, state.images.modelFront, "Model — Front");
  renderImageFigure(quoteImages, state.images.modelBack, "Model — Back");
  quoteModal.classList.remove("hidden");
}

document.getElementById("close-modal-btn").addEventListener("click", () => quoteModal.classList.add("hidden"));

startConversation();
