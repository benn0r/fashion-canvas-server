import { createApp } from "./app.js";
import { OpenAIOutfitService } from "./openai-service.js";
import { logEvent } from "./log.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp(new OpenAIOutfitService());
app.listen(port, "0.0.0.0", () => logEvent("server_started", { port }));
