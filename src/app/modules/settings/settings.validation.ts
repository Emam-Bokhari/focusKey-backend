import { z } from "zod";

const settingsValidationSchema = z.object({
  body: z.object({
    appName: z.string().min(1, "App name cannot be empty").optional(),
    supportEmail: z.string().email("Invalid support email").optional(),
  }),
});

export const SettingsValidationSchema = {
  settingsValidationSchema,
};
