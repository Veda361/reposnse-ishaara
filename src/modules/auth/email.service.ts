import { Resend } from "resend";
import { logger } from "../../config/logger";
import { env } from "../../config/env";

export interface SendOTPData {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
}

/**
 * Masks an email address for safe logging without leaking PII.
 * Example: "devranjeetq@gmail.com" -> "d***q@gmail.com"
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
   * Track email sending errors for request diagnostics and fail-fast guarantees.
   */
  private lastSendErrors: Map<string, Error> = new Map();

  /**
   * Cached Resend client instance.
   */
  private resendClient: Resend | null = null;
  private cachedApiKey: string | null = null;

  /**
   * Initialize or retrieve the Resend SDK client instance.
   * Lazily initialized only when RESEND_API_KEY exists. Never hardcodes keys.
   */
  public getResendClient(): Resend | null {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      this.resendClient = null;
      this.cachedApiKey = null;
      return null;
    }

    if (!this.resendClient || this.cachedApiKey !== apiKey) {
      this.resendClient = new Resend(apiKey);
      this.cachedApiKey = apiKey;
    }

    return this.resendClient;
  }

  /**
   * Constructs the branded responsive HTML email template for ISHAARA OTP delivery.
   */
  public buildOtpEmailHtml(otp: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ISHAARA Verification Code</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f5f7; color: #172b4d;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f4f5f7; padding: 30px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width: 500px; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08); border: 1px solid #e2e8f0;">
          <!-- Header with ISHAARA branding -->
          <tr>
            <td style="background-color: #0f172a; padding: 28px 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 700; letter-spacing: 1px;">ISHAARA</h1>
              <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 13px; font-weight: 400;">Smart Campus Transit & Commuter Platform</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px 28px;">
              <h2 style="margin: 0 0 12px 0; color: #1e293b; font-size: 18px; font-weight: 600;">Your verification code</h2>
              <p style="margin: 0 0 24px 0; color: #475569; font-size: 14px; line-height: 22px;">
                Use the one-time verification code below to sign in to your ISHAARA account:
              </p>
              <!-- 6-digit OTP Display Box -->
              <div style="background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 18px; text-align: center; margin: 0 0 24px 0;">
                <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #0f172a; display: inline-block;">${otp}</span>
              </div>
              <!-- Expiration and Security Warning -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 0 0 20px 0;">
                <tr>
                  <td style="color: #64748b; font-size: 13px; line-height: 20px;">
                    ⏱ <strong>Valid for 5 minutes.</strong> This code will expire shortly.
                  </td>
                </tr>
                <tr>
                  <td style="color: #dc2626; font-size: 13px; line-height: 20px; padding-top: 8px;">
                    🛡 <strong>Security notice:</strong> Never share this code with anyone. ISHAARA staff will never request your verification code.
                  </td>
                </tr>
              </table>
              <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 16px 0;" />
              <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 18px;">
                If you did not request this verification code, please ignore this email or contact support if you have concerns.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 28px; text-align: center; border-top: 1px solid #f1f5f9;">
              <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                &copy; ${new Date().getFullYear()} ISHAARA Platform. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Constructs the plaintext email fallback for ISHAARA OTP delivery.
   */
  public buildOtpEmailText(otp: string): string {
    return [
      "ISHAARA - Smart Campus Transit & Commuter Platform",
      "",
      "Your verification code is:",
      `  ${otp}`,
      "",
      "This code is valid for 5 minutes.",
      "",
      "Security Notice: Never share this verification code with anyone. ISHAARA staff will never ask for your code.",
      "",
      "If you did not request this verification code, please ignore this email.",
    ].join("\n");
  }

  /**
   * Dispatches an OTP to the given email address.
   * In production: strictly uses Resend API. Missing configuration or API errors will throw immediately.
   * In non-production: uses Resend if configured; otherwise records in test memory store.
   */
  async sendOTP(data: SendOTPData): Promise<{ messageId?: string }> {
    const normalizedEmail = data.email.toLowerCase().trim();
    this.clearLastSendError(normalizedEmail);

    const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === "production";
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const rawEmailFrom = process.env.EMAIL_FROM?.trim();

    // 1. Production strict validation: fail clearly if email configuration is missing
    if (isProduction) {
      if (!apiKey) {
        const error = new Error("RESEND_API_KEY environment variable is required in production");
        this.setLastSendError(normalizedEmail, error);
        logger.error("Production email delivery failed: RESEND_API_KEY is not configured", {
          EMAIL_PROVIDER: "resend",
          EMAIL_SEND_SUCCESS: false,
          recipient: maskEmail(normalizedEmail),
        });
        throw error;
      }

      if (!rawEmailFrom) {
        const error = new Error("EMAIL_FROM environment variable is required in production");
        this.setLastSendError(normalizedEmail, error);
        logger.error("Production email delivery failed: EMAIL_FROM is not configured", {
          EMAIL_PROVIDER: "resend",
          EMAIL_SEND_SUCCESS: false,
          recipient: maskEmail(normalizedEmail),
        });
        throw error;
      }
    }

    // 2. Record in test memory store for dev/testing visibility
    this.testOtps.set(normalizedEmail, data.otp);

    // 3. Dispatch via Resend SDK if API key is present
    if (apiKey) {
      const emailFrom = rawEmailFrom
        ? (rawEmailFrom.includes("<") ? rawEmailFrom : `ISHAARA <${rawEmailFrom}>`)
        : "ISHAARA <onboarding@resend.dev>";

      const resend = this.getResendClient();
      if (!resend) {
        const error = new Error("Failed to initialize Resend client with provided RESEND_API_KEY");
        this.setLastSendError(normalizedEmail, error);
        throw error;
      }

      try {
        const { data: resendData, error: resendError } = await resend.emails.send({
          from: emailFrom,
          to: [normalizedEmail],
          subject: "Your ISHAARA Verification Code",
          html: this.buildOtpEmailHtml(data.otp),
          text: this.buildOtpEmailText(data.otp),
        });

        // Safe inspection of Resend response
        if (resendError) {
          const deliveryError = new Error(`Failed to deliver OTP email: ${resendError.message}`);
          this.setLastSendError(normalizedEmail, deliveryError);

          // Structured safe logging: Never log OTP, API key, or headers
          logger.error("Resend API error during email dispatch", {
            EMAIL_PROVIDER: "resend",
            EMAIL_SEND_SUCCESS: false,
            recipient: maskEmail(normalizedEmail),
            errorName: resendError.name,
            errorMessage: resendError.message,
          });

          throw deliveryError;
        }

        // Safe success logging
        logger.info("Verification OTP email sent via Resend", {
          EMAIL_PROVIDER: "resend",
          EMAIL_SEND_SUCCESS: true,
          recipient: maskEmail(normalizedEmail),
          messageId: resendData?.id,
          type: data.type,
        });

        return { messageId: resendData?.id };
      } catch (err: any) {
        this.setLastSendError(normalizedEmail, err);

        // Structured safe error logging
        logger.error("Failed to send OTP email via Resend", {
          EMAIL_PROVIDER: "resend",
          EMAIL_SEND_SUCCESS: false,
          recipient: maskEmail(normalizedEmail),
          errorMessage: err?.message || "Unknown email delivery failure",
        });

        throw err;
      }
    }

    // 4. Non-production fallback when RESEND_API_KEY is not supplied
    logger.debug("Development/Test OTP generated (in-memory transport):", {
      recipient: maskEmail(normalizedEmail),
      type: data.type,
      otpLength: data.otp.length,
    });

    return { messageId: "dev-memory-transport" };
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
   * Record the last delivery error for an email recipient.
   */
  public setLastSendError(email: string, error: Error): void {
    this.lastSendErrors.set(email.toLowerCase().trim(), error);
    this.lastSendErrors.set("__global__", error);
  }

  /**
   * Retrieve the last delivery error for an email recipient.
   */
  public getLastSendError(email?: string): Error | null {
    if (email) {
      return this.lastSendErrors.get(email.toLowerCase().trim()) || null;
    }
    return this.lastSendErrors.get("__global__") || null;
  }

  /**
   * Clear the last delivery error.
   */
  public clearLastSendError(email?: string): void {
    if (email) {
      this.lastSendErrors.delete(email.toLowerCase().trim());
    } else {
      this.lastSendErrors.clear();
    }
  }
}

export const emailService = new EmailService();
