import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { App } from "./app.js";
import { createLogger } from "./utils/logging.js";

const log = createLogger("bootstrap");

function runBootstrap(): void {
  const startedAt = Date.now();
  log.trace({ event: "renderer_bootstrap", phase: "start" });

  const rootEl = document.getElementById("root");
  if (!rootEl) {
    throw new Error("Root element #root not found");
  }
  const root = createRoot(rootEl);
  root.render(createElement(App));

  log.trace({
    event: "renderer_bootstrap",
    phase: "success",
    metadata: { durationMs: Date.now() - startedAt },
  });
}

window.addEventListener("DOMContentLoaded", () => {
  try {
    runBootstrap();
  } catch (error) {
    log.trace({
      event: "renderer_bootstrap",
      phase: "fail",
      error,
    });
    throw error;
  }
});

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    try {
      runBootstrap();
    } catch (error) {
      log.trace({
        event: "renderer_bootstrap",
        phase: "fail",
        error,
        metadata: { hmr: true },
      });
    }
  });
}
