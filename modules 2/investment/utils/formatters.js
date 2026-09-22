(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.InvestmentFormatters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const number = (value, digits = 2) => new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(Number(value || 0));
  const integer = value => new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(Number(value || 0));
  const signed = (value, digits = 2) => `${Number(value || 0) >= 0 ? "+" : ""}${number(value, digits)}`;
  const percent = value => `${Number(value || 0) >= 0 ? "+" : ""}${number(value, 2)}%`;
  const date = value => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(parsed);
  };
  const currency = (value, code = "TWD") => `${code === "TWD" ? "NT$" : "US$"} ${code === "TWD" ? integer(value) : number(value, 2)}`;

  return Object.freeze({ number, integer, signed, percent, date, currency });
});
