import type { FinancialStatement, IncomeStatementField } from "../types/financials";

export const INCOME_STATEMENT_FIELDS: readonly IncomeStatementField[] = [
  "netIncome", "netIncomeIncludingNoncontrollingInterests", "netIncomeCommonStockholders",
];

export function isIncomeStatementField(field: string): field is IncomeStatementField {
  return (INCOME_STATEMENT_FIELDS as readonly string[]).includes(field);
}

/** An explicit SEC observation or coverage gap outranks unidentified cached income. */
export function incomeFieldOwner(
  field: IncomeStatementField,
  primary: FinancialStatement,
  fallback?: FinancialStatement,
): FinancialStatement | undefined {
  return [primary, fallback?.date === primary.date ? fallback : undefined]
    .filter((row): row is FinancialStatement => !!row && (row.fieldSources?.[field]?.source === "sec" || row.unavailableFields?.includes(field) === true))
    .sort((left, right) => incomeFieldKnowledgeDate(right, field).localeCompare(incomeFieldKnowledgeDate(left, field)))[0];
}

/** Income revisions cannot be ordered by an unrelated asset's publication date. */
export function incomeFieldKnowledgeDate(row: FinancialStatement, field: IncomeStatementField): string {
  return row.fieldSources?.[field]?.filed ?? row.fieldAvailability?.[field]
    ?? (row.unavailableFields?.includes(field)
      ? Object.values(row.fieldSources ?? {}).map(source => source?.filed ?? "").sort().at(-1) ?? ""
      : "");
}

/** Copy the value and its attribution together; never revive an explicit gap. */
export function copyIncomeField(target: FinancialStatement, owner: FinancialStatement, field: IncomeStatementField): void {
  target.fieldSources = { ...target.fieldSources };
  delete target.fieldSources[field];
  target.unavailableFields = (target.unavailableFields ?? []).filter(key => key !== field);
  if (owner.unavailableFields?.includes(field)) {
    delete target[field];
    target.unavailableFields.push(field);
  } else {
    const value = owner[field];
    if (typeof value === "number" && Number.isFinite(value)) target[field] = value;
    else delete target[field];
    if (owner.fieldSources?.[field]) target.fieldSources[field] = owner.fieldSources[field];
  }
  if (!target.unavailableFields.length) delete target.unavailableFields;
  if (!Object.keys(target.fieldSources).length) delete target.fieldSources;
}
