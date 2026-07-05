import "dotenv/config";
import { getWebhookInfo } from "../lib/zalo";

getWebhookInfo()
  .then((result) => console.log("Webhook info:", result))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
