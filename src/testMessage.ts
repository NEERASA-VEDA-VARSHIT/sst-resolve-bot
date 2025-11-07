import axios from "axios";
import "dotenv/config";

const url = "https://graph.facebook.com/v22.0/803694529502636/messages";
const token = process.env.ACCESS_TOKEN!;

async function sendTemplate() {
  try {
    const response = await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to: "919391541081",
        type: "template",
        template: {
          name: "hello_world",
          language: { code: "en_US" },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Sent successfully:", response.data);
  } catch (error: any) {
    console.error("❌ Error:", error.response?.data || error.message);
  }
}

sendTemplate();
