import { useCallback, useEffect, useState } from "react";
import { AdminHeader, Footer } from "./AdminHeader";
import { errorMessage, getJson } from "./api";
import type { ApprovalVoucher, UserAccount } from "./types";

export function UsersPage() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [vouchers, setVouchers] = useState<ApprovalVoucher[]>([]);
  const [generatedCode, setGeneratedCode] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const [userResponse, voucherResponse] = await Promise.all([
        getJson<{ users: UserAccount[] }>("/api/admin/users"),
        getJson<{ vouchers: ApprovalVoucher[] }>("/api/admin/vouchers"),
      ]);
      setUsers(userResponse.users);
      setVouchers(voucherResponse.vouchers);
      setError("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  async function changeApproval(user: UserAccount) {
    const action = user.approved ? "revoke approval for" : "approve";
    if (!window.confirm(`Are you sure you want to ${action} ${user.username}?`)) return;
    const endpoint = user.approved ? "revoke" : "approve";
    const response = await fetch(`/api/admin/users/${user.id}/${endpoint}`, { method: "POST" });
    if (!response.ok) setError("The approval change could not be saved.");
    else await refresh();
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
      await refresh();
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

  return (
    <>
      <AdminHeader active="users" />
      <main>
        <section className="admin-intro">
          <div>
            <p className="eyebrow">ACCESS / USERS</p>
            <h1>User accounts</h1>
            <p>Review registrations and approve accounts before they can upload files.</p>
          </div>
          <button className="secondary-action" id="refresh-users" type="button" onClick={refresh}>
            ↻ Refresh users
          </button>
        </section>
        {error && <p role="alert">{error}</p>}
        <section className="admin-history" aria-labelledby="users-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">ACCOUNT DIRECTORY</p>
              <h2 id="users-title">Registered users</h2>
              <p>Passwords and session tokens are never displayed or stored in plaintext.</p>
            </div>
            <span className="database-badge">SQLite · persistent</span>
          </div>
          <div className="history-scroll">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Registered</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="user-list">
                {users.length ? (
                  users.map((user) => (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.username}</strong>
                      </td>
                      <td>{new Date(user.createdAt).toLocaleString()}</td>
                      <td>
                        <span
                          className={`history-status ${user.approved ? "completed" : "processing"}`}
                        >
                          {user.approved ? "Approved" : "Pending"}
                        </span>
                      </td>
                      <td>
                        <button
                          className={user.approved ? "revoke-user" : "approve-user"}
                          type="button"
                          onClick={() => changeApproval(user)}
                        >
                          {user.approved ? "Revoke approval" : "Approve"}
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty">
                      No users registered yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="admin-history voucher-panel" aria-labelledby="vouchers-title">
          <div className="panel-head">
            <div>
              <p className="eyebrow">SELF-SERVICE APPROVAL</p>
              <h2 id="vouchers-title">Approval vouchers</h2>
              <p>
                Generate single-use codes that registered users can redeem to approve themselves.
              </p>
            </div>
            <button
              className="generate-voucher"
              type="button"
              disabled={generating}
              onClick={generateVoucher}
            >
              {generating ? "Generating…" : "+ Generate voucher"}
            </button>
          </div>
          {generatedCode && (
            <div className="generated-voucher" aria-live="polite">
              <div>
                <span>New voucher · shown once</span>
                <code id="generated-voucher">{generatedCode}</code>
              </div>
              <button type="button" onClick={copyVoucher}>
                {copied ? "Copied" : "Copy code"}
              </button>
            </div>
          )}
          <div className="history-scroll">
            <table>
              <thead>
                <tr>
                  <th>Voucher</th>
                  <th>Generated</th>
                  <th>Status</th>
                  <th>Redeemed by</th>
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
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty">
                      No approval vouchers generated yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <Footer>User administration</Footer>
    </>
  );
}
