type Page = "overview" | "users" | "studio";

export function AdminHeader({ active }: { active: Page }) {
  return (
    <header className="admin-header">
      <a className="brand" href="/">
        <img src="/app-icon.png" alt="" />
        <strong>Fashion Canvas</strong>
        <small>Admin</small>
      </a>
      <nav aria-label="Admin navigation">
        <a className={active === "overview" ? "active" : undefined} href="/">
          Overview
        </a>
        <a className={active === "users" ? "active" : undefined} href="/users.html">
          Users
        </a>
        <a className={active === "studio" ? "active" : undefined} href="/studio.html">
          Test studio
        </a>
        <a href="/api-docs/">API docs</a>
      </nav>
      <div className="status">
        <i /> System operational
      </div>
    </header>
  );
}

export function Footer({ children }: { children: React.ReactNode }) {
  return <footer>Fashion Canvas · {children}</footer>;
}
