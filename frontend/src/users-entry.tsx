import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UsersPage } from "./UsersPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UsersPage />
  </StrictMode>,
);
