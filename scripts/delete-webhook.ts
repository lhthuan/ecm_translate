import "dotenv/config";
import { deleteWebhook } from "../lib/zalo";

deleteWebhook()
  .then((result) => console.log("Webhook deleted:", result))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
