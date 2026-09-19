import { z } from "zod";

/**
 * Validation schema for GET /api/v1/drivers/me/operations/context.
 */
export const driverOperationalContextQuerySchema = z.object({
  timezone: z
    .string()
    .trim()
    .optional()
    .default("Asia/Kolkata"),
});

export type DriverOperationalContextQuery = z.infer<
  typeof driverOperationalContextQuerySchema
>;

/**
 * Validation schema for GET /api/v1/drivers/me/earnings.
 */
export const driverEarningsQuerySchema = z
  .object({
    period: z
      .enum(["today", "week", "month", "custom"])
      .optional()
      .default("today"),
    from: z
      .string()
      .trim()
      .datetime({ message: "'from' must be a valid ISO 8601 date string" })
      .optional(),
    to: z
      .string()
      .trim()
      .datetime({ message: "'to' must be a valid ISO 8601 date string" })
      .optional(),
    timezone: z
      .string()
      .trim()
      .optional()
      .default("Asia/Kolkata"),
    page: z
      .preprocess((val) => (val !== undefined ? Number(val) : 1), z.number().int().min(1))
      .optional()
      .default(1),
    limit: z
      .preprocess((val) => (val !== undefined ? Number(val) : 20), z.number().int().min(1).max(50))
      .optional()
      .default(20),
  })
  .refine(
    (data) => {
      if (data.period === "custom") {
        if (!data.from || !data.to) {
          return false;
        }
        return new Date(data.from) <= new Date(data.to);
      }
      return true;
    },
    {
      message:
        "When period is 'custom', both 'from' and 'to' valid ISO timestamps are required, and 'from' must be before or equal to 'to'.",
      path: ["from"],
    }
  );

export type DriverEarningsQueryInput = z.infer<
  typeof driverEarningsQuerySchema
>;
