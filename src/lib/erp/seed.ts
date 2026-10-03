// Fake data for the sandbox ERP (docs/BUILD_SPEC.md D3). Every name, IBAN and supplier here is invented.
import type { Invoice } from "@/lib/types";

export const COST_CENTERS: { code: string; label: string }[] = [
  { code: "4711", label: "Opex - operating supplies" },
  { code: "0400", label: "Capex - machinery and equipment" },
  { code: "4720", label: "Opex - maintenance" },
];

export const SEED_INVOICES: Invoice[] = [
  {
    id: "4471",
    supplier: "Hydrotek Maschinen GmbH",
    supplier_country: "DE",
    supplier_entity: "external",
    date: "2026-09-22",
    amount_eur: 7400,
    description: "Hydraulic press HP-200 (equipment)",
    cost_center: "4711",
    asset_number: "",
    approval_status: "open",
    contact_name: "Jonas Brenninger",
    iban: "DE44 5001 0517 5407 3249 31",
  },
  {
    id: "4498",
    supplier: "Nordlicht Verpackung AG",
    supplier_country: "CH",
    supplier_entity: "external",
    date: "2026-12-01",
    amount_eur: 1860,
    description: "Packaging material December",
    cost_center: "4711",
    asset_number: "",
    approval_status: "saved",
    contact_name: "Regula Imhasly",
    iban: "CH93 0076 2011 6238 5295 7",
  },
  {
    id: "4502",
    supplier: "Nordlicht Verpackung AG",
    supplier_country: "CH",
    supplier_entity: "external",
    date: "2026-12-03",
    amount_eur: 1860,
    description: "Packaging material December",
    cost_center: "4711",
    asset_number: "",
    approval_status: "open",
    contact_name: "Regula Imhasly",
    iban: "CH93 0076 2011 6238 5295 7",
  },
  {
    id: "4517",
    supplier: "Strojirna Brno s.r.o.",
    supplier_country: "CZ",
    supplier_entity: "subsidiary",
    date: "2026-09-25",
    amount_eur: 3250,
    description: "Machined flanges, intercompany",
    cost_center: "4711",
    asset_number: "",
    approval_status: "open",
    contact_name: "Petra Vondrackova",
    iban: "CZ65 0800 0000 1920 0014 5399",
  },
  {
    id: "4630",
    supplier: "Kessler Antriebstechnik GmbH",
    supplier_country: "DE",
    supplier_entity: "external",
    date: "2026-10-02",
    amount_eur: 7200,
    description: "Servo drive unit SD-75 (equipment)",
    cost_center: "4711",
    asset_number: "",
    approval_status: "open",
    contact_name: "Matthias Oberkirch",
    iban: "DE89 3704 0044 0532 0130 00",
    teach_only: true,
  },
];

/** Fake contact names that appear on screen, for the PII redactor. */
export const KNOWN_PII_NAMES: string[] = Array.from(
  new Set(SEED_INVOICES.map((i) => i.contact_name).filter((n): n is string => !!n)),
);
