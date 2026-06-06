import { z } from "zod";

const createBannerValidationSchema = z.object({
  body: z.object({
    name: z.string(),
    description: z.string(),
    image: z.string(),
    status: z.boolean().default(true),
  }),
});

export const BannerZodValidation = {
  createBannerValidationSchema,
};
