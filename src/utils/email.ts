import nodemailer from "nodemailer";
import { db } from "../db/client.ts";
import { students } from "../db/students.ts";
import { eq } from "drizzle-orm";

// Helper function to escape HTML to prevent XSS
function escapeHtml(text: string): string {
	const map: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#039;",
	};
	return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Helper function to get student email by user number
export async function getStudentEmail(userNumber: string): Promise<string | null> {
	try {
		const [student] = await db
			.select({ email: students.email })
			.from(students)
			.where(eq(students.userNumber, userNumber))
			.limit(1);

		return student?.email || null;
	} catch (error) {
		console.error(`Error fetching student email for ${userNumber}:`, error);
		return null;
	}
}

// Create transporter using environment variables
const transporter = nodemailer.createTransport({
	host: process.env.SMTP_HOST || "smtp.gmail.com",
	port: parseInt(process.env.SMTP_PORT || "587"),
	secure: process.env.SMTP_SECURE === "true",
	auth: {
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS,
	},
});

export async function sendEmail(to: string, subject: string, html: string) {
	if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
		console.warn("SMTP credentials not configured; skipping email send.");
		return;
	}

	try {
		const info = await transporter.sendMail({
			from: process.env.SMTP_FROM || process.env.SMTP_USER,
			to,
			subject,
			html,
		});

		console.log(`✅ Email sent to ${to}: ${info.messageId}`);
		return info;
	} catch (error) {
		console.error(`❌ Error sending email to ${to}:`, error);
		throw error;
	}
}

export function getTicketCreatedEmail(ticketId: number, category: string, subcategory: string, description?: string) {
	return {
		subject: `Ticket #${ticketId} Created - ${category}`,
		html: `
			<!DOCTYPE html>
			<html>
			<head>
				<style>
					body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
					.container { max-width: 600px; margin: 0 auto; padding: 20px; }
					.header { background-color: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
					.content { background-color: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
					.ticket-info { background-color: white; padding: 15px; margin: 15px 0; border-radius: 5px; border-left: 4px solid #4F46E5; }
					.footer { text-align: center; padding: 20px; color: #6b7280; font-size: 12px; }
				</style>
			</head>
			<body>
				<div class="container">
					<div class="header">
						<h1>🎫 Ticket Created</h1>
					</div>
					<div class="content">
						<p>Your ticket has been successfully created via WhatsApp!</p>
						<div class="ticket-info">
							<p><strong>Ticket ID:</strong> #${ticketId}</p>
							<p><strong>Category:</strong> ${escapeHtml(category)}</p>
							<p><strong>Subcategory:</strong> ${escapeHtml(subcategory)}</p>
							${description ? `<p><strong>Description:</strong> ${escapeHtml(description)}</p>` : ""}
							<p><strong>Status:</strong> Open</p>
						</div>
						<p>We'll keep you updated on the progress of your ticket.</p>
					</div>
					<div class="footer">
						<p>This is an automated email from SST Resolve</p>
					</div>
				</div>
			</body>
			</html>
		`,
	};
}

