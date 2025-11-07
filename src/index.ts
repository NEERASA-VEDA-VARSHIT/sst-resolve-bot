import "dotenv/config";
import express from "express";
import type { Request, Response } from "express";
import { db } from "./db/client.ts";
import { students } from "./db/students.ts";
import { eq } from "drizzle-orm";
import { sendText } from "./utils/whatsapp.ts";
import { CATEGORY_TREE } from "./categories.ts";
import { tickets } from "./db/schema.ts";
import { SLACK_CHANNELS } from "./config/slackMapping.ts";
import { postToSlackChannel } from "./utils/slack.ts";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN as string;

// Twilio uses a POST webhook; GET verify not required

// In-memory step tracker for registration flow
const userSteps = new Map<string, string>();

type SessionStep =
  | "main"
  | "hostel_location"
  | "hostel_issue_type"
  | "hostel_mess_meal"
  | "hostel_mess_date"
  | "hostel_mess_desc"
  | "hostel_leave_dates"
  | "hostel_leave_reason"
  | "hostel_leave_confirm"
  | "hostel_maint_type"
  | "hostel_maint_desc"
  | "hostel_wifi_type"
  | "hostel_wifi_desc"
  | "hostel_room_current"
  | "hostel_room_desired"
  | "hostel_room_reason"
  | "college_location"
  | "college_issue_type"
  | "college_mess_meal"
  | "college_mess_date"
  | "college_mess_desc"
  | "college_maint_desc";

type SessionData = {
  main_category?: "Hostel" | "College";
  location?: string;
  sub_category?: string;
  issue_description?: string;
  details?: Record<string, any>;
};

const sessions = new Map<string, { step: SessionStep; data: SessionData }>();

function normalizeSubcategoryLabel(main: string | undefined, sub: string | undefined): string {
	if (!sub) return "Other";
	if (sub === "Mess") return "Mess Quality Issues";
	if (sub === "Wi‑Fi" || sub === "Wi-Fi") return "Wi-Fi Issues";
	if (sub === "Maintenance") return "Maintenance / Housekeeping";
	if (sub === "Room Change") return "Room Change Request";
	if (sub === "Leave") return "Leave Application";
	return sub;
}

async function saveTicket(number: string, data: SessionData) {
	const desc = data.issue_description || undefined;
	const subLabel = normalizeSubcategoryLabel(data.main_category, data.sub_category);
	
	// Parse existing details
	let ticketDetails: any = data.details || {};
	
	const [newTicket] = await db
		.insert(tickets)
		.values({
			userNumber: number,
			category: data.main_category || "",
			subcategory: subLabel,
			description: desc || null,
			location: data.location || null,
			details: Object.keys(ticketDetails).length > 0 ? JSON.stringify(ticketDetails) : null,
		})
		.returning();

	// Post to Slack channel based on main category (Hostel or College)
	if (data.main_category && SLACK_CHANNELS[data.main_category] && newTicket) {
		const header = "🆕 New Ticket Raised (via WhatsApp)";
		const body = [
			`*Ticket ID:* #${newTicket.id}`,
			`Category: ${data.main_category} → ${subLabel}`,
			data.location ? `Location: ${data.location}` : undefined,
			`Student: ${number}`,
			desc ? `Description: ${desc}` : undefined,
			`Status: Open`,
		]
			.filter(Boolean)
			.join("\n");
		
		const messageTs = await postToSlackChannel(SLACK_CHANNELS[data.main_category], `${header}\n${body}`, newTicket.id);
		
		// Store Slack message timestamp in ticket details
		if (messageTs) {
			ticketDetails.slackMessageTs = messageTs;
			await db
				.update(tickets)
				.set({ details: JSON.stringify(ticketDetails) })
				.where(eq(tickets.id, newTicket.id));
		}

		// Send email notification to student
		try {
			const { getStudentEmail, sendEmail, getTicketCreatedEmail } = await import("./utils/email.js");
			const studentEmail = await getStudentEmail(newTicket.userNumber);
			if (studentEmail) {
				const emailTemplate = getTicketCreatedEmail(
					newTicket.id,
					newTicket.category,
					subLabel,
					desc
				);
				await sendEmail(
					studentEmail,
					emailTemplate.subject,
					emailTemplate.html
				);
			}
		} catch (emailError) {
			console.error("Error sending ticket creation email:", emailError);
			// Don't fail the request if email fails
		}
	}
}

function sendMainMenu(to: string) {
	sessions.set(to, { step: "main", data: {} });
	return sendText(
		to,
		"Welcome to SST Resolve\nPlease select a category:\n1) Hostel\n2) College"
	);
}

function sendHostelLocation(to: string) {
	sessions.set(to, { step: "hostel_location", data: { main_category: "Hostel" } });
	return sendText(to, "Choose your hostel:\n1) Neeladri\n2) Velankani");
}

function sendHostelIssueTypes(to: string, data: SessionData) {
	sessions.set(to, { step: "hostel_issue_type", data });
	return sendText(
		to,
		"Choose an issue type:\n1) Mess Quality Issues\n2) Leave Application\n3) Maintenance / Housekeeping\n4) Wi‑Fi Issues\n5) Room Change Request\n6) Other"
	);
}

function sendCollegeIssueTypes(to: string, data: SessionData) {
	sessions.set(to, { step: "college_issue_type", data: { ...data, main_category: data.main_category || "College" } });
	return sendText(
		to,
		"Choose an issue type:\n1) Mess Quality Issues\n2) Maintenance / Housekeeping\n3) Wi‑Fi Issues\n4) Other"
	);
}

function sendCollegeMessLocation(to: string, data: SessionData) {
	sessions.set(to, { step: "college_mess_location", data });
	return sendText(to, "Choose your college:\n1) GSR\n2) Uniworld\n3) TCB");
}

async function getStudentByNumber(number: string) {
  const result = await db
    .select()
    .from(students)
    .where(eq(students.userNumber, number));
  return result[0];
}

async function saveStudent(
  number: string,
  data: Partial<typeof students.$inferInsert>
) {
  await db
    .insert(students)
    .values({ userNumber: number, ...data })
    .onConflictDoUpdate({ target: students.userNumber, set: data });
}

async function handleStudentRegistration(to: string, text: string) {
  const step = userSteps.get(to);

  if (!step) {
    userSteps.set(to, "name");
    await sendText(
      to,
      "👋 Welcome to SST Resolve! Please enter your full name:"
    );
    return;
  }

  if (step === "name") {
    await saveStudent(to, { fullName: text });
    userSteps.set(to, "room");
    await sendText(to, "🏠 Please enter your room number:");
    return;
  }

  if (step === "room") {
    await saveStudent(to, { roomNumber: text });
    userSteps.set(to, "mobile");
    await sendText(to, "📞 Please enter your mobile number:");
    return;
  }

  if (step === "mobile") {
    await saveStudent(to, { mobile: text });
    userSteps.set(to, "hostel");
		await sendText(
			to,
			`Select your hostel:\n1) Neeladri\n2) Velankani\n3) None / Day Scholar`
		);
    return;
  }

  if (step === "hostel") {
    let hostelName = "NA";
		const n = parseInt(text.trim(), 10);
		if (n === 1 || text.toLowerCase().includes("neeladri")) hostelName = "Neeladri";
		else if (n === 2 || text.toLowerCase().includes("velankani")) hostelName = "Velankani";

    await saveStudent(to, { hostel: hostelName });
    userSteps.delete(to);
    await sendText(
      to,
      "✅ Details saved! You won’t need to fill them again."
    );
		await sendMainMenu(to);
    return;
  }
}

// ✅ 2️⃣ RECEIVE MESSAGES (POST) - Twilio webhook
app.post("/webhook", async (req: Request, res: Response) => {
  try {
		const from = (req.body.From as string) || ""; // e.g. 'whatsapp:+91...'
		const text = ((req.body.Body as string) || "").trim();

      if (!from || !text) return res.sendStatus(200);

		const number = from.replace(/^whatsapp:/, "");
		const student = await getStudentByNumber(number);

      if (!student) {
			await handleStudentRegistration(number, text);
        return res.sendStatus(200);
      }

      if (text.toLowerCase() === "hi" || text.toLowerCase() === "hello") {
			await sendMainMenu(number);
        return res.sendStatus(200);
      }

		const current = sessions.get(number);
		const n = parseInt(text.trim(), 10);

		if (!current) {
			// Expecting main menu
			if (n === 1) {
				await sendHostelLocation(number);
				return res.sendStatus(200);
			}
			if (n === 2) {
				await sendCollegeIssueTypes(number, { main_category: "College" });
				return res.sendStatus(200);
			}
			await sendMainMenu(number);
			return res.sendStatus(200);
		}

		const data = current.data || {};
		switch (current.step) {
			case "main": {
				if (n === 1) return void sendHostelLocation(number), res.sendStatus(200);
				if (n === 2) return void sendCollegeIssueTypes(number, { main_category: "College" }), res.sendStatus(200);
				await sendMainMenu(number);
				return res.sendStatus(200);
			}
			case "hostel_location": {
				if (n === 1) data.location = "Neeladri";
				else if (n === 2) data.location = "Velankani";
				else return void sendHostelLocation(number), res.sendStatus(200);
				return void sendHostelIssueTypes(number, data), res.sendStatus(200);
			}
			case "hostel_issue_type": {
				if (n === 1) {
					data.sub_category = "Mess";
					sessions.set(number, { step: "hostel_mess_meal", data });
					await sendText(number, "Select meal:\n1) Breakfast\n2) Lunch\n3) Dinner");
					return res.sendStatus(200);
				}
				if (n === 2) {
					data.sub_category = "Leave";
					sessions.set(number, { step: "hostel_leave_dates", data });
					await sendText(number, "Enter leave date(s) (e.g., 2025-11-04 to 2025-11-06):");
					return res.sendStatus(200);
				}
				if (n === 3) {
					data.sub_category = "Maintenance";
					sessions.set(number, { step: "hostel_maint_type", data });
					await sendText(number, "Select maintenance type:\n1) Plumbing\n2) Electrical\n3) Painting\n4) Carpenter\n5) Pantry Area");
					return res.sendStatus(200);
				}
				if (n === 4) {
					data.sub_category = "Wi‑Fi";
					sessions.set(number, { step: "hostel_wifi_type", data });
					await sendText(number, "Choose the Wi‑Fi issue:\n1) Internet not working\n2) Router problems");
					return res.sendStatus(200);
				}
				if (n === 5) {
					data.sub_category = "Room Change";
					sessions.set(number, { step: "hostel_room_current", data });
					await sendText(number, "Enter your current room:");
					return res.sendStatus(200);
				}
				if (n === 6) {
					data.sub_category = "Other";
					sessions.set(number, { step: "hostel_mess_desc", data });
					await sendText(number, "Please describe your issue:");
					return res.sendStatus(200);
				}
				return void sendHostelIssueTypes(number, data), res.sendStatus(200);
			}
			case "hostel_mess_meal": {
				data.details = { ...(data.details || {}) };
				if (n === 1) data.details.meal = "Breakfast";
				else if (n === 2) data.details.meal = "Lunch";
				else if (n === 3) data.details.meal = "Dinner";
				else return void sendText(number, "Please select 1, 2, or 3."), res.sendStatus(200);
				sessions.set(number, { step: "hostel_mess_date", data });
				await sendText(number, "Please enter the date (YYYY-MM-DD):");
				return res.sendStatus(200);
			}
			case "hostel_mess_date": {
				data.details = { ...(data.details || {}), date: text.trim() };
				sessions.set(number, { step: "hostel_mess_desc", data });
				await sendText(number, "Please describe the issue:");
				return res.sendStatus(200);
			}
			case "hostel_mess_desc": {
				data.issue_description = text.trim();
				await saveTicket(number, { ...data, main_category: data.main_category || "Hostel" });
				sessions.delete(number);
				await sendText(number, "✅ Your ticket has been created. We’ll update you here.");
				return res.sendStatus(200);
			}
			case "hostel_leave_dates": {
				data.details = { ...(data.details || {}), leave_dates: text.trim() };
				sessions.set(number, { step: "hostel_leave_reason", data });
				await sendText(number, "Enter the reason for leave:");
				return res.sendStatus(200);
			}
			case "hostel_leave_reason": {
				data.details = { ...(data.details || {}), reason: text.trim() };
				sessions.set(number, { step: "hostel_leave_confirm", data });
				await sendText(number, "Send for approval? (yes/no)");
				return res.sendStatus(200);
			}
			case "hostel_leave_confirm": {
				data.details = { ...(data.details || {}), approval_request: /^y/i.test(text.trim()) };
				data.issue_description = `Leave request: ${data.details.leave_dates} - ${data.details.reason}`;
				await saveTicket(number, { ...data, main_category: data.main_category || "Hostel" });
				sessions.delete(number);
				await sendText(number, "✅ Your ticket has been created. We’ll update you here.");
				return res.sendStatus(200);
			}
			case "hostel_maint_type": {
				data.details = { ...(data.details || {}) };
				if (n === 1) data.details.maintenance_type = "Plumbing";
				else if (n === 2) data.details.maintenance_type = "Electrical";
				else if (n === 3) data.details.maintenance_type = "Painting";
				else if (n === 4) data.details.maintenance_type = "Carpenter";
				else if (n === 5) data.details.maintenance_type = "Pantry Area";
				else return void sendText(number, "Select 1-5."), res.sendStatus(200);
				sessions.set(number, { step: "hostel_maint_desc", data });
				await sendText(number, "Please describe the problem:");
				return res.sendStatus(200);
			}
			case "hostel_maint_desc": {
				data.issue_description = text.trim();
				await saveTicket(number, { ...data, main_category: data.main_category || "Hostel" });
				sessions.delete(number);
				await sendText(number, "✅ Your ticket has been created. We’ll update you here.");
				return res.sendStatus(200);
			}
			case "hostel_wifi_type": {
				data.details = { ...(data.details || {}) };
				if (n === 1) data.details.wifi_issue = "Internet not working";
				else if (n === 2) data.details.wifi_issue = "Router problems";
				else return void sendText(number, "Select 1 or 2."), res.sendStatus(200);
				sessions.set(number, { step: "hostel_wifi_desc", data });
				await sendText(number, "Describe the problem (any error lights/messages):");
				return res.sendStatus(200);
			}
			case "hostel_wifi_desc": {
				data.issue_description = text.trim();
				await saveTicket(number, { ...data, main_category: data.main_category || "Hostel" });
				sessions.delete(number);
				await sendText(number, "✅ Your ticket has been created. We’ll update you here.");
				return res.sendStatus(200);
			}
			case "hostel_room_current": {
				data.details = { ...(data.details || {}), current_room: text.trim() };
				sessions.set(number, { step: "hostel_room_desired", data });
				await sendText(number, "Enter desired room:");
				return res.sendStatus(200);
			}
			case "hostel_room_desired": {
				data.details = { ...(data.details || {}), desired_room: text.trim() };
				sessions.set(number, { step: "hostel_room_reason", data });
				await sendText(number, "Reason for change:");
				return res.sendStatus(200);
			}
			case "hostel_room_reason": {
				data.issue_description = text.trim();
				await saveTicket(number, { ...data, main_category: data.main_category || "Hostel" });
				sessions.delete(number);
				await sendText(number, "✅ Your ticket has been created. We’ll update you here.");
				return res.sendStatus(200);
			}
			case "college_issue_type": {
				if (n === 1) {
					data.sub_category = "Mess";
					return void sendCollegeMessLocation(number, data), res.sendStatus(200);
				}
				if (n === 2) {
					data.sub_category = "Maintenance";
					sessions.set(number, { step: "college_maint_desc", data });
					await sendText(number, "Please describe the maintenance/housekeeping issue:");
					return res.sendStatus(200);
				}
				if (n === 3) {
					data.sub_category = "Wi‑Fi";
					sessions.set(number, { step: "hostel_wifi_type", data });
					await sendText(number, "Choose the Wi‑Fi issue:\n1) Internet not working\n2) Router problems");
					return res.sendStatus(200);
				}
				if (n === 4) {
					data.sub_category = "Other";
					sessions.set(number, { step: "hostel_mess_desc", data });
					await sendText(number, "Please describe your issue:");
					return res.sendStatus(200);
				}
				return void sendCollegeIssueTypes(number, data), res.sendStatus(200);
			}
			case "college_mess_location": {
				if (n === 1) data.location = "GSR";
				else if (n === 2) data.location = "Uniworld";
				else if (n === 3) data.location = "TCB";
				else return void sendCollegeMessLocation(number, data), res.sendStatus(200);
				sessions.set(number, { step: "college_mess_meal", data });
				await sendText(number, "Select meal:\n1) Breakfast\n2) Lunch\n3) Dinner");
				return res.sendStatus(200);
			}
			case "college_mess_meal": {
				data.details = { ...(data.details || {}) };
				if (n === 1) data.details.meal = "Breakfast";
				else if (n === 2) data.details.meal = "Lunch";
				else if (n === 3) data.details.meal = "Dinner";
				else return void sendText(number, "Please select 1, 2, or 3."), res.sendStatus(200);
				sessions.set(number, { step: "college_mess_date", data });
				await sendText(number, "Please enter the date (YYYY-MM-DD):");
				return res.sendStatus(200);
			}
			case "college_mess_date": {
				data.details = { ...(data.details || {}), date: text.trim() };
				sessions.set(number, { step: "college_mess_desc", data });
				await sendText(number, "Please describe the issue:");
				return res.sendStatus(200);
			}
			case "college_mess_desc": {
				data.issue_description = text.trim();
				await saveTicket(number, { ...data, main_category: data.main_category || "College" });
				sessions.delete(number);
				await sendText(number, "✅ Your ticket has been created. We’ll update you here.");
				return res.sendStatus(200);
			}
			case "college_maint_desc": {
				data.issue_description = text.trim();
				await saveTicket(number, { ...data, main_category: data.main_category || "College" });
				sessions.delete(number);
				await sendText(number, "✅ Your ticket has been created. We’ll update you here.");
				return res.sendStatus(200);
			}
			default: {
				await sendMainMenu(number);
				return res.sendStatus(200);
			}
    }
  } catch (error) {
    console.error("❌ Error handling message:", error);
    res.sendStatus(500);
  }
});

// ✅ 3️⃣ SEND CATEGORY LIST (text-based)
async function sendCategoryList(to: string) {
  await sendText(
    to,
    "Welcome to SST Resolve\nPlease select a category:\n1) Hostel\n2) College"
  );
}

app.listen(3000, () => console.log("🚀 Webhook running on port 3000"));
