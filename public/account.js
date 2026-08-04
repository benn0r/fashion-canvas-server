const form = document.querySelector("#account-form");
const mode = document.querySelector("#account-mode");
const submit = document.querySelector("#account-submit");
const message = document.querySelector("#account-message");

document.querySelectorAll("[data-account-tab]").forEach((button) =>
  button.addEventListener("click", () => {
    mode.value = button.dataset.accountTab;
    document
      .querySelectorAll("[data-account-tab]")
      .forEach((tab) => tab.classList.toggle("active", tab === button));
    submit.textContent = mode.value === "login" ? "Log in" : "Create account";
    document.querySelector("#password").autocomplete =
      mode.value === "login" ? "current-password" : "new-password";
    message.textContent = "";
  }),
);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  submit.disabled = true;
  message.textContent = "";
  const response = await fetch(`/api/auth/${mode.value}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: document.querySelector("#username").value,
      password: document.querySelector("#password").value,
    }),
  });
  const data = await response.json();
  if (response.ok && mode.value === "login") {
    localStorage.setItem("fashionCanvasToken", data.token);
    localStorage.setItem("fashionCanvasUser", JSON.stringify(data.user));
    message.textContent = data.user.approved
      ? "Logged in. You can now upload files."
      : "Logged in. Your account is awaiting administrator approval.";
  } else if (response.ok) {
    message.textContent = data.message;
  } else message.textContent = data.error || "Request failed.";
  submit.disabled = false;
});
