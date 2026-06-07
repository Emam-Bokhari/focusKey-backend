import { z } from "zod";

const createAdminZodSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "Name is required" }),
    email: z.string().optional(),
    password: z.string({ required_error: "Password is required" }),
    role: z.string({ required_error: "Role is required" }),
  }),
});

const handleUserPairingZodSchema = z.object({
  body: z.object({
    deviceName: z.string().optional(),
    deviceFingerprint: z.string().optional(),
    platform: z.enum(["android", "ios", "web"]).optional(),
  }),
});export const UserValidation = {
  createAdminZodSchema,
  handleUserPairingZodSchema,
};
