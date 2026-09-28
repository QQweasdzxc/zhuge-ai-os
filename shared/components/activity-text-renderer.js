/*
 * Shared activity text renderer.
 *
 * Domain consumers provide plain text. This module owns the shared
 * presentation rule for escaping it, preserving line breaks, and turning
 * only valid HTTP(S) URLs into safe external links.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeSharedActivityTextRenderer = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const TRAILING_PUNCTUATION = /[.,!?;:)\]}，。！？；：、）》」』…]+$/;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeHttpUrl(value) {
    const candidate = String(value || "");
    try {
      const parsed = new URL(candidate);
      if (!/^https?:$/i.test(parsed.protocol) || !parsed.hostname) return "";
      return candidate;
    } catch {
      return "";
    }
  }

  function renderLine(line) {
    const source = String(line == null ? "" : line);
    const urlPattern = /https?:\/\/[^\s<>"'`]+/gi;
    let output = "";
    let cursor = 0;
    let match;

    while ((match = urlPattern.exec(source))) {
      const original = match[0];
      let candidate = original;
      let trailing = "";
      const trailingMatch = candidate.match(TRAILING_PUNCTUATION);
      if (trailingMatch) {
        trailing = trailingMatch[0];
        candidate = candidate.slice(0, -trailing.length);
      }

      output += escapeHtml(source.slice(cursor, match.index));
      const safeUrl = safeHttpUrl(candidate);
      if (safeUrl) {
        output += `<a class="shared-task-progress-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate)}</a>`;
      } else {
        output += escapeHtml(candidate);
      }
      output += escapeHtml(trailing);
      cursor = match.index + original.length;
    }

    return output + escapeHtml(source.slice(cursor));
  }

  function render(value) {
    return String(value == null ? "" : value)
      .split(/\r?\n/)
      .map(renderLine)
      .join("<br>");
  }

  return Object.freeze({ escapeHtml, isSafeHttpUrl: safeHttpUrl, linkify: render, render });
});
