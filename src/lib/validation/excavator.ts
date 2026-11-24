import { z } from "zod";
import { expectedVersionField } from "@/lib/validation/workSession";

// "" is how an empty <input type="date"> arrives; anything else must parse.
const optionalDate = z
  .string()
  .optional()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), "Enter a valid purchase date");

export const addExcavatorSchema = z.object({
  name: z.string().trim().min(1, "Enter a machine name"),
  machineNumber: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  model: z.string().trim().optional(),
  purchaseDate: optionalDate,
  startingHourMeter: z.coerce.number().min(0, "Must be 0 or more").max(10_000_000),
  serviceIntervalHrs: z.coerce.number().min(1, "Must be greater than 0").max(100_000).optional(),
});

export type AddExcavatorInput = z.infer<typeof addExcavatorSchema>;

// Starting hour meter is intentionally not editable after creation — it
// anchors service-due math and work history, so it stays fixed.
export const editExcavatorSchema = addExcavatorSchema
  .omit({ startingHourMeter: true })
  .extend({ startingHourMeter: z.coerce.number().min(0).optional(), expectedVersion: expectedVersionField });

export type EditExcavatorInput = z.infer<typeof editExcavatorSchema>;

export const setExcavatorSiteSchema = z.object({
  excavatorId: z.string().min(1),
  siteName: z.string().trim().min(1, "Enter a site"),
});

export type SetExcavatorSiteInput = z.infer<typeof setExcavatorSiteSchema>;

/** GET /api/excavators/performance?period=day|week|month|year&today=yyyy-MM-dd */
export const machineEarningsQuerySchema = z.object({
  period: z.enum(["day", "week", "month", "year"]).default("month"),
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "today must be yyyy-MM-dd")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date")
    .optional(),
});
