async function refreshAdmin() {
  const [limits, history] = await Promise.all([
    fetch("/api/debug/rate-limits").then((response) => response.json()),
    fetch("/api/admin/uploads").then((response) => response.json()),
  ]);
  document.querySelector("#clients").innerHTML = limits.clients.length
    ? limits.clients
        .map(
          (client) =>
            `<div class="client"><div class="client-row"><span>${escapeHtml(client.ip)}</span><b>${client.count}/${limits.limit}</b></div><div class="meter"><i style="width:${(client.count / limits.limit) * 100}%"></i></div><small>${client.remaining} remaining · ${client.totalUploads} total</small></div>`,
        )
        .join("")
    : '<p class="empty">No active upload limits.</p>';
  document.querySelector("#upload-history").innerHTML = history.uploads.length
    ? history.uploads
        .map(
          (upload) =>
            `<tr><td>${escapeHtml(new Date(upload.timestamp).toLocaleString())}</td><td><code>${escapeHtml(upload.ip)}</code></td><td>${escapeHtml(upload.appVersion)}</td><td>${upload.fileSizeBytes === null ? "—" : formatBytes(upload.fileSizeBytes)}</td><td><span class="history-status ${upload.status}">${escapeHtml(upload.status)}</span></td><td>${upload.tokens.total === null ? "—" : upload.tokens.total.toLocaleString()}</td><td>${upload.price.usd === null ? "—" : `$${upload.price.usd.toFixed(4)} <small>${upload.price.kind}</small>`}</td></tr>`,
        )
        .join("")
    : '<tr><td colspan="7" class="empty">No uploads recorded yet.</td></tr>';
  const completed = history.uploads.filter((upload) => upload.status === "completed").length;
  const tokens = history.uploads.reduce((sum, upload) => sum + (upload.tokens.total ?? 0), 0);
  const cost = history.uploads.reduce((sum, upload) => sum + (upload.price.usd ?? 0), 0);
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
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

document.querySelector("#refresh").addEventListener("click", refreshAdmin);
document.querySelector("#refresh-all").addEventListener("click", refreshAdmin);
refreshAdmin();
