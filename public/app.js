const form = document.querySelector("#upload-form"),
  input = document.querySelector("#photo"),
  drop = document.querySelector("#dropzone"),
  preview = document.querySelector("#preview"),
  message = document.querySelector("#message"),
  submit = document.querySelector("#submit"),
  results = document.querySelector("#results"),
  cropEditor = document.querySelector("#crop-editor"),
  cropCanvas = document.querySelector("#crop-preview"),
  cropMeta = document.querySelector("#crop-meta"),
  cropInputs = [...document.querySelectorAll("[data-crop]")];
let cropImage = null,
  cropUrl = null;
function cropRect() {
  const values = Object.fromEntries(
    cropInputs.map((control) => [control.dataset.crop, Number(control.value) / 100]),
  );
  return {
    x: Math.round(cropImage.naturalWidth * values.left),
    y: Math.round(cropImage.naturalHeight * values.top),
    width: Math.round(cropImage.naturalWidth * (1 - values.left - values.right)),
    height: Math.round(cropImage.naturalHeight * (1 - values.top - values.bottom)),
  };
}
function drawCrop() {
  if (!cropImage) return;
  const rect = cropRect(),
    scale = Math.min(1, 900 / Math.max(rect.width, rect.height));
  cropCanvas.width = Math.max(1, Math.round(rect.width * scale));
  cropCanvas.height = Math.max(1, Math.round(rect.height * scale));
  cropCanvas
    .getContext("2d")
    .drawImage(
      cropImage,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );
  const uploadScale = Math.min(1, 1280 / Math.max(rect.width, rect.height));
  cropMeta.textContent = `Source crop ${rect.width}×${rect.height} → upload ${Math.round(rect.width * uploadScale)}×${Math.round(rect.height * uploadScale)} JPEG`;
}
async function loadCrop(file) {
  cropInputs.forEach((control) => {
    control.value = "0";
    control.nextElementSibling.value = "0%";
  });
  if (cropUrl) URL.revokeObjectURL(cropUrl);
  cropUrl = URL.createObjectURL(file);
  preview.src = cropUrl;
  drop.classList.add("has-image");
  const image = new Image();
  image.onload = () => {
    cropImage = image;
    cropEditor.hidden = false;
    drawCrop();
  };
  image.onerror = () => {
    cropImage = null;
    cropEditor.hidden = true;
    message.textContent =
      "This format cannot be cropped in this browser; the original file will be uploaded.";
  };
  image.src = cropUrl;
}
input.addEventListener("change", () => {
  const file = input.files[0];
  if (file) loadCrop(file);
});
cropInputs.forEach((control) =>
  control.addEventListener("input", () => {
    control.nextElementSibling.value = `${control.value}%`;
    drawCrop();
  }),
);
["dragenter", "dragover"].forEach((e) =>
  drop.addEventListener(e, (x) => {
    x.preventDefault();
    drop.classList.add("drag");
  }),
);
["dragleave", "drop"].forEach((e) => drop.addEventListener(e, () => drop.classList.remove("drag")));
async function croppedFile() {
  if (!cropImage) return null;
  const rect = cropRect(),
    scale = Math.min(1, 1280 / Math.max(rect.width, rect.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  canvas
    .getContext("2d")
    .drawImage(
      cropImage,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ? { blob, width: canvas.width, height: canvas.height } : null;
}
async function refresh() {
  const [data, history] = await Promise.all([
    fetch("/api/debug/rate-limits").then((r) => r.json()),
    fetch("/api/admin/uploads").then((r) => r.json()),
  ]);
  document.querySelector("#clients").innerHTML = data.clients.length
    ? data.clients
        .map(
          (c) =>
            `<div class="client"><div class="client-row"><span>${escapeHtml(c.ip)}</span><b>${c.count}/${data.limit}</b></div><div class="meter"><i style="width:${(c.count / data.limit) * 100}%"></i></div><small>${c.remaining} remaining · ${c.totalUploads} total</small></div>`,
        )
        .join("")
    : '<p class="empty">No active upload limits.</p>';
  document.querySelector("#upload-history").innerHTML = history.uploads.length
    ? history.uploads
        .map(
          (upload) =>
            `<tr><td>${escapeHtml(new Date(upload.timestamp).toLocaleString())}</td><td><code>${escapeHtml(upload.ip)}</code></td><td>${escapeHtml(upload.appVersion)}</td><td><span class="history-status ${upload.status}">${escapeHtml(upload.status)}</span></td><td>${upload.tokens.total === null ? "—" : upload.tokens.total.toLocaleString()}</td><td>${upload.price.usd === null ? "—" : `$${upload.price.usd.toFixed(4)} <small>${upload.price.kind}</small>`}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="6" class="empty">No uploads recorded yet.</td></tr>';
  const completed = history.uploads.filter((upload) => upload.status === "completed").length,
    tokens = history.uploads.reduce((sum, upload) => sum + (upload.tokens.total ?? 0), 0),
    cost = history.uploads.reduce((sum, upload) => sum + (upload.price.usd ?? 0), 0);
  document.querySelector("#metric-uploads").textContent = history.uploads.length.toLocaleString();
  document.querySelector("#metric-success").textContent = history.uploads.length
    ? `${Math.round((completed / history.uploads.length) * 100)}%`
    : "—";
  document.querySelector("#metric-tokens").textContent = tokens.toLocaleString();
  document.querySelector("#metric-cost").textContent = `$${cost.toFixed(4)}`;
}
function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}
function formatBytes(bytes) {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(2)} MB` : `${Math.round(bytes / 1024)} KB`;
}
function render(data) {
  document.querySelector("#styled-outfit").src = data.styledOutfit;
  document.querySelector("#piece-count").textContent = `${data.pieces.length} PIECES EXTRACTED`;
  document.querySelector("#pieces").innerHTML = data.pieces
    .map(
      (p) =>
        `<article class="piece"><img src="${p.image}" alt="${escapeHtml(p.label)}"><div><span class="tag">${escapeHtml(p.category)}</span><h3>${escapeHtml(p.label)}</h3><p>${escapeHtml(p.description)}</p></div></article>`,
    )
    .join("");
  const d = data.debug;
  if (d) {
    const values = [
      ["Estimated cost", `$${d.cost.estimatedTotal.toFixed(4)} ${d.cost.currency}`],
      ["Models", `${d.models.vision} + ${d.models.image}`],
      [
        "Output",
        `1 × ${d.output.fullOutfitSize} + ${d.output.count - 1} × ${d.output.pieceSize} · ${d.output.quality} ${d.output.format}`,
      ],
      ["Total time", `${(d.timingMs.total / 1000).toFixed(1)} s`],
      ["Analysis usage", `${d.usage.analysis.totalTokens.toLocaleString()} tokens`],
      [
        "Generation usage",
        d.usage.generation.available
          ? `${d.usage.generation.totalTokens.toLocaleString()} tokens`
          : "Not returned by API",
      ],
      [
        "Input",
        `${d.input.originalWidth}×${d.input.originalHeight} · ${formatBytes(d.input.originalBytes)}`,
      ],
      [
        "Normalized",
        `${d.input.normalizedWidth}×${d.input.normalizedHeight} · ${formatBytes(d.input.normalizedBytes)}`,
      ],
      [
        "Timing",
        `resize ${d.timingMs.resize} ms · analysis ${(d.timingMs.analysis / 1000).toFixed(1)} s · images ${(d.timingMs.generation / 1000).toFixed(1)} s`,
      ],
      ["Request ID", d.requestId],
    ];
    document.querySelector("#diagnostic-grid").innerHTML = values
      .map(
        ([label, value]) =>
          `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
      )
      .join("");
    document.querySelector("#cost-note").textContent = d.cost.note;
  }
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth" });
}
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  message.textContent = "";
  submit.disabled = true;
  submit.firstChild.textContent = "Creating your canvas… ";
  try {
    const body = new FormData(form),
      cropped = await croppedFile();
    if (cropped) {
      body.set("photo", cropped.blob, "cropped-reference.jpg");
      message.textContent = `Uploading cropped ${cropped.width}×${cropped.height} reference…`;
    }
    const response = await fetch("/api/outfits", { method: "POST", body });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");
    render(data);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = false;
    submit.firstChild.textContent = "Create outfit canvas ";
    refresh();
  }
});
document.querySelector("#refresh").addEventListener("click", refresh);
document.querySelector("#refresh-all").addEventListener("click", refresh);
refresh();
