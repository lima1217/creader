import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";

// Set default theme synchronously to avoid a flash before React mounts.
document.documentElement.setAttribute('data-theme', 'light');

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
