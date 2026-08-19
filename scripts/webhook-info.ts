import "dotenv/config";
import { getWebhookInfo } from "../src/lib/zalo";

const token = process.env.ZALO_BOT_TOKEN;
if (!token) {
  throw new Error("Missing ZALO_BOT_TOKEN in .env");
}

getWebhookInfo(token)
  .then((result) => console.log("Webhook info:", result))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
