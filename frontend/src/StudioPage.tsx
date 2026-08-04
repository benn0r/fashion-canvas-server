import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AdminHeader, Footer } from "./AdminHeader";
import { errorMessage, formatBytes } from "./api";
import type { OutfitResult } from "./types";

type Crop = { left: number; right: number; top: number; bottom: number };
const emptyCrop: Crop = { left: 0, right: 0, top: 0, bottom: 0 };

export function StudioPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(null);
  const [crop, setCrop] = useState<Crop>(emptyCrop);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<OutfitResult | null>(null);
  const cropCanvas = useRef<HTMLCanvasElement>(null);
  const cropImage = useRef<HTMLImageElement>(null);
  const session = useMemo(readSession, []);

  const rect = useMemo(() => (sourceSize ? cropRect(sourceSize, crop) : null), [sourceSize, crop]);
  useEffect(() => {
    if (!cropImage.current || !rect || !cropCanvas.current) return;
    drawImage(cropCanvas.current, cropImage.current, rect, 900);
  }, [rect]);
  function selectFile(selected: File) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(selected);
    setFile(selected);
    setPreviewUrl(url);
    setCrop(emptyCrop);
    const image = new Image();
    let loaded = false;
    image.onload = () => {
      loaded = true;
      cropImage.current = image;
      setSourceSize({ width: image.naturalWidth, height: image.naturalHeight });
      setMessage("");
    };
    image.onerror = () => {
      if (loaded) return;
      cropImage.current = null;
      setSourceSize(null);
      setMessage(
        "This format cannot be cropped in this browser; the original file will be uploaded.",
      );
    };
    image.src = url;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    setMessage("");
    setSubmitting(true);
    try {
      const body = new FormData();
      const cropped = cropImage.current && rect ? await croppedFile(cropImage.current, rect) : null;
      if (cropped) {
        body.set("photo", cropped.blob, "cropped-reference.jpg");
        setMessage(`Uploading cropped ${cropped.width}×${cropped.height} reference…`);
      } else body.set("photo", file);
      const response = await fetch("/api/outfits", {
        method: "POST",
        headers: session.token ? { Authorization: `Bearer ${session.token}` } : {},
        body,
      });
      const data = (await response.json()) as OutfitResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "Request failed");
      setResult(data);
      window.setTimeout(() =>
        document.querySelector("#results")?.scrollIntoView({ behavior: "smooth" }),
      );
    } catch (caught) {
      setMessage(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <AdminHeader active="studio" />
      <main>
        <section id="test-studio" className="test-studio">
          <div className="section-heading studio-heading">
            <p className="eyebrow">INTERNAL TOOLING</p>
            <h1>Test studio</h1>
            <p>Run a production-like extraction and inspect its diagnostics.</p>
          </div>
          <div className="workspace">
            <div className="session-notice" id="session-notice">
              {session.user ? (
                <>
                  Signed in as <strong>{session.user.username}</strong>
                  {session.user.approved ? "." : " · awaiting approval."}
                </>
              ) : (
                "Uploads require an approved user session supplied by the client application."
              )}
            </div>
            <form id="upload-form" onSubmit={submit}>
              <div className="form-heading">
                <span>New extraction</span>
                <small>JPEG, PNG, WebP or HEIC · max 12 MB</small>
              </div>
              <label id="dropzone" className={`dropzone ${previewUrl ? "has-image" : ""}`}>
                <input
                  id="photo"
                  name="photo"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  required
                  onChange={(event) => {
                    const selected = event.target.files?.[0];
                    if (selected) selectFile(selected);
                  }}
                />
                <div className="upload-icon">↥</div>
                <strong>Drop a test image</strong>
                <small>or click to browse</small>
                {previewUrl && <img id="preview" src={previewUrl} alt="Selected selfie preview" />}
              </label>
              {sourceSize && rect && (
                <section id="crop-editor" className="crop-editor">
                  <h3>Crop OpenAI reference</h3>
                  <p>
                    Trim empty mirror and room areas. The cropped JPEG—not the original—is uploaded.
                  </p>
                  <div className="crop-layout">
                    <canvas
                      ref={cropCanvas}
                      id="crop-preview"
                      aria-label="Cropped reference preview"
                    />
                    <div className="crop-controls">
                      {(["left", "right", "top", "bottom"] as const).map((side) => (
                        <label key={side}>
                          {side.charAt(0).toUpperCase() + side.slice(1)}{" "}
                          <input
                            data-crop={side}
                            type="range"
                            min="0"
                            max="40"
                            value={crop[side]}
                            onChange={(event) => {
                              const value = Number(event.currentTarget.value);
                              setCrop((current) => ({
                                ...current,
                                [side]: value,
                              }));
                            }}
                          />
                          <output>{crop[side]}%</output>
                        </label>
                      ))}
                    </div>
                  </div>
                  <p id="crop-meta" className="crop-meta">
                    {cropDescription(rect)}
                  </p>
                </section>
              )}
              <button id="submit" type="submit" disabled={submitting}>
                {submitting ? "Creating your canvas… " : "Create outfit canvas "}
                <span>→</span>
              </button>
              <p id="message" role="status">
                {message}
              </p>
            </form>
          </div>
        </section>
        <Results result={result} />
      </main>
      <Footer>Test studio</Footer>
    </>
  );
}

function Results({ result }: { result: OutfitResult | null }) {
  if (!result)
    return (
      <section id="results" className="results" hidden>
        <section className="diagnostics">
          <div>
            <p className="eyebrow">REQUEST DIAGNOSTICS</p>
            <h3>OpenAI usage &amp; cost</h3>
          </div>
        </section>
      </section>
    );
  const debug = result.debug;
  const diagnostics = debug
    ? [
        ["Estimated cost", `$${debug.cost.estimatedTotal.toFixed(4)} ${debug.cost.currency}`],
        ["Models", `${debug.models.vision} + ${debug.models.image}`],
        [
          "Output",
          `1 × ${debug.output.fullOutfitSize} + ${debug.output.count - 1} × ${debug.output.pieceSize} · ${debug.output.quality} ${debug.output.format}`,
        ],
        ["Total time", `${(debug.timingMs.total / 1000).toFixed(1)} s`],
        ["Analysis usage", `${debug.usage.analysis.totalTokens.toLocaleString()} tokens`],
        [
          "Generation usage",
          debug.usage.generation.available
            ? `${debug.usage.generation.totalTokens.toLocaleString()} tokens`
            : "Not returned by API",
        ],
        [
          "Input",
          `${debug.input.originalWidth}×${debug.input.originalHeight} · ${formatBytes(debug.input.originalBytes)}`,
        ],
        [
          "Normalized",
          `${debug.input.normalizedWidth}×${debug.input.normalizedHeight} · ${formatBytes(debug.input.normalizedBytes)}`,
        ],
        [
          "Timing",
          `resize ${debug.timingMs.resize} ms · analysis ${(debug.timingMs.analysis / 1000).toFixed(1)} s · images ${(debug.timingMs.generation / 1000).toFixed(1)} s`,
        ],
        ["Request ID", debug.requestId],
      ]
    : [];
  return (
    <section id="results" className="results">
      <div className="section-title">
        <div>
          <p className="eyebrow">THE RESULT</p>
          <h2>Your outfit, reimagined</h2>
        </div>
        <span id="piece-count">{result.pieces.length} PIECES EXTRACTED</span>
      </div>
      <div className="outfit-card">
        <img id="styled-outfit" src={result.styledOutfit} alt="Stylized complete outfit" />
        <div>
          <p className="eyebrow">COMPLETE LOOK</p>
          <h3>Editorial outfit canvas</h3>
          <p>
            A polished, person-free composition preserving the original layers, colors and details.
          </p>
        </div>
      </div>
      {debug && (
        <section className="diagnostics">
          <div>
            <p className="eyebrow">REQUEST DIAGNOSTICS</p>
            <h3>OpenAI usage &amp; cost</h3>
          </div>
          <div id="diagnostic-grid" className="diagnostic-grid">
            {diagnostics.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <p id="cost-note" className="cost-note">
            {debug.cost.note}
          </p>
        </section>
      )}
      <div id="pieces" className="piece-grid">
        {result.pieces.map((piece) => (
          <article className="piece" key={piece.id}>
            <img src={piece.image} alt={piece.label} />
            <div>
              <span className="tag">{piece.category}</span>
              <h3>{piece.label}</h3>
              <p>{piece.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function cropRect(source: { width: number; height: number }, crop: Crop) {
  return {
    x: Math.round((source.width * crop.left) / 100),
    y: Math.round((source.height * crop.top) / 100),
    width: Math.round(source.width * (1 - (crop.left + crop.right) / 100)),
    height: Math.round(source.height * (1 - (crop.top + crop.bottom) / 100)),
  };
}

function drawImage(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  rect: ReturnType<typeof cropRect>,
  maxDimension: number,
) {
  const scale = Math.min(1, maxDimension / Math.max(rect.width, rect.height));
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  canvas
    .getContext("2d")
    ?.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
}

function croppedFile(image: HTMLImageElement, rect: ReturnType<typeof cropRect>) {
  const canvas = document.createElement("canvas");
  drawImage(canvas, image, rect, 1280);
  return new Promise<{ blob: Blob; width: number; height: number } | null>((resolve) =>
    canvas.toBlob(
      (blob) => resolve(blob ? { blob, width: canvas.width, height: canvas.height } : null),
      "image/jpeg",
      0.85,
    ),
  );
}

function cropDescription(rect: ReturnType<typeof cropRect>) {
  const scale = Math.min(1, 1280 / Math.max(rect.width, rect.height));
  return `Source crop ${rect.width}×${rect.height} → upload ${Math.round(rect.width * scale)}×${Math.round(rect.height * scale)} JPEG`;
}

function readSession(): {
  token: string | null;
  user: { username: string; approved: boolean } | null;
} {
  try {
    return {
      token: localStorage.getItem("fashionCanvasToken"),
      user: JSON.parse(localStorage.getItem("fashionCanvasUser") || "null") as {
        username: string;
        approved: boolean;
      } | null,
    };
  } catch {
    return { token: null, user: null };
  }
}
