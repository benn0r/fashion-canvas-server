import { useCallback, useEffect, useState } from "react";
import { AdminHeader, Footer } from "./AdminHeader";
import { DirectorySearch, PaginationControls } from "./DirectoryControls";
import { errorMessage, getJson } from "./api";
import type { Pagination, UserAccount } from "./types";

const pageSize = 10;
const emptyPagination: Pagination = { total: 0, page: 1, pageSize, totalPages: 0 };

export function UsersPage() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [pagination, setPagination] = useState(emptyPagination);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const parameters = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        search,
      });
      const response = await getJson<{ users: UserAccount[]; pagination: Pagination }>(
        `/api/admin/users?${parameters}`,
      );
      setUsers(response.users);
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

  async function changeApproval(user: UserAccount) {
    const action = user.approved ? "revoke approval for" : "approve";
    if (!window.confirm(`Are you sure you want to ${action} ${user.username}?`)) return;
    const endpoint = user.approved ? "revoke" : "approve";
    const response = await fetch(`/api/admin/users/${user.id}/${endpoint}`, { method: "POST" });
    if (!response.ok) setError("The approval change could not be saved.");
    else await refresh();
  }

  async function deleteUser(user: UserAccount) {
    if (
      !window.confirm(
        `Permanently delete ${user.username}? Their active sessions will be invalidated. This cannot be undone.`,
      )
    )
      return;
    const response = await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("The user could not be deleted.");
      return;
    }
    if (users.length === 1 && page > 1) setPage(page - 1);
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
          <DirectorySearch
            label="Search users"
            placeholder="Username"
            value={searchInput}
            activeSearch={search}
            onChange={setSearchInput}
            onSearch={applySearch}
          />
          <div className="history-scroll">
            <table>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Registered</th>
                  <th>Status</th>
                  <th>Actions</th>
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
                        <div className="directory-actions">
                          <button
                            className={user.approved ? "revoke-user" : "approve-user"}
                            type="button"
                            onClick={() => changeApproval(user)}
                          >
                            {user.approved ? "Revoke approval" : "Approve"}
                          </button>
                          <button
                            className="danger-action"
                            type="button"
                            onClick={() => deleteUser(user)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="empty">
                      {search ? "No users match this search." : "No users registered yet."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls pagination={pagination} onPage={setPage} />
        </section>
      </main>
      <Footer>User administration</Footer>
    </>
  );
}
