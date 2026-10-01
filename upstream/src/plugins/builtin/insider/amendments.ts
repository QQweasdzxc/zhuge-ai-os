import { isInsiderAmendment } from "./insider-data";
import type { ParsedInsiderFiling } from "./model";

export interface InsiderAmendmentScope {
  accessionNumber: string;
  originalFilingDate: string | null;
  originalFilingDateUsable: boolean;
  ownerCiks: string[];
  ownerIdentityComplete: boolean;
  candidateOriginalAccessions: string[];
}

export function isAmendedInsiderFiling(entry: ParsedInsiderFiling): boolean {
  return isInsiderAmendment(entry.filing.form)
    || isInsiderAmendment(entry.disclosure?.form ?? entry.transaction?.form ?? "");
}

function ownerIdentity(entry: ParsedInsiderFiling): { ciks: string[]; complete: boolean } {
  const ciks = (entry.disclosure?.reportingOwners ?? entry.transaction?.reportingOwners ?? [])
    .map((owner) => /^\d+$/.test(owner.cik.trim()) ? owner.cik.trim().replace(/^0+/, "") : "");
  return { ciks: [...new Set(ciks.filter(Boolean))], complete: ciks.length > 0 && ciks.every(Boolean) };
}

function filedDay(entry: ParsedInsiderFiling): string | null {
  const date = entry.filing.filingDate;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

/** SEC Form 4 supplies an original filing date, but no transaction replacement ID. */
export function buildInsiderAmendmentScopes(parsed: readonly ParsedInsiderFiling[]): InsiderAmendmentScope[] {
  const filings = [...new Map(parsed.map((entry) => [entry.filing.accessionNumber, entry])).values()];
  return filings.filter(isAmendedInsiderFiling).map((amendment) => {
    const originalFilingDate = amendment.disclosure?.originalFilingDate ?? null;
    const identity = ownerIdentity(amendment);
    const amendmentDay = filedDay(amendment);
    const originalFilingDateUsable = originalFilingDate !== null && (!amendmentDay || originalFilingDate <= amendmentDay);
    const candidates = filings.filter((entry) => {
      if (isAmendedInsiderFiling(entry)) return false;
      const originalDay = filedDay(entry);
      if (originalDay && originalFilingDateUsable && originalDay !== originalFilingDate) return false;
      if (originalDay && amendmentDay && originalDay > amendmentDay) return false;
      const originalIdentity = ownerIdentity(entry);
      // Missing ownership identity cannot establish that the filings are independent.
      return !identity.complete || !originalIdentity.complete || identity.ciks.some((cik) => originalIdentity.ciks.includes(cik));
    });
    return {
      accessionNumber: amendment.filing.accessionNumber,
      originalFilingDate,
      originalFilingDateUsable,
      ownerCiks: identity.ciks,
      ownerIdentityComplete: identity.complete,
      candidateOriginalAccessions: candidates.map((entry) => entry.filing.accessionNumber),
    };
  });
}

export function affectingInsiderAmendments(entry: ParsedInsiderFiling, scopes: readonly InsiderAmendmentScope[]): InsiderAmendmentScope[] {
  return scopes.filter((scope) => scope.accessionNumber === entry.filing.accessionNumber
    || scope.candidateOriginalAccessions.includes(entry.filing.accessionNumber));
}

export function relevantInsiderAmendments(parsed: readonly ParsedInsiderFiling[], context: readonly ParsedInsiderFiling[] = parsed): InsiderAmendmentScope[] {
  const scopes = buildInsiderAmendmentScopes(context);
  return scopes.filter((scope) => parsed.some((entry) => affectingInsiderAmendments(entry, [scope]).length > 0));
}
