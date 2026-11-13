"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/native-select";
import { BUSINESS_EFFECTS, BUSINESS_EFFECT_LABEL } from "@/lib/validation/operatorTransaction";

/** Shared field set for both AddTransactionDialog and EditTransactionDialog
 * — same form either way, just pre-filled differently and posted to a
 * different endpoint by the caller. */
export function TransactionFormFields({
  categories,
  defaultCategoryId = "",
  defaultAmount,
  defaultDate,
  defaultNotes = "",
  defaultDeductFromSalary = true,
  defaultBusinessEffect = "ADVANCE_RECOVERABLE",
}: {
  categories: { id: string; name: string }[];
  defaultCategoryId?: string;
  defaultAmount?: number;
  defaultDate: string;
  defaultNotes?: string;
  defaultDeductFromSalary?: boolean;
  defaultBusinessEffect?: (typeof BUSINESS_EFFECTS)[number];
}) {
  const [addingCustom, setAddingCustom] = useState(false);
  const [deductFromSalary, setDeductFromSalary] = useState(defaultDeductFromSalary);

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={addingCustom ? "newCategoryName" : "categoryId"} className="text-base">
          Category
        </Label>
        {!addingCustom ? (
          <>
            <NativeSelect id="categoryId" data-agent-id="categoryId" name="categoryId" defaultValue={defaultCategoryId} className="h-12 text-base">
              <option value="" disabled>
                Select category
              </option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            <button
              type="button"
              onClick={() => setAddingCustom(true)}
              className="self-start text-sm font-semibold text-primary-text"
            >
              + Add Custom Category
            </button>
          </>
        ) : (
          <>
            <Input id="newCategoryName" name="newCategoryName" placeholder="e.g. Mobile Repair" required className="h-12 text-base" />
            <button
              type="button"
              onClick={() => setAddingCustom(false)}
              className="self-start text-sm font-semibold text-muted-foreground"
            >
              Use existing category instead
            </button>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="amount" className="text-base">Amount</Label>
          <Input id="amount" data-agent-id="amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            defaultValue={defaultAmount}
            className="h-12 text-base"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="date" className="text-base">Date</Label>
          <Input id="date" data-agent-id="date" name="date" type="date" defaultValue={defaultDate} required className="h-12 text-base" />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="notes" className="text-base">Notes (Optional)</Label>
        <Input id="notes" name="notes" defaultValue={defaultNotes} className="h-12 text-base" />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="deductFromSalary"
          checked={deductFromSalary}
          onChange={(e) => setDeductFromSalary(e.target.checked)}
          className="size-4"
        />
        Deduct this amount from salary?
      </label>

      <div className="flex flex-col gap-2">
        <Label htmlFor="businessEffect" className="text-base">How should this affect the business account?</Label>
        <NativeSelect id="businessEffect" name="businessEffect" defaultValue={defaultBusinessEffect} className="h-12 text-base">
          {BUSINESS_EFFECTS.map((effect) => (
            <option key={effect} value={effect}>
              {BUSINESS_EFFECT_LABEL[effect]}
            </option>
          ))}
        </NativeSelect>
      </div>
    </>
  );
}
