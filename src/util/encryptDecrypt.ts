import CryptoJS from "crypto-js";

const ENCRYPTION_SECRET_KEY = process.env.ENCRYPTION_KEY || "your-secret-key";

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, ENCRYPTION_SECRET_KEY).toString();
}

export function decrypt(encryptedText: string): string {
  const bytes = CryptoJS.AES.decrypt(encryptedText, ENCRYPTION_SECRET_KEY);
  return bytes.toString(CryptoJS.enc.Utf8);
}
