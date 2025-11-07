import { WebClient } from "@slack/web-api";

const slackToken = process.env.SLACK_BOT_TOKEN as string;
const slack = slackToken ? new WebClient(slackToken) : null;

export async function postToSlackChannel(channel: string, text: string, ticketId?: number): Promise<string | null> {
	if (!slack) {
		console.warn("SLACK_BOT_TOKEN not set; skipping Slack send.");
		return null;
	}

	const blocks = [
		{
			type: "section",
			text: {
				type: "mrkdwn",
				text: text,
			},
		},
	];

	// Add interactive buttons if ticket ID is provided
	if (ticketId) {
		blocks.push({
			type: "actions",
			elements: [
				{
					type: "button",
					text: {
						type: "plain_text",
						text: "🔄 Mark In Progress",
						emoji: true,
					},
					style: "primary",
					value: `in_progress_${ticketId}`,
					action_id: "ticket_in_progress",
				},
				{
					type: "button",
					text: {
						type: "plain_text",
						text: "⏱️ Update TAT",
						emoji: true,
					},
					value: `set_tat_${ticketId}`,
					action_id: "ticket_set_tat",
				},
				{
					type: "button",
					text: {
						type: "plain_text",
						text: "💬 Add Comment",
						emoji: true,
					},
					value: `add_comment_${ticketId}`,
					action_id: "ticket_add_comment",
				},
				{
					type: "button",
					text: {
						type: "plain_text",
						text: "✅ Close Ticket",
						emoji: true,
					},
					style: "danger",
					value: `close_${ticketId}`,
					action_id: "ticket_close",
				},
			],
		} as any);
	}

	try {
		const result = await slack.chat.postMessage({
			channel,
			text,
			blocks,
		});
		return result.ts || null;
	} catch (error) {
		console.error("Error posting to Slack:", error);
		return null;
	}
}
