import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { z } from "zod";
import { logError, logEvent } from "./log.js";
import { estimateImageCost, estimateVisionCost, type TokenUsage } from "./pricing.js";
import type { OutfitResult } from "./types.js";

const analysisSchema = z.object({
  pieces: z
    .array(
      z.object({
        label: z.string().min(1),
        description: z.string().min(1),
        category: z.enum([
          "top",
          "bottom",
          "dress",
          "outerwear",
          "footwear",
          "bag",
          "accessory",
          "other",
        ]),
      }),
    )
    .min(1)
    .max(8),
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
          category: {
            type: "string",
            enum: ["top", "bottom", "dress", "outerwear", "footwear", "bag", "accessory", "other"],
          },
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
  private readonly inputMaxDimension: number;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) throw new Error("OPENAI_API_KEY is required");
    this.client = new OpenAI({ apiKey });
    this.visionModel = process.env.OPENAI_VISION_MODEL ?? "gpt-4.1-mini";
    this.imageModel = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2";
    this.inputMaxDimension = Number(process.env.INPUT_MAX_DIMENSION ?? 1280);
  }

  async transform(
    buffer: Buffer,
    mimeType: string,
    context?: { requestId: string },
  ): Promise<OutfitResult> {
    const requestId = context?.requestId ?? "untracked";
    const transformStartedAt = Date.now();
    const resizeStartedAt = Date.now();
    const inputMetadata = await sharp(buffer).metadata();
    logEvent("image_resize_started", {
      requestId,
      inputBytes: buffer.length,
      inputWidth: inputMetadata.width,
      inputHeight: inputMetadata.height,
      maxDimension: this.inputMaxDimension,
    });
    const normalized = await sharp(buffer)
      .rotate()
      .resize({
        width: this.inputMaxDimension,
        height: this.inputMaxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    const normalizedMetadata = await sharp(normalized).metadata();
    logEvent("image_resize_completed", {
      requestId,
      outputBytes: normalized.length,
      outputWidth: normalizedMetadata.width,
      outputHeight: normalizedMetadata.height,
    });
    const resizeDuration = Date.now() - resizeStartedAt;
    const dataUrl = `data:image/jpeg;base64,${normalized.toString("base64")}`;
    const analysisStartedAt = Date.now();
    logEvent("openai_analysis_sent", { requestId, model: this.visionModel, detail: "high" });
    logEvent("openai_analysis_waiting", { requestId });
    const analysis = await this.client.responses.create({
      model: this.visionModel,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: SYSTEM_PROMPT },
            { type: "input_image", image_url: dataUrl, detail: "high" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "outfit_analysis",
          strict: true,
          schema: responseSchema,
        },
      },
    });
    const parsed = analysisSchema.parse(JSON.parse(analysis.output_text));
    const analysisDuration = Date.now() - analysisStartedAt;
    logEvent("openai_analysis_completed", {
      requestId,
      pieces: parsed.pieces.length,
      durationMs: analysisDuration,
    });
    const source = await toFile(normalized, "mirror-selfie.jpg", {
      type: mimeType || "image/jpeg",
    });
    const imageTimings: Array<{ output: string; duration: number }> = [];
    const imageUsages: TokenUsage[] = [];
    const edit = async (prompt: string, output: string, size: string) => {
      const startedAt = Date.now();
      logEvent("openai_image_sent", {
        requestId,
        output,
        model: this.imageModel,
        size,
        quality: "low",
      });
      logEvent("openai_image_waiting", { requestId, output });
      try {
        const result = await this.client.images.edit({
          model: this.imageModel,
          image: source,
          prompt,
          size: size as "1024x1024",
          quality: "low",
          output_format: "jpeg",
        });
        const image = result.data?.[0]?.b64_json;
        if (!image) throw new Error("OpenAI returned no generated image");
        const duration = Date.now() - startedAt;
        imageTimings.push({ output, duration });
        const usage = (
          result as typeof result & {
            usage?: {
              input_tokens: number;
              output_tokens: number;
              input_tokens_details?: { image_tokens?: number; text_tokens?: number };
            };
          }
        ).usage;
        if (usage)
          imageUsages.push({
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            imageInputTokens: usage.input_tokens_details?.image_tokens,
            textInputTokens: usage.input_tokens_details?.text_tokens,
          });
        logEvent("openai_image_completed", {
          requestId,
          output,
          durationMs: duration,
          inputTokens: usage?.input_tokens,
          outputTokens: usage?.output_tokens,
        });
        return `data:image/jpeg;base64,${image}`;
      } catch (error) {
        logError("openai_image_failed", {
          requestId,
          output,
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : "Unexpected error",
        });
        throw error;
      }
    };

    const generationStartedAt = Date.now();
    logEvent("openai_generation_batch_started", { requestId, images: parsed.pieces.length + 1 });
    const [styledOutfit, ...pieceImages] = await Promise.all([
      edit(STYLE_PROMPT, "complete_outfit", "1024x1024"),
      ...parsed.pieces.map((piece, index) =>
        edit(
          `Isolate exactly this outfit piece from the uploaded selfie: ${piece.label} — ${piece.description}. Show only this single item, laid flat or on an invisible form, with no person, body parts, hanger, phone, room, other garments, or text. Preserve its exact color, material, pattern, cut, and details. Centered premium stylized product photography on a warm off-white seamless background with a soft natural shadow.`,
          `piece_${index + 1}_${piece.category}`,
          "816x816",
        ),
      ),
    ]);
    const generationDuration = Date.now() - generationStartedAt;
    logEvent("openai_generation_batch_completed", {
      requestId,
      images: pieceImages.length + 1,
      durationMs: generationDuration,
    });

    const analysisUsage = {
      inputTokens: analysis.usage?.input_tokens ?? 0,
      outputTokens: analysis.usage?.output_tokens ?? 0,
      totalTokens: analysis.usage?.total_tokens ?? 0,
    };
    const generationUsage = imageUsages.reduce<{
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>(
      (total, usage) => ({
        inputTokens: total.inputTokens + usage.inputTokens,
        outputTokens: total.outputTokens + usage.outputTokens,
        totalTokens: total.totalTokens + usage.inputTokens + usage.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    );
    const imageCount = pieceImages.length + 1;
    const hasCompleteImageUsage = imageUsages.length === imageCount;
    const imageCosts = hasCompleteImageUsage
      ? imageUsages.map((usage) => estimateImageCost(usage))
      : [
          estimateImageCost(undefined, "1024x1024"),
          ...pieceImages.map(() => estimateImageCost(undefined, "816x816")),
        ];
    const analysisCost = estimateVisionCost(this.visionModel, analysisUsage);
    const generationCost = imageCosts.reduce((sum, cost) => sum + cost.usd, 0);

    return {
      styledOutfit,
      pieces: parsed.pieces.map((piece, index) => ({
        id: `${piece.category}-${index + 1}`,
        ...piece,
        image: pieceImages[index]!,
      })),
      debug: {
        requestId,
        models: { vision: this.visionModel, image: this.imageModel },
        input: {
          originalBytes: buffer.length,
          originalWidth: inputMetadata.width,
          originalHeight: inputMetadata.height,
          normalizedBytes: normalized.length,
          normalizedWidth: normalizedMetadata.width,
          normalizedHeight: normalizedMetadata.height,
          mimeType,
        },
        output: {
          count: imageCount,
          fullOutfitSize: "1024x1024",
          pieceSize: "816x816",
          quality: "low",
          format: "jpeg",
        },
        timingMs: {
          resize: resizeDuration,
          analysis: analysisDuration,
          generation: generationDuration,
          total: Date.now() - transformStartedAt,
          images: imageTimings.sort((a, b) => a.output.localeCompare(b.output)),
        },
        usage: {
          analysis: analysisUsage,
          generation: { available: hasCompleteImageUsage, ...generationUsage },
        },
        cost: {
          currency: "USD",
          estimatedTotal: (analysisCost ?? 0) + generationCost,
          analysis: analysisCost,
          generation: generationCost,
          includesImageInputTokens: imageCosts.every((cost) => cost.includesInput),
          note: hasCompleteImageUsage
            ? "Estimate from API token usage and standard prices."
            : "Image-edit token usage was unavailable; generation uses a pixel-scaled low-quality output estimate and excludes image-edit input tokens.",
        },
      },
    };
  }
}
