import nodemailer from "nodemailer";

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  async init() {
    // Dynamically generate an Ethereal test account
    // This allows testing without real SMTP credentials
    // Ethereal gives us a URL to view the sent emails in a browser
    const account = await nodemailer.createTestAccount();
    
    this.transporter = nodemailer.createTransport({
      host: account.smtp.host,
      port: account.smtp.port,
      secure: account.smtp.secure,
      auth: {
        user: account.user,
        pass: account.pass,
      },
    });

    console.log("📧 Ethereal Email Service Initialized. Ready to send emails.");
  }

  async sendEmail(to: string, subject: string, htmlContent: string) {
    if (!this.transporter) {
      await this.init();
    }

    try {
      const info = await this.transporter!.sendMail({
        from: '"Your Store" <noreply@yourstore.com>',
        to,
        subject,
        html: htmlContent,
      });

      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`\n========================================================`);
      console.log(`📧 NEW EMAIL SENT TO: ${to}`);
      console.log(`SUBJECT: ${subject}`);
      console.log(`PREVIEW URL: ${previewUrl}`);
      console.log(`========================================================\n`);

      return { success: true, previewUrl, messageId: info.messageId };
    } catch (error) {
      console.error("Failed to send email:", error);
      return { success: false, error: String(error) };
    }
  }
}

export const emailService = new EmailService();
