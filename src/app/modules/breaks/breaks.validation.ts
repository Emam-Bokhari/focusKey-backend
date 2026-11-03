import { z } from "zod";

const updateBreakConfigZodSchema = z.object({
  body: z.object({
    breaksPerDay: z
      .number({
        invalid_type_error: "breaksPerDay must be a number",
      })
      .int("breaksPerDay must be an integer")
      .min(0, "breaksPerDay must be at least 0")
      .max(50, "breaksPerDay cannot exceed 50")
      .optional(),
    breakDurationMinutes: z
      .number({
        invalid_type_error: "breakDurationMinutes must be a number",
      })
      .int("breakDurationMinutes must be an integer")
      .min(1, "breakDurationMinutes must be at least 1 minute")
      .max(180, "breakDurationMinutes cannot exceed 180 minutes")
      .optional(),
  }),
});

export const BreakValidation = {
  updateBreakConfigZodSchema,
};

