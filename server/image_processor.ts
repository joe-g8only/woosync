/**
 * image_processor.ts
 *
 * Downloads image URLs, normalises them to a 1000×1000 white-background
 * padded square (no cropping), saves to a temp directory, then returns
 * a served URL so WooCommerce can sideload it into the media library.
 *
 * Spec:
 *   - Download original image
 *   - Determine longest side
 *   - Create square canvas of that size, white background
 *   - Centre original image on canvas (padding fills remaining space)
 *   - Flatten PNG transparency to white
 *   - Resize square canvas to 1000×1000 at 72dpi / quality 90
 *   - Save to temp file served by Express at /tmp-images/:filename
 *   - Return served URL so WooCommerce can sideload it
 *   - A bad image URL must NEVER fail the entire row
 */

import axios from "axios";
import sharp from "sharp";
import FormData from "form-data";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";

export const TMP_IMAGE_DIR = path.join(os.tmpdir(), "woosync-images");

// Ensure temp dir exists at module load time
if (!fs.existsSync(TMP_IMAGE_DIR)) {
  fs.mkdirSync(TMP_IMAGE_DIR, { recursive: true });
}

export interface ImageResult {
  originalUrl: string;
  servedPath?: string;  // absolute path to temp file
  filename?: string;    // filename only, for URL construction
  error?: string;
}

/** Download a remote image and return its raw Buffer */
async function downloadImage(url: string): Promise<Buffer> {
  const response = await axios.get<Buffer>(url.trim(), {
    responseType: "arraybuffer",
    timeout: 30_000,
    headers: {
      "User-Agent": "WooSync-ImagePipeline/1.0",
      Accept: "image/*,*/*",
    },
    maxContentLength: 50 * 1024 * 1024, // 50 MB max
  });
  return Buffer.from(response.data);
}

/**
 * Letterbox an image to a white 1000×1000 square — no cropping ever.
 *
 * Strategy:
 *  1. Flatten transparency → white background
 *  2. Resize so the longest side = 1000px (scale proportionally)
 *  3. Embed (pad) into a 1000×1000 white canvas, centred
 *  4. Output as JPEG @72dpi, quality 90
 *
 * A 2000×1000 image becomes 1000×500 fitted into a 1000×1000 white square.
 * A 500×500 image is upscaled to 1000×1000 with no padding.
 * No pixels of the original are ever cut off.
 */
async function processImageBuffer(input: Buffer): Promise<Buffer> {
  const processed = await sharp(input)
    .flatten({ background: { r: 255, g: 255, b: 255 } }) // flatten alpha to white
    .resize(1000, 1000, {
      fit: "contain",           // scale to fit within 1000×1000, preserving aspect ratio
      background: { r: 255, g: 255, b: 255 }, // white letterbox padding
      position: "center",       // centre the image within the canvas
      kernel: sharp.kernel.lanczos3,
    })
    .jpeg({ quality: 90, progressive: true, density: 72 })
    .toBuffer();

  return processed;
}

/** Derive a safe filename from the image URL + a short hash for uniqueness */
function deriveFilename(url: string, index: number): string {
  try {
    const u = new URL(url.trim());
    const base = path.basename(u.pathname) || `image-${index}`;
    const stem = base.replace(/\.[^.]+$/, "");
    const hash = crypto.createHash("md5").update(url).digest("hex").slice(0, 8);
    return `${stem}-${hash}.jpg`;
  } catch {
    const hash = crypto.createHash("md5").update(url + index).digest("hex").slice(0, 8);
    return `product-image-${index}-${hash}.jpg`;
  }
}

/**
 * Full pipeline for a single image URL.
 * Downloads → processes → saves to TMP_IMAGE_DIR.
 * Returns ImageResult — never throws.
 */
export async function processSingleImage(
  url: string,
  index: number
): Promise<ImageResult> {
  try {
    const raw = await downloadImage(url);
    const processed = await processImageBuffer(raw);
    const filename = deriveFilename(url, index);
    const destPath = path.join(TMP_IMAGE_DIR, filename);
    fs.writeFileSync(destPath, processed);
    return { originalUrl: url, servedPath: destPath, filename };
  } catch (err: any) {
    const message =
      err?.response?.data?.message ||
      err?.response?.statusText ||
      err?.message ||
      "Unknown image error";
    return { originalUrl: url, error: `Image failed: ${message}` };
  }
}

/**
 * Process all image URLs for a single product row.
 *
 * @param rawImageField  Raw CSV value for the Images column
 *                       (pipe-separated OR comma-separated)
 * @param serveBaseUrl   The publicly accessible base URL for the Express
 *                       temp image route, e.g. "https://myserver.com/tmp-images"
 * @returns              WooCommerce images array payload + any per-image errors
 */
export async function processImagesForProduct(
  rawImageField: string,
  serveBaseUrl: string
): Promise<{
  wooImages: { src: string }[];
  errors: string[];
  warnings: string[];
  tempFiles: string[];
}> {
  // Support both pipe and comma as URL delimiters
  const urls = (rawImageField.includes("|") ? rawImageField.split("|") : rawImageField.split(","))
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return { wooImages: [], errors: [], warnings: [], tempFiles: [] };
  }

  const results = await Promise.all(
    urls.map((url, i) => processSingleImage(url, i + 1))
  );

  const wooImages: { src: string }[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const tempFiles: string[] = [];

  for (const r of results) {
    if (r.filename && r.servedPath) {
      // Build the served URL WooCommerce will fetch from
      const servedUrl = `${serveBaseUrl}/${r.filename}`;
      wooImages.push({ src: servedUrl });
      tempFiles.push(r.servedPath);
    } else if (r.error) {
      errors.push(`${r.originalUrl} — ${r.error}`);
    }
  }

  if (errors.length > 0 && wooImages.length > 0) {
    warnings.push(
      `${errors.length} of ${urls.length} image(s) failed to process — product updated with available images.`
    );
  }

  return { wooImages, errors, warnings, tempFiles };
}

/** Clean up temp image files after a product is created/updated */
export function cleanupTempImages(filePaths: string[]): void {
  for (const p of filePaths) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

/**
 * Upload a processed JPEG buffer to WordPress media library.
 * Uses WordPress Application Password (username:app_password) — the correct
 * auth method for wp/v2/media. WooCommerce API keys alone do NOT work here.
 */
async function uploadToWordPressMedia(
  storeUrl: string,
  wpUsername: string,
  wpAppPassword: string,
  imageBuffer: Buffer,
  filename: string
): Promise<{ mediaId: number; mediaUrl: string }> {
  const endpoint = `${storeUrl}/wp-json/wp/v2/media`;

  const form = new FormData();
  form.append("file", imageBuffer, {
    filename,
    contentType: "image/jpeg",
    knownLength: imageBuffer.length,
  });

  const response = await axios.post(endpoint, form, {
    headers: {
      ...form.getHeaders(),
      Authorization:
        "Basic " + Buffer.from(`${wpUsername}:${wpAppPassword}`).toString("base64"),
    },
    timeout: 60_000,
    maxContentLength: 30 * 1024 * 1024,
  });

  return {
    mediaId: response.data.id,
    mediaUrl: response.data.source_url,
  };
}

/**
 * Full pipeline with WordPress Application Password upload.
 * Use this when the user has provided WP admin credentials.
 */
export async function processImagesWithWpUpload(
  rawImageField: string,
  storeUrl: string,
  wpUsername: string,
  wpAppPassword: string
): Promise<{
  wooImages: { id: number; src: string }[];
  errors: string[];
  warnings: string[];
}> {
  const urls = (rawImageField.includes("|") ? rawImageField.split("|") : rawImageField.split(","))
    .map((u) => u.trim())
    .filter(Boolean);

  if (urls.length === 0) {
    return { wooImages: [], errors: [], warnings: [] };
  }

  const results = await Promise.all(
    urls.map(async (url, i) => {
      try {
        const raw = await downloadImage(url);
        const processed = await processImageBuffer(raw);
        const filename = deriveFilename(url, i + 1);
        const { mediaId, mediaUrl } = await uploadToWordPressMedia(storeUrl, wpUsername, wpAppPassword, processed, filename);
        return { originalUrl: url, mediaId, mediaUrl };
      } catch (err: any) {
        const message =
          err?.response?.data?.message ||
          err?.response?.statusText ||
          err?.message ||
          "Unknown image error";
        return { originalUrl: url, error: `Image failed: ${message}` };
      }
    })
  );

  const wooImages: { id: number; src: string }[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const r of results) {
    if ('mediaId' in r && r.mediaId && r.mediaUrl) {
      wooImages.push({ id: r.mediaId, src: r.mediaUrl });
    } else if ('error' in r) {
      errors.push(`${r.originalUrl} — ${r.error}`);
    }
  }

  if (errors.length > 0 && wooImages.length > 0) {
    warnings.push(
      `${errors.length} of ${urls.length} image(s) failed to process — product updated with available images.`
    );
  }

  return { wooImages, errors, warnings };
}
