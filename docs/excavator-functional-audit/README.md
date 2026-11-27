# Excavator Management — Functional Audit

A read-only functional reconstruction of the TrackMarg excavator management product.

It answers:
- what every feature does, field by field;
- the exact calculations;
- the end-to-end business workflows;
- record lifecycles and cross-module data flow;
- real-world edge cases;
- the gaps.

Start with [00_MASTER_EXECUTIVE_SUMMARY.md](00_MASTER_EXECUTIVE_SUMMARY.md).

## Which build this describes

The audit was carried out on 2026-11-24 against the **`excavator-manager`** codebase, which is the newer build of the same product. The method was code reading only; no application was run.

This repository is an older fork of that product, so a few parts of the audit describe features that are **not in this repository**. In this repository:

- There is no **Expenses** page or module, and no **diesel price** setting.
- There is no bill-template choice (Standard / Daily Summary), no "machines by site" view, and no Direct-bill hours helper (direct-bill hours are typed by hand).
- **Business Profit** is simpler. It covers the current month only:
  - revenue = bills dated this month, including GST;
  - expenses = service-record cost + operator salary (base + bonus).
- The **dashboard** has no date-range filter. "Amount Received" is all payments ever.
- **Site statuses** are Active, Completed and On Hold only. There is no Partially Completed.
- Moving a machine to another site does not ask for the old site's status.
- This repository **adds** the voice/text assistant (see [../assistant.md](../assistant.md)). Its app guide, `src/lib/agent/knowledge.ts`, was written from this audit and re-checked against *this* build.

Everything else, including billing, payments, work sessions, readings, approvals, operators and salary, customers and site rates, uses identical business logic in both builds. Those sections apply here as written.

File paths cited in the audit are relative to `excavator-manager/`. Most also exist here under the same names.
