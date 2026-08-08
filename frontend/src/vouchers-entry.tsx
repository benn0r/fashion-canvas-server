import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { VouchersPage } from "./VouchersPage";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <VouchersPage />
  </StrictMode>,
);
