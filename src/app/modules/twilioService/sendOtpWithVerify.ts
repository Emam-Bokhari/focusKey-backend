import { StatusCodes } from "http-status-codes";
import twilio, { Twilio } from "twilio";
import config from "../../../config";
import ApiError from "../../../errors/ApiErrors";

interface PhoneFormatConfig {
  defaultCountryCode: string;
  countryCodes: string[];
}

class TwilioService {
  private client: Twilio;
  private phoneConfig: PhoneFormatConfig;

  constructor() {
    const accountSid = config.twilio.accountSid;
    const authToken = config.twilio.authToken;

    // Initialize Twilio client
    this.client = twilio(accountSid, authToken);

    // Configure country codes
    this.phoneConfig = {
      defaultCountryCode: "+880", // Bangladesh default
      countryCodes: [
        "+1", // USA/Canada
        "+44", // UK
        "+91", // India
        "+880", // Bangladesh
        "+92", // Pakistan
        "+966", // Saudi Arabia
        "+971", // UAE
        "+60", // Malaysia
        "+65", // Singapore
        "+86", // China
        "+81", // Japan
        "+82", // South Korea
      ],
    };
  }

  // ✅ Format phone number to E.164 format
  private formatPhoneNumber(phoneNumber: string, countryCode?: string): string {
    let phone = phoneNumber.trim().replace(/\s+/g, ""); // Remove spaces

    // If already in E.164 format (starts with +), validate and return
    if (phone.startsWith("+")) {
      const isValid = this.phoneConfig.countryCodes.some((code) =>
        phone.startsWith(code),
      );

      if (isValid) {
        return phone;
      } else {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid country code in phone number",
        );
      }
    }

    // Use provided country code or default
    const code = countryCode || this.phoneConfig.defaultCountryCode;

    // Validate provided country code
    if (!this.phoneConfig.countryCodes.includes(code)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid country code: ${code}`,
      );
    }

    // Remove leading 0 if exists (common in local formats)
    if (phone.startsWith("0")) {
      phone = phone.substring(1);
    }

    // Combine country code with phone number
    return `${code}${phone}`;
  }

  // Using Twilio Verify API
  async sendOTPWithVerify(
    phoneNumber: string,
    countryCode: string,
  ): Promise<void> {
    try {
      // Format phone number to E.164
      const formattedPhone = this.formatPhoneNumber(phoneNumber, countryCode);

      console.log("Original phone:", phoneNumber);
      console.log("Country code:", countryCode);
      console.log("Formatted phone:", formattedPhone);
      console.log("Service SID:", config.twilio.serviceSid);

      const verification = await this.client.verify.v2
        .services(config.twilio.serviceSid!)
        .verifications.create({
          to: formattedPhone,
          channel: "sms",
        });

      console.log("Verification:", verification);
      console.log(`OTP sent to ${formattedPhone}: ${verification.sid}`);
    } catch (error: any) {
      console.error("Twilio Error Details:", {
        message: error.message,
        code: error.code,
        status: error.status,
        moreInfo: error.moreInfo,
      });

      throw new ApiError(
        StatusCodes.EXPECTATION_FAILED,
        `Failed to send verification code: ${error.message}`,
      );
    }
  }

  // Verify the OTP
  async verifyOTP(
    phoneNumber: string,
    code: string,
    countryCode: string,
  ): Promise<boolean> {
    try {
      // Format phone number to E.164
      const formattedPhone = this.formatPhoneNumber(phoneNumber, countryCode);

      console.log("Verifying OTP for:", formattedPhone);
      console.log("Code:", code);

      const verification = await this.client.verify.v2
        .services(config.twilio.serviceSid!)
        .verificationChecks.create({
          to: formattedPhone,
          code: code,
        });

      console.log("Verification status:", verification.status);
      return verification.status === "approved";
    } catch (error: any) {
      console.error("Verify Error Details:", {
        message: error.message,
        code: error.code,
        status: error.status,
      });

      throw new ApiError(
        StatusCodes.EXPECTATION_FAILED,
        `Failed to verify code: ${error.message}`,
      );
    }
  }
}

export const twilioService = new TwilioService();
