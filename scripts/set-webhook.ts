import "dotenv/config";
import { setWebhook } from "../src/lib/zalo";

async function main() {
  const token = process.env.ZALO_BOT_TOKEN;
  const url = process.env.PUBLIC_WEBHOOK_URL;
  const secretToken = process.env.ZALO_WEBHOOK_SECRET_TOKEN;
  if (!token || !url || !secretToken) {
    throw new Error("Missing ZALO_BOT_TOKEN, PUBLIC_WEBHOOK_URL or ZALO_WEBHOOK_SECRET_TOKEN in .env");
  }
  const result = await setWebhook(token, url, secretToken);
  console.log("Webhook set:", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
