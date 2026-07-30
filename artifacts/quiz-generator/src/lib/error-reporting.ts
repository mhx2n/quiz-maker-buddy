import { reportClientError } from "./auth-api";

let installed = false;

/**
 * Captures anything that goes wrong in the browser and forwards it to the
 * backend, which relays it to the owner's private Telegram group.
 */
export function installErrorReporting() {
  if (installed) return;
  installed = true;

  window.addEventListener("error", (event) => {
    reportClientError({
      message: event.message || "Unknown window error",
      stack: event.error instanceof Error ? event.error.stack : null,
      kind: "window.error",
      extra: { file: event.filename, line: event.lineno, column: event.colno },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    reportClientError({
      message: reason instanceof Error ? reason.message : String(reason).slice(0, 500),
      stack: reason instanceof Error ? reason.stack : null,
      kind: "unhandledrejection",
    });
  });

  // Surface failing API calls too (5xx and network failures).
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
      const response = await originalFetch(input, init);
      if (response.status >= 500 && !url.includes("/api/client-errors")) {
        reportClientError({
          message: `API ${response.status} on ${url}`,
          kind: "api.error",
          extra: { status: response.status },
        });
      }
      return response;
    } catch (err) {
      if (!url.includes("/api/client-errors")) {
        reportClientError({
          message: `Network failure on ${url}: ${err instanceof Error ? err.message : String(err)}`,
          kind: "network.error",
        });
      }
      throw err;
    }
  };
}
