import { describe, expect, it } from "vitest";
import { sanitizeScript } from "@jarvis/browser-worker";
import { BrowserWorkerError } from "@jarvis/browser-worker";

describe("sanitizeScript", () => {
  // ── Blocked patterns ────────────────────────────────────────────────────────

  const blocked = [
    { label: "fetch()", script: 'const r = fetch("/api")' },
    { label: "fetch with whitespace", script: "fetch  (\"/x\")" },
    { label: "XMLHttpRequest", script: "new XMLHttpRequest()" },
    { label: "WebSocket", script: 'new WebSocket("ws://evil")' },
    { label: "navigator.sendBeacon", script: 'navigator.sendBeacon("/log", data)' },
    { label: "navigator . sendBeacon", script: "navigator . sendBeacon('/x', d)" },
    { label: "new Worker", script: 'new Worker("worker.js")' },
    { label: "dynamic import", script: 'import("./module.js")' },
    { label: "document.cookie", script: "const c = document.cookie" },
    { label: "document . cookie", script: "document . cookie" },
    { label: "localStorage", script: "localStorage.getItem('k')" },
    { label: "sessionStorage", script: "sessionStorage.setItem('k','v')" },
    { label: "indexedDB", script: "indexedDB.open('db')" },
    { label: "caches.open", script: "caches.open('v1')" },
    { label: "caches.match", script: "caches.match(request)" },
    { label: "caches.keys", script: "caches.keys()" },
  ];

  for (const { label, script } of blocked) {
    it(`blocks ${label}`, () => {
      expect(() => sanitizeScript(script)).toThrow(BrowserWorkerError);
      try {
        sanitizeScript(script);
      } catch (e) {
        expect((e as BrowserWorkerError).code).toBe("SCRIPT_BLOCKED");
      }
    });
  }

  // ── Allowed scripts ─────────────────────────────────────────────────────────

  const allowed = [
    { label: "DOM query", script: "document.querySelector('.foo').textContent" },
    { label: "DOM manipulation", script: "document.body.style.background = 'red'" },
    { label: "Math", script: "Math.round(42.7)" },
    { label: "JSON parse", script: 'JSON.parse(\'{"a":1}\')' },
    { label: "Array manipulation", script: "[1,2,3].map(x => x * 2)" },
    { label: "String ops", script: "'hello'.toUpperCase()" },
    { label: "setTimeout", script: "setTimeout(() => {}, 100)" },
    { label: "Promise", script: "new Promise(r => r(42))" },
    { label: "querySelector", script: "document.querySelectorAll('div').length" },
    { label: "innerText", script: "document.body.innerText" },
  ];

  for (const { label, script } of allowed) {
    it(`allows ${label}`, () => {
      expect(() => sanitizeScript(script)).not.toThrow();
    });
  }
});
