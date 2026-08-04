async function refreshUsers() {
  const response = await fetch("/api/admin/users");
  const data = await response.json();
  document.querySelector("#user-list").innerHTML = data.users.length
    ? data.users
        .map(
          (user) =>
            `<tr><td><strong>${escapeHtml(user.username)}</strong></td><td>${escapeHtml(new Date(user.createdAt).toLocaleString())}</td><td><span class="history-status ${user.approved ? "completed" : "processing"}">${user.approved ? "Approved" : "Pending"}</span></td><td><button class="${user.approved ? "revoke-user secondary-action" : "approve-user"}" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}" type="button">${user.approved ? "Revoke approval" : "Approve"}</button></td></tr>`,
        )
        .join("")
    : '<tr><td colspan="4" class="empty">No users registered yet.</td></tr>';
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

document.querySelector("#user-list").addEventListener("click", async (event) => {
  const button = event.target.closest(".approve-user, .revoke-user");
  if (!button) return;
  const approving = button.classList.contains("approve-user");
  const action = approving ? "approve" : "revoke approval for";
  if (!window.confirm(`Are you sure you want to ${action} ${button.dataset.username}?`)) return;
  button.disabled = true;
  const response = await fetch(
    `/api/admin/users/${button.dataset.userId}/${approving ? "approve" : "revoke"}`,
    {
      method: "POST",
    },
  );
  if (!response.ok) button.disabled = false;
  else await refreshUsers();
});
document.querySelector("#refresh-users").addEventListener("click", refreshUsers);
refreshUsers();
