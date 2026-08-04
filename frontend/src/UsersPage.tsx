import { useCallback, useEffect, useState } from "react";
import { AdminHeader, Footer } from "./AdminHeader";
import { errorMessage, getJson } from "./api";
import type { UserAccount } from "./types";

export function UsersPage() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setUsers((await getJson<{ users: UserAccount[] }>("/api/admin/users")).users);
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
      </main>
      <Footer>User administration</Footer>
    </>
  );
}
