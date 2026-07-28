import { createApp } from "./app.js";
import { OpenAIOutfitService } from "./openai-service.js";

const port = Number(process.env.PORT ?? 3000);
const app = createApp(new OpenAIOutfitService());
app.listen(port, "0.0.0.0", () => console.log(`Fashion Canvas listening on port ${port}`));
