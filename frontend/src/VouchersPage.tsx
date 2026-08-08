import { useCallback, useEffect, useState } from "react";
import { AdminHeader, Footer } from "./AdminHeader";
import { DirectorySearch, PaginationControls } from "./DirectoryControls";
import { errorMessage, getJson } from "./api";
import type { ApprovalVoucher, Pagination } from "./types";

const pageSize = 10;
const emptyPagination: Pagination = { total: 0, page: 1, pageSize, totalPages: 0 };

export function VouchersPage() {
  const [vouchers, setVouchers] = useState<ApprovalVoucher[]>([]);
  const [pagination, setPagination] = useState(emptyPagination);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const parameters = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
      });
      const response = await getJson<{
        vouchers: ApprovalVoucher[];
        pagination: Pagination;
      }>(`/api/admin/vouchers?${parameters}`);
      setVouchers(response.vouchers);
      setPagination(response.pagination);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, [page, search]);

  useEffect(() => void refresh(), [refresh]);

  function applySearch(value: string) {
    const nextSearch = value.trim();
    setPage(1);
    setSearch(nextSearch);
    if (page === 1 && search === nextSearch) void refresh();
  }

  async function generateVoucher() {
    setGenerating(true);
    setCopied(false);
    try {
      const response = await fetch("/api/admin/vouchers", { method: "POST" });
      if (!response.ok) throw new Error("The voucher could not be generated.");
      const result = (await response.json()) as {
        voucher: ApprovalVoucher & { code: string };
      };
      setGeneratedCode(result.voucher.code);
      setPage(1);
      setSearch("");
      setSearchInput("");
      if (page === 1 && !search) await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setGenerating(false);
    }
  }

  async function copyVoucher() {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopied(true);
    } catch {
      setError("Copy failed. Select and copy the voucher manually.");
    }
  }

  async function deleteVoucher(voucher: ApprovalVoucher) {
    if (!window.confirm(`Permanently delete voucher ${voucher.prefix}…? This cannot be undone.`))
      return;
    const response = await fetch(`/api/admin/vouchers/${voucher.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("The voucher could not be deleted.");
      return;
    }
    if (vouchers.length === 1 && page > 1) setPage(page - 1);
    else await refresh();
  }

  return (
    <>
      <AdminHeader active="vouchers" />
      <main>
        <section className="admin-intro">
          <div>
            <p className="eyebrow">ACCESS / VOUCHERS</p>
            <h1>Approval vouchers</h1>
            <p>Generate and manage single-use codes for self-service account approval.</p>
          </div>
          <button
            className="generate-voucher"
            type="button"
            disabled={generating}
            onClick={generateVoucher}
          >
            {generating ? "Generating…" : "+ Generate voucher"}
          </button>
        </section>
        {error && <p role="alert">{error}</p>}
        {generatedCode && (
          <div className="generated-voucher standalone" aria-live="polite">
            <div>
              <span>New voucher · shown once</span>
              <code id="generated-voucher">{generatedCode}</code>
            </div>
            <button type="button" onClick={copyVoucher}>
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
        )}
        <section className="admin-history" aria-labelledby="vouchers-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">VOUCHER DIRECTORY</p>
              <h2 id="vouchers-title">Generated vouchers</h2>
              <p>Full voucher codes are shown only once and stored as hashes.</p>
            </div>
            <span className="database-badge">SQLite · persistent</span>
          </div>
          <DirectorySearch
            label="Search vouchers"
            placeholder="Voucher prefix or redeemed username"
            value={searchInput}
            activeSearch={search}
            onChange={setSearchInput}
            onSearch={applySearch}
          />
          <div className="history-scroll">
            <table>
              <thead>
                <tr>
                  <th>Voucher</th>
                  <th>Generated</th>
                  <th>Status</th>
                  <th>Redeemed by</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="voucher-list">
                {vouchers.length ? (
                  vouchers.map((voucher) => (
                    <tr key={voucher.id}>
                      <td>
                        <code>{voucher.prefix}…</code>
                      </td>
                      <td>{new Date(voucher.createdAt).toLocaleString()}</td>
                      <td>
                        <span
                          className={`history-status ${voucher.usedAt ? "completed" : "processing"}`}
                        >
                          {voucher.usedAt ? "Used" : "Available"}
                        </span>
                      </td>
                      <td>{voucher.usedByUsername ?? "—"}</td>
                      <td>
                        <button
                          className="danger-action"
                          type="button"
                          onClick={() => deleteVoucher(voucher)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="empty">
                      {search
                        ? "No vouchers match this search."
                        : "No approval vouchers generated yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls pagination={pagination} onPage={setPage} />
        </section>
      </main>
      <Footer>Voucher administration</Footer>
    </>
  );
}
