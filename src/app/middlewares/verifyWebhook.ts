import { Request, Response, NextFunction } from "express";
import { createHmac } from "crypto";

export const verifyCinetPayWebhook = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const signature = req.headers["x-cinetpay-signature"] as string | undefined;

  if (!signature) {
    return res.status(401).json({ message: "Missing signature" });
  }

  // Support both possible env var spellings and ensure we have a secret
  const secret =
    process.env.CINETPAY_SECRET_KEY || process.env.CINATPAY_SECRET_KEY;
  if (!secret) {
    return res
      .status(500)
      .json({ message: "Server misconfiguration: missing webhook secret" });
  }

  // Prefer raw body if available (recommended for webhook verification), otherwise fall back to JSON string
  const payload = (req as any).rawBody ?? JSON.stringify(req.body);
  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  if (signature !== expected) {
    return res.status(401).json({ message: "Invalid signature" });
  }

  next();
};
