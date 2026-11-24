/** Shapes shared by the bill editor's hook, math and components. */

import type { SiteOption } from "../site-defaults";

export type BillType = "GST" | "NON_GST";

export type BillFormOptions = {
  customers: { id: string; name: string; companyName: string | null }[];
  /** With the customer they belong to and their saved rates (Site Analysis). */
  sites: SiteOption[];
  excavators: {
    id: string;
    name: string;
    machineNumber: string | null;
    currentSite?: { name: string } | null;
  }[];
  bankAccounts: { id: string; label: string; isDefaultForGst: boolean; isDefaultForNonGst: boolean }[];
  businessGstNumber: string | null;
  nextNonGstNumber: string;
};

export type BillFormInitial = {
  /** Version of the bill this form was loaded from (optimistic concurrency). */
  version: number;
  customerId: string;
  billDate: string;
  billNumber: string;
  billType: BillType;
  gstPercentage: number | null;
  buyerGstin: string;
  bankAccountId: string;
  notes: string;
  showCustomerPhone: boolean;
  transportCharges: number;
  fuelCharges: number;
  extraCharges: number;
  bucketCharge: number;
  breakerCharge: number;
  discount: number;
  dieselLiters: number;
  dieselPricePerLiter: number;
  deductDiesel: boolean;
  items: {
    id: string;
    attachment: string;
    excavatorId: string;
    siteName: string;
    fromDate: string;
    toDate: string;
    hours: number;
    ratePerHour: number;
  }[];
  // Direct bills only
  excavatorId: string;
  fromDate: string;
  toDate: string;
  bucketHours: number;
  bucketRate: number;
  breakerHours: number;
  breakerRate: number;
};

/** One line of the grid. Numbers are kept as the strings the user typed. */
export type Row = {
  /** Stable React key (not the database id, which new rows do not have). */
  key: number;
  /** Database id of an existing bill line; absent on new/duplicated rows. */
  id?: string;
  excavatorId: string;
  siteName: string;
  fromDate: string;
  toDate: string;
  hours: string;
  rate: string;
  attachment: string;
};

/** Grid columns that take part in Enter-to-move-down. */
export type Col = "machine" | "site" | "from" | "to" | "hours" | "rate";

/** Bill-level fields shared by every kind of bill. Money is typed text. */
export type BillFields = {
  customerId: string;
  billDate: string;
  transport: string;
  fuel: string;
  extra: string;
  bucket: string;
  breaker: string;
  discount: string;
  billType: BillType;
  gstPercentage: number;
  manualNumber: boolean;
  billNumber: string;
  buyerGstin: string;
  bankAccountId: string;
  notes: string;
  showCustomerPhone: boolean;
  /** Diesel the customer supplied — deducted from the total, not charged. */
  dieselLiters: string;
  dieselRate: string;
  deductDiesel: boolean;
};

/** Fields that only direct bills have. */
export type DirectFields = {
  excavatorId: string;
  fromDate: string;
  toDate: string;
  bucketHours: string;
  bucketRate: string;
  breakerHours: string;
  breakerRate: string;
};

/** Everything below is in rupees (hours for `hours`), already rounded to paise. */
export type BillTotals = {
  subtotal: number;
  /** Transport + fuel + extra + bucket + breaker charges. */
  charges: number;
  discount: number;
  taxable: number;
  tax: number;
  hours: number;
  dieselAdvance: number;
  total: number;
};

export type QuickFillParams = {
  machineIds: string[];
  from: string;
  to: string;
  hours: string;
  rate: string;
  site: string;
  attachment: string;
  perDay: boolean;
};

export type RowOps = {
  update: (key: number, patch: Partial<Row>) => void;
  setMachine: (key: number, excavatorId: string) => void;
  setFromDate: (key: number, fromDate: string) => void;
  add: () => void;
  duplicate: (key: number) => void;
  remove: (key: number) => void;
  applyRateToAll: (rate: string) => void;
  onCellKeyDown: (e: React.KeyboardEvent, rowIndex: number, col: Col) => void;
  onNumberPaste: (e: React.ClipboardEvent<HTMLInputElement>, rowIndex: number, col: "hours" | "rate") => void;
};
