const SUPPORTED_FORMS = new Set(["8-K", "10-K", "10-Q", "6-K", "20-F", "40-F"]);
const MAX_FILINGS = 8;

function safeText(value, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

/** Map SEC submissions into official filing evidence; no author-owned news source is used. */
export function mapSecCompanyFilings({ symbol, cik, payload, now = Date.now(), limit = MAX_FILINGS } = {}) {
  const ticker = safeText(symbol, 16).toUpperCase();
  const cikText = String(cik ?? "").trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker) || !/^\d{10}$/.test(cikText)) return [];
  const recent = payload?.filings?.recent;
  if (!recent || typeof recent !== "object") return [];
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const filed = Array.isArray(recent.filingDate) ? recent.filingDate : [];
  const reportDates = Array.isArray(recent.reportDate) ? recent.reportDate : [];
  const accessions = Array.isArray(recent.accessionNumber) ? recent.accessionNumber : [];
  const documents = Array.isArray(recent.primaryDocument) ? recent.primaryDocument : [];
  const descriptions = Array.isArray(recent.primaryDocDescription) ? recent.primaryDocDescription : [];
  const maxRows = Math.min(forms.length, filed.length, accessions.length, documents.length);
  const output = [];
  for (let index = 0; index < maxRows && output.length < Math.max(1, Math.min(Number(limit) || MAX_FILINGS, MAX_FILINGS)); index += 1) {
    const form = safeText(forms[index], 12).toUpperCase();
    const filedDate = safeText(filed[index], 10);
    const accession = safeText(accessions[index], 24);
    const document = safeText(documents[index], 240);
    const reportDate = safeText(reportDates[index], 10);
    if (!SUPPORTED_FORMS.has(form) || !/^\d{4}-\d{2}-\d{2}$/.test(filedDate)
      || !/^\d{10}-\d{2}-\d{6}$/.test(accession)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(document)
      || document === "." || document === "..") continue;
    const accessionPath = accession.replace(/-/g, "");
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cikText)}/${accessionPath}/${encodeURIComponent(document)}`;
    const description = safeText(descriptions[index], 160);
    const ageMs = Number(now) - Date.parse(`${filedDate}T00:00:00.000Z`);
    const stale = !Number.isFinite(ageMs) || ageMs > 30 * 24 * 60 * 60 * 1000;
    output.push(Object.freeze({
      type: "news",
      evidenceType: "official_company_filing",
      symbol: ticker,
      market: "US",
      title: `${ticker} · SEC ${form}${description ? ` · ${description}` : " filing"}`,
      summary: `SEC EDGAR 於 ${filedDate} 登錄 ${form} 文件${reportDate ? `（報導期間 ${reportDate}）` : ""}。這是公司申報文件，不代表新聞報導或投資結論。`,
      source: "SEC EDGAR Company Filings",
      sourceUrl,
      observedAt: filedDate,
      filedDate,
      reportDate: reportDate || null,
      form,
      accessionNumber: accession,
      quality: "official_open_data",
      freshness: stale ? "stale" : "fresh",
      stale,
      facts: Object.freeze([`form=${form}`, `filing_date=${filedDate}`, ...(reportDate ? [`report_date=${reportDate}`] : [])]),
      limitations: Object.freeze(["公司申報文件不是完整新聞服務；以 SEC EDGAR 原文為準。"]),
    }));
  }
  return Object.freeze(output);
}
