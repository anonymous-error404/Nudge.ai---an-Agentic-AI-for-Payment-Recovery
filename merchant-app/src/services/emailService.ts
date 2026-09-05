import nodemailer from "nodemailer";

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "587", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME ?? "TechZone";
const SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL ?? "noreply@techzone.store";

const useRealSMTP = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);

class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private isEthereal = false;

  async init() {
    if (useRealSMTP) {
      // ── Real SMTP (Gmail, Brevo, Resend, etc.) ────────────────────────────
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465, // true for 465, false for 587
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      this.isEthereal = false;
      console.log(`📧 Email Service: real SMTP (${SMTP_HOST}:${SMTP_PORT}) — ready to send.`);
    } else {
      // ── Ethereal fallback (dev / demo without credentials) ────────────────
      const account = await nodemailer.createTestAccount();
      this.transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      });
      this.isEthereal = true;
      console.log("📧 Email Service: Ethereal (test mode — no SMTP_HOST set). Emails viewable via preview URL.");
    }
  }

  async sendEmail(to: string, subject: string, htmlContent: string) {
    if (!this.transporter) {
      await this.init();
    }

    try {
      const info = await this.transporter!.sendMail({
        from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
        to,
        subject,
        html: htmlContent,
      });

      console.log(`\n${"─".repeat(56)}`);
      console.log(`📧  EMAIL DISPATCHED`);
      console.log(`    To:      ${to}`);
      console.log(`    Subject: ${subject}`);
      if (this.isEthereal) {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        console.log(`    Preview: ${previewUrl}`);
      } else {
        console.log(`    Message ID: ${info.messageId}`);
      }
      console.log(`${"─".repeat(56)}\n`);

      return this.isEthereal
        ? { success: true, previewUrl: nodemailer.getTestMessageUrl(info), messageId: info.messageId }
        : { success: true, messageId: info.messageId };

    } catch (error) {
      console.error("\n❌  Email dispatch failed:", error);
      return { success: false, error: String(error) };
    }
  }
}

export const emailService = new EmailService();
