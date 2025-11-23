import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY!;
const resend = new Resend(apiKey);

export async function sendMagicLinkToUser(email: string, link: string) {
	const mailSent = await resend.emails.send({
		from: "onboarding@resend.dev",
		to: email,
		subject: "Verify your email to get started on Leveron",
		html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #2563eb; text-align: center;">Welcome to Leveron 🚀</h2>
        <p>Hey,</p>
        <p>Click the button below to securely verify your email and continue your registration:</p>

        <a href="${link}"
          style="display: inline-block; background: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 500; text-align: center; margin: 20px auto; width: fit-content;">
          Verify Email
        </a>

        <p>If the button doesn't work, use the link below:</p>
        <p style="word-break: break-word;">
          <a href="${link}" style="color: #2563eb;">${link}</a>
        </p>

        <p style="margin-top: 30px;">If you didn’t request this, no action is required. This link will automatically expire soon for security reasons.</p>

        <p style="font-size: 14px; color: #6b7280;">Thanks,<br/>The Leveron Team</p>
      </div>
    `,
	});
}
