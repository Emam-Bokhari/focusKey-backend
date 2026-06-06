import { z } from "zod";

const paymentNumberValidationSchema = z.object({
  label: z
    .string({
      required_error: "Payment label is required",
    })
    .min(1, "Label cannot be empty"),

  number: z
    .string({
      required_error: "Payment number is required",
    })
    .min(5, "Invalid payment number"),
});

const settingsValidationSchema = z.object({
  body: z.object({
    paymentNumbers: z
      .array(paymentNumberValidationSchema)
      .min(1, "At least one payment method is required"),

    currency: z
      .string({
        required_error: "Currency is required",
      })
      .min(1, "Currency cannot be empty")
      .max(10, "Invalid currency format"),
  }),
});

export const SettingsValidationSchema = {
  settingsValidationSchema,
};
