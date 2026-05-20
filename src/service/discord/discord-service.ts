const WEBHOOK_URL =
  process.env.DISCORD_SUB_WEBHOOK_URL ||
  "https://discord.com/api/webhooks/1470428922435862635/s0HLIuh-Cc3aa4oSz40xibdD4XoLmap89BapEZVMfRRgLoTzlObSiBqTf929nImLWLvo";

export async function sendDiscordMessage(text: string) {
  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
  } catch (err) {
    console.error("Discord error:", err);
  }
}
