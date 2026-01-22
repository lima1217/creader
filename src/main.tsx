import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Set default theme
document.documentElement.setAttribute('data-theme', 'light');

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
