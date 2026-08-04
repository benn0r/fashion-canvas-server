import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminHeader, Footer } from "./AdminHeader";
import { errorMessage, formatBytes, getJson } from "./api";
import type { RateLimitsResponse, UploadHistoryItem } from "./types";

export function AdminPage() {
  const [limits, setLimits] = useState<RateLimitsResponse>({ limit: 10, clients: [] });
  const [uploads, setUploads] = useState<UploadHistoryItem[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [nextLimits, history] = await Promise.all([
        getJson<RateLimitsResponse>("/api/debug/rate-limits"),
        getJson<{ uploads: UploadHistoryItem[] }>("/api/admin/uploads"),
      ]);
      setLimits(nextLimits);
      setUploads(history.uploads);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);
  const metrics = useMemo(() => {
    const completed = uploads.filter((upload) => upload.status === "completed").length;
    return {
      success: uploads.length ? `${Math.round((completed / uploads.length) * 100)}%` : "—",
      tokens: uploads.reduce((sum, upload) => sum + (upload.tokens.total ?? 0), 0),
      cost: uploads.reduce((sum, upload) => sum + (upload.price.usd ?? 0), 0),
    };
  }, [uploads]);

  return (
    <>
      <AdminHeader active="overview" />
      <main>
        <section id="overview" className="admin-intro">
          <div>
            <p className="eyebrow">OPERATIONS / OVERVIEW</p>
            <h1>Admin console</h1>
            <p>Monitor usage, costs, and client activity across Fashion Canvas.</p>
          </div>
          <button className="secondary-action" id="refresh-all" type="button" onClick={refresh}>
            ↻ Refresh data
          </button>
        </section>
        {error && <p role="alert">{error}</p>}
        <section className="metric-grid" aria-label="Upload summary">
          <Metric
            label="Recent uploads"
            value={uploads.length.toLocaleString()}
            note="Latest 100 records"
            id="metric-uploads"
          />
          <Metric
            label="Success rate"
            value={metrics.success}
            note="Latest 100 requests"
            id="metric-success"
          />
          <Metric
            label="Tracked tokens"
            value={metrics.tokens.toLocaleString()}
            note="Latest 100 uploads"
            id="metric-tokens"
          />
          <Metric
            label="Estimated spend"
            value={`$${metrics.cost.toFixed(4)}`}
            note="Latest 100 uploads"
            id="metric-cost"
          />
        </section>
        <aside className="rate-limit-panel" aria-labelledby="client-limits-title">
          <div className="aside-head">
            <div>
              <p className="eyebrow">TRAFFIC CONTROL</p>
              <h2 id="client-limits-title">Client limits</h2>
              <p className="aside-copy">10 uploads per IP in each rolling 5-minute window.</p>
            </div>
            <button id="refresh" type="button" aria-label="Refresh rate limits" onClick={refresh}>
              ↻
            </button>
          </div>
          <div id="clients" className="clients">
            {limits.clients.length ? (
              limits.clients.map((client) => (
                <div className="client" key={client.ip}>
                  <div className="client-row">
                    <span>
                      <strong>{client.username || "Unknown user"}</strong>
                      <code>{client.ip}</code>
                    </span>
                    <b>
                      {client.count}/{limits.limit}
                    </b>
                  </div>
                  <div className="meter">
                    <i style={{ width: `${(client.count / limits.limit) * 100}%` }} />
                  </div>
                  <small>
                    {client.remaining} remaining · {client.totalUploads} total
                  </small>
                </div>
              ))
            ) : (
              <p className="empty">No active upload limits.</p>
            )}
          </div>
        </aside>
        <section className="admin-history" aria-labelledby="upload-history-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">REQUEST LOG</p>
              <h2 id="upload-history-title">Upload history</h2>
              <p>Persistent metadata only. Uploaded and generated photos are never stored.</p>
            </div>
            <span className="database-badge">SQLite · persistent</span>
          </div>
          <div className="history-scroll">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Client IP</th>
                  <th>App version</th>
                  <th>File size</th>
                  <th>Status</th>
                  <th>Tokens</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody id="upload-history">
                {uploads.length ? (
                  uploads.map((upload) => (
                    <tr key={upload.requestId}>
                      <td>{new Date(upload.timestamp).toLocaleString()}</td>
                      <td>
                        <strong>{upload.username || "Unknown user"}</strong>
                      </td>
                      <td>
                        <code>{upload.ip}</code>
                      </td>
                      <td>{upload.appVersion}</td>
                      <td>
                        {upload.fileSizeBytes === null ? "—" : formatBytes(upload.fileSizeBytes)}
                      </td>
                      <td>
                        <span className={`history-status ${upload.status}`}>{upload.status}</span>
                      </td>
                      <td>
                        {upload.tokens.total === null ? "—" : upload.tokens.total.toLocaleString()}
                      </td>
                      <td>
                        {upload.price.usd === null ? (
                          "—"
                        ) : (
                          <>
                            {`$${upload.price.usd.toFixed(4)} `}
                            <small>{upload.price.kind}</small>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="empty">
                      No uploads recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Footer>Administration</Footer>
    </>
  );
}

function Metric({
  label,
  value,
  note,
  id,
}: {
  label: string;
  value: string;
  note: string;
  id: string;
}) {
  return (
    <article>
      <span>{label}</span>
      <strong id={id}>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
