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

const deviceItemSchema = z.object({
  uid: z
    .string({ required_error: "UID is required" })
    .trim()
    .min(1, "UID is required"),
  serialNo: z.string().trim().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "BLOCKED"]).optional(),
  notes: z.string().trim().optional(),
});

const bulkCreateDeviceSchema = z.object({
  body: z
    .union([
      z.object({
        devices: z
          .array(deviceItemSchema, {
            required_error: "Devices array is required",
          })
          .min(1, "Devices array cannot be empty"),
      }),
      z
        .array(deviceItemSchema, {
          required_error: "Devices array is required",
        })
        .min(1, "Devices array cannot be empty"),
    ])
    .superRefine((data, ctx) => {
      const devices = Array.isArray(data) ? data : data.devices;
      const seenUids = new Set<string>();
      const seenSerials = new Set<string>();

      for (let i = 0; i < devices.length; i++) {
        const item = devices[i];
        const uid = item.uid.trim();
        if (seenUids.has(uid)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate UID "${uid}" found in the upload batch (item ${i + 1}).`,
          });
        }
        seenUids.add(uid);

        if (item.serialNo) {
          const serial = item.serialNo.trim();
          if (seenSerials.has(serial)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Duplicate Serial Number "${serial}" found in the upload batch (item ${i + 1}).`,
            });
          }
          seenSerials.add(serial);
        }
      }
    }),
});

export const RegisteredDeviceValidation = {
  createDeviceSchema,
  updateDeviceSchema,
  bulkCreateDeviceSchema,
};
