import nodemailer from 'nodemailer';

/**
 * Mail from the company's own address (info@inverse.ge, Google Workspace).
 * SMTP_USER / SMTP_PASS (an app password of that mailbox) are set in Vercel by
 * the owner. Without them nothing is sent and the caller falls back to the
 * copy / WhatsApp / mail-app buttons.
 */
export const mailReady = () => !!process.env.SMTP_USER && !!process.env.SMTP_PASS;

export async function sendMail(
  to: string,
  subject: string,
  text: string,
  html: string,
): Promise<boolean> {
  if (!mailReady()) return false;
  try {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await t.sendMail({
      from: `"Inverse" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });
    return true;
  } catch (e) {
    console.warn('mail: not sent', e);
    return false;
  }
}
