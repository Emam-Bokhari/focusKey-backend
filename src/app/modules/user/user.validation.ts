import { z } from "zod";

const createAdminZodSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "Name is required" }),
    email: z.string().optional(),
    password: z.string({ required_error: "Password is required" }),
    role: z.string({ required_error: "Role is required" }),
  }),
});

const createUserZodSchema = z.object({
  body: z.object({
    name: z.string({ required_error: "Name is required" }),
    email: z.string({ required_error: "Email is required" }).email("Invalid email address"),
    password: z.string({ required_error: "Password is required" }).min(8, "Password must be at least 8 characters long"),
    phone: z.string().optional(),
    userName: z.string().optional(),
    role: z.string().optional(),
    countryCode: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
    dateOfBirth: z.string().optional(),
  }),
});

const handleUserPairingZodSchema = z.object({
  body: z.object({
    deviceName: z.string().optional(),
    deviceFingerprint: z.string().optional(),
    platform: z.enum(["android", "ios", "web"]).optional(),
  }),
});
export const UserValidation = {
  createUserZodSchema,
  createAdminZodSchema,
  handleUserPairingZodSchema,
};
