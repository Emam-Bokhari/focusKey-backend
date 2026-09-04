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
    email: z
      .string({ required_error: "Email is required" })
      .email("Invalid email address"),
    password: z
      .string({ required_error: "Password is required" })
      .min(8, "Password must be at least 8 characters long"),
    phone: z.string().optional(),
    userName: z.string().optional(),
    role: z.string().optional(),
    countryCode: z.string().optional(),
    country: z.string().optional(),
    postalCode: z.string().optional(),
    dateOfBirth: z.string().optional(),
    timezone: z.string().optional(),
  }),
});

const handleUserPairingZodSchema = z.object({
  body: z
    .object({
      uid: z.string({ required_error: "UID is required" }),
      device_fingerprint: z.string().optional(),
      deviceFingerprint: z.string().optional(),
      device_id: z.string().optional(),
      device_model: z.string({ required_error: "Device model is required" }),
      platform: z.enum(["android", "ios", "web"], {
        required_error: "Platform is required",
      }),
    })
    .refine(
      (data) =>
        !!(data.deviceFingerprint || data.device_fingerprint || data.device_id),
      {
        message: "Device identity (deviceFingerprint or device_id) is required",
        path: ["deviceFingerprint"],
      },
    ),
});
export const UserValidation = {
  createUserZodSchema,
  createAdminZodSchema,
  handleUserPairingZodSchema,
};
