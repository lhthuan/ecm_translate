import "dotenv/config";
import { setWebhook } from "../lib/zalo";

async function main() {
  const url = process.env.PUBLIC_WEBHOOK_URL;
  const secretToken = process.env.ZALO_WEBHOOK_SECRET_TOKEN;
  if (!url || !secretToken) {
    throw new Error("Missing PUBLIC_WEBHOOK_URL or ZALO_WEBHOOK_SECRET_TOKEN in .env");
  }
  const result = await setWebhook(url, secretToken);
  console.log("Webhook set:", result);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
