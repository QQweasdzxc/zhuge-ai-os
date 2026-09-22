/* Zhuge AI OS Foundation v1.0: the default product locale contract. */
(function (global) {
  const locale = "zh-TW";
  const timezone = "Asia/Taipei";
  const weekLabels = Object.freeze(["日", "一", "二", "三", "四", "五", "六"]);
  const dateOptions = Object.freeze({ timeZone: timezone, calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" });
  const currency = "TWD";

  function formatDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(`${locale}-u-ca-gregory`, dateOptions).format(date).replace(/\//g, "/");
  }

  function formatWeekday(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `星期${weekLabels[date.getDay()]}`;
  }

  global.ZhugeI18n = Object.freeze({ locale, timezone, currency, weekLabels, dateOptions, formatDate, formatWeekday });
})(window);
