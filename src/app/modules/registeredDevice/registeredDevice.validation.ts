import { z } from "zod";

const createDeviceSchema = z.object({
  body: z.object({
    uid: z.string({ required_error: "UID is required" }),
    serialNo: z.string().optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).default("ACTIVE"),
    notes: z.string().optional(),
  }),
});

const updateDeviceSchema = z.object({
  body: z.object({
    uid: z.string().optional(),
    serialNo: z.string().optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).optional(),
    notes: z.string().optional(),
  }),
});

export const RegisteredDeviceValidation = {
  createDeviceSchema,
  updateDeviceSchema,
};
