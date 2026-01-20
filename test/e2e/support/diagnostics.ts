import type { Page } from "@playwright/test";

type DiagnosticsOptions = {
  shouldTrackRequest: (url: string) => boolean;
};

export type BrowserDiagnostics = {
  consoleMessages: string[];
  requestFailures: string[];
  requestLog: string[];
  dump: () => void;
};

export const attachBrowserDiagnostics = (
  page: Page,
  { shouldTrackRequest }: DiagnosticsOptions,
): BrowserDiagnostics => {
  const consoleMessages: string[] = [];
  const requestFailures: string[] = [];
  const requestLog: string[] = [];

  page.on("console", (message) => {
    consoleMessages.push(`[${message.type()}] ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    consoleMessages.push(`[pageerror] ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (shouldTrackRequest(url)) {
      requestFailures.push(`${url} ${request.failure()?.errorText ?? ""}`);
    }
  });
  page.on("request", (request) => {
    const url = request.url();
    if (shouldTrackRequest(url)) {
      requestLog.push(`${new Date().toISOString()} ${request.method()} ${url}`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (shouldTrackRequest(url)) {
      requestLog.push(
        `${new Date().toISOString()} ${response.status()} ${url}`,
      );
    }
  });

  const dump = () => {
    if (consoleMessages.length) {
      console.log("Browser console logs:", consoleMessages);
    }
    if (requestFailures.length) {
      console.log("Browser request failures:", requestFailures);
    }
    if (requestLog.length) {
      const tail = requestLog.slice(-200);
      console.log("Browser request log (last 200):", tail);
    }
  };

  return {
    consoleMessages,
    requestFailures,
    requestLog,
    dump,
  };
};
