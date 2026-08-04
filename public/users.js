async function refreshUsers() {
  const response = await fetch("/api/admin/users");
  const data = await response.json();
  document.querySelector("#user-list").innerHTML = data.users.length
    ? data.users
        .map(
          (user) =>
            `<tr><td><strong>${escapeHtml(user.username)}</strong></td><td>${escapeHtml(new Date(user.createdAt).toLocaleString())}</td><td><span class="history-status ${user.approved ? "completed" : "processing"}">${user.approved ? "Approved" : "Pending"}</span></td><td>${user.approved ? "—" : `<button class="approve-user" data-user-id="${user.id}" type="button">Approve</button>`}</td></tr>`,
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
  const button = event.target.closest(".approve-user");
  if (!button) return;
  button.disabled = true;
  const response = await fetch(`/api/admin/users/${button.dataset.userId}/approve`, {
    method: "POST",
  });
  if (!response.ok) button.disabled = false;
  else await refreshUsers();
});
document.querySelector("#refresh-users").addEventListener("click", refreshUsers);
refreshUsers();
