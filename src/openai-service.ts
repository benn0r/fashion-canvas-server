import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { z } from "zod";
import type { OutfitResult } from "./types.js";

const analysisSchema = z.object({
  pieces: z.array(z.object({
    label: z.string().min(1),
    description: z.string().min(1),
    category: z.enum(["top", "bottom", "dress", "outerwear", "footwear", "bag", "accessory", "other"]),
  })).min(1).max(8),
});

const SYSTEM_PROMPT = `You are a fashion catalog art director. Inspect the mirror selfie and identify only clearly visible wearable outfit pieces. Ignore the person, body, face, phone, room, and reflections. Use concise labels and precise visual descriptions including color, material, silhouette, pattern, and distinguishing details. Do not infer hidden garments or brands.`;

const STYLE_PROMPT = `Create a polished editorial fashion catalog image based on the uploaded mirror selfie. Show only the complete outfit and its visible worn accessories, arranged naturally on an invisible mannequin with no human body, skin, face, hair, phone, mirror, or room. Preserve the exact colors, patterns, materials, proportions, layering, and garment details. Centered composition on a warm off-white seamless studio background, soft realistic shadows, premium stylized product photography, no text, no logos added.`;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    pieces: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          description: { type: "string" },
          category: { type: "string", enum: ["top", "bottom", "dress", "outerwear", "footwear", "bag", "accessory", "other"] },
        },
        required: ["label", "description", "category"],
      },
    },
  },
  required: ["pieces"],
};

export class OpenAIOutfitService {
  private readonly client: OpenAI;
  private readonly visionModel: string;
  private readonly imageModel: string;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required");
    this.client = new OpenAI({ apiKey });
    this.visionModel = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";
    this.imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
  }

  async transform(buffer: Buffer, mimeType: string): Promise<OutfitResult> {
    const normalized = await sharp(buffer).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const dataUrl = `data:image/jpeg;base64,${normalized.toString("base64")}`;
    const analysis = await this.client.responses.create({
      model: this.visionModel,
      input: [{ role: "user", content: [{ type: "input_text", text: SYSTEM_PROMPT }, { type: "input_image", image_url: dataUrl, detail: "high" }] }],
      text: { format: { type: "json_schema", name: "outfit_analysis", strict: true, schema: responseSchema } },
    });
    const parsed = analysisSchema.parse(JSON.parse(analysis.output_text));
    const source = await toFile(normalized, "mirror-selfie.jpg", { type: mimeType || "image/jpeg" });
    const edit = async (prompt: string) => {
      const result = await this.client.images.edit({ model: this.imageModel, image: source, prompt, size: "1024x1024", quality: "medium", output_format: "jpeg" });
      const image = result.data?.[0]?.b64_json;
      if (!image) throw new Error("OpenAI returned no generated image");
      return `data:image/jpeg;base64,${image}`;
    };

    const [styledOutfit, ...pieceImages] = await Promise.all([
      edit(STYLE_PROMPT),
      ...parsed.pieces.map((piece) => edit(`Isolate exactly this outfit piece from the uploaded selfie: ${piece.label} — ${piece.description}. Show only this single item, laid flat or on an invisible form, with no person, body parts, hanger, phone, room, other garments, or text. Preserve its exact color, material, pattern, cut, and details. Centered premium stylized product photography on a warm off-white seamless background with a soft natural shadow.`)),
    ]);

    return {
      styledOutfit,
      pieces: parsed.pieces.map((piece, index) => ({ id: `${piece.category}-${index + 1}`, ...piece, image: pieceImages[index]! })),
    };
  }
}
