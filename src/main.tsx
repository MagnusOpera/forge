import React from "react";
import ReactDOM from "react-dom/client";
import { ThreadWindow } from "./codex/thread-window";
import { App } from "./App";
import "./styles.css";
import { initializeDisplayPaths } from "./paths";

void initializeDisplayPaths().then(() => ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {window.location.hash === "#thread-window" ? <ThreadWindow /> : <App />}
  </React.StrictMode>
));
