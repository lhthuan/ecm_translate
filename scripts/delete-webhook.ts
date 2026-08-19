import "dotenv/config";
import { deleteWebhook } from "../src/lib/zalo";

const token = process.env.ZALO_BOT_TOKEN;
if (!token) {
  throw new Error("Missing ZALO_BOT_TOKEN in .env");
}

deleteWebhook(token)
  .then((result) => console.log("Webhook deleted:", result))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
