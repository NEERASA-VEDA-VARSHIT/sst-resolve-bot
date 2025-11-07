import twilio from "twilio";
import "dotenv/config";

const accountSid = process.env.TWILIO_ACCOUNT_SID as string;
const authToken = process.env.TWILIO_AUTH_TOKEN as string;
const fromNumber = process.env.TWILIO_WHATSAPP_FROM as string; // e.g. 'whatsapp:+14155238886'

const client = twilio(accountSid, authToken);

export async function sendText(to: string, text: string) {
  const toWhatsApp = to.startsWith("whatsapp:") ? to : `whatsapp:${to}`;
  await client.messages.create({
    from: fromNumber,
    to: toWhatsApp,
    body: text,
  });
}


