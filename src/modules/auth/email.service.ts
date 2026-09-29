import { logger } from "../../config/logger";
import { env } from "../../config/env";

export interface SendOTPData {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}

/**
 * Masks an email address for safe logging without leaking PII.
 * Example: "student123@isahara.app" -> "s***3@isahara.app"
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) {
    return "****";
  }
  const [local, domain] = email.split("@");
  if (local.length <= 2) {
    return `${local[0]}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export class EmailService {
  /**
   * In-memory store of recent OTPs for local development and automated testing.
   * Key: email (lowercased), Value: OTP string
   */
  private testOtps: Map<string, string> = new Map();

  /**
   * Dispatches an OTP to the given email address.
   * Uses Resend REST API if configured, otherwise falls back to controlled development/test delivery.
   */
  async sendOTP(data: SendOTPData): Promise<void> {
    const normalizedEmail = data.email.toLowerCase().trim();

    // Store in test/dev memory store
    this.testOtps.set(normalizedEmail, data.otp);

    // Production Resend API dispatch if API key is provided
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        await this.sendViaResend({
          apiKey: resendApiKey,
          to: normalizedEmail,
          otp: data.otp,
          type: data.type,
        });
        logger.info("Verification OTP email sent via Resend", {
          email: maskEmail(normalizedEmail),
          type: data.type,
        });
        return;
      } catch (error) {
        logger.error("Failed to send OTP email via Resend:", error);
        // Do not crash Better Auth; error logged
      }
    }

    // Development / Test delivery logging
    if (env.NODE_ENV === "production") {
      logger.warn("No production email provider configured. OTP not dispatched externally.", {
        email: maskEmail(normalizedEmail),
        type: data.type,
      });
    } else {
      logger.debug("Development/Test OTP generated:", {
        email: maskEmail(normalizedEmail),
        type: data.type,
        otpLength: data.otp.length,
      });
    }
  }

  /**
   * Helper to retrieve the last generated OTP for automated testing.
   */
  getTestOTP(email: string): string | undefined {
    return this.testOtps.get(email.toLowerCase().trim());
  }

  /**
   * Helper to clear the test OTP store between test runs.
   */
  clearTestOTPs(): void {
    this.testOtps.clear();
  }

  /**
   * Sends an OTP email using the Resend REST API via native fetch.
   */
  private async sendViaResend(params: {
    apiKey: string;
    to: string;
    otp: string;
    type: string;
  }): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Ishaara <noreply@isahara.app>",
        to: [params.to],
        subject: "Your Ishaara Verification Code",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Your Ishaara Verification Code</h2>
            <p>Use the following 6-digit code to complete your sign-in:</p>
            <div style="background-color: #f4f4f4; padding: 15px; border-radius: 6px; font-size: 28px; font-weight: bold; letter-spacing: 5px; text-align: center; color: #111;">
              ${params.otp}
            </div>
            <p style="color: #666; font-size: 13px; margin-top: 20px;">
              This code is valid for 5 minutes. If you did not request this code, please ignore this email.
            </p>
          </div>
        `,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Resend API error (${response.status}): ${errorText}`);
    }
  }
}

export const emailService = new EmailService();
