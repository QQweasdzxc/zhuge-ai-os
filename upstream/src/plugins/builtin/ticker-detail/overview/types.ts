export interface StatField {
  label: string;
  value: string;
  valueColor?: string;
}

export interface PositionTableRow {
  account: string;
  qty: string;
  quantityUnit?: "face";
  avg: string;
  mark: string;
  cost: string;
  value: string;
  pnl: string;
  ret: string;
  pnlValue: number | null;
  pnlBasis: "quote-and-cost" | "broker-snapshot" | "mixed" | "unavailable";
}
