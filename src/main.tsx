import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import { readThemePlaceholder } from "./services/themePlaceholder";

document.documentElement.setAttribute('data-theme', readThemePlaceholder() ?? 'light');

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
