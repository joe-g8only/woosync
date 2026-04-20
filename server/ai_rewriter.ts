import OpenAI from "openai";

// Returns an OpenAI client using the provided key, or falls back to OPENAI_API_KEY env var.
function getClient(apiKey?: string): OpenAI {
  const key = apiKey || process.env.OPENAI_API_KEY;
  if (!key) throw new Error("No OpenAI API key provided. Add your key in the Connect screen or set OPENAI_API_KEY on the server.");
  return new OpenAI({ apiKey: key });
}

export interface RewrittenDescription {
  shortDescription: string;    // 1-2 sentences, buzzy, above the fold
  keyFeatures: string[];        // 4-7 bullet points
  longDescription: string;     // full high-converting HTML description
}

/**
 * Rewrites a supplier product description into three formats:
 * - Short Description: 1-2 punchy sentences highlighting the "why buy" angle
 * - Key Features: 4-7 bullet points covering specs, benefits, fitment highlights
 * - Long Description: SEO-optimised, high-converting full description
 *
 * @param sourceDescription  The raw description from the supplier CSV
 * @param productName        Optional product name for more accurate rewrites
 * @param brand              Optional brand name
 * @param additionalContext  Any extra columns (category, specs, etc.) as a plain string
 */
export async function rewriteDescription(
  sourceDescription: string,
  productName?: string,
  brand?: string,
  additionalContext?: string,
  apiKey?: string
): Promise<RewrittenDescription> {
  const client = getClient(apiKey);
  const contextParts: string[] = [];
  if (productName) contextParts.push(`Product name: ${productName}`);
  if (brand) contextParts.push(`Brand: ${brand}`);
  if (additionalContext) contextParts.push(`Additional info: ${additionalContext}`);
  const context = contextParts.join("\n");

  const prompt = `You are a conversion-focused copywriter for an automotive performance parts e-commerce store. 
Your job is to transform a basic supplier product description into three distinct content blocks used on the product page.

${context ? `PRODUCT CONTEXT:\n${context}\n` : ""}SOURCE DESCRIPTION:
${sourceDescription}

Rewrite this into the following three blocks. Return ONLY valid JSON — no markdown, no commentary.

{
  "shortDescription": "1-2 sentences. Above-the-fold hook. Highlights the biggest problem the part solves and the main benefit. Buzzworthy and punchy. No fluff. Example style: 'Eliminate oil leaks for good with this direct OEM-replacement valve cover gasket — engineered for a perfect seal on high-mileage engines.'",
  "keyFeatures": [
    "4 to 7 strings — each is one plain-text feature or benefit with NO bullet symbol prefix",
    "CRITICAL: each string must be 75 characters or fewer (count carefully)",
    "Examples: Easy bolt-on install, 304 stainless steel construction, OEM replacement fit, Adds 15whp on stock tune, Includes all mounting hardware",
    "Be specific — use real specs from the description when available",
    "Do NOT start any string with a bullet, dash, asterisk, or any symbol"
  ],
  "longDescription": "HTML string. 2-4 paragraphs. Written to convert. Opens with the pain point the part addresses, transitions to features/benefits, closes with fitment/install confidence. Use <p> tags for paragraphs, <strong> for key terms. No <h> tags. No bullet lists here — those are covered by keyFeatures. Approx 150-250 words."
}`;

  const response = await client.responses.create({
    model: "gpt5_mini",
    input: prompt,
  });

  const raw = (response.output_text || "").trim();

  // Strip markdown code fences if present
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed: RewrittenDescription;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: return the raw description as-is if JSON parse fails
    parsed = {
      shortDescription: sourceDescription.slice(0, 200),
      keyFeatures: [],
      longDescription: `<p>${sourceDescription}</p>`,
    };
  }

  // Ensure keyFeatures is always an array of strings
  if (!Array.isArray(parsed.keyFeatures)) {
    parsed.keyFeatures = [];
  }
  // Strip any bullet prefix, enforce max 75 chars per feature
  parsed.keyFeatures = parsed.keyFeatures.map((f: any) => {
    const clean = String(f).replace(/^[•·\-\*]\s*/, "").trim();
    return clean.length > 75 ? clean.slice(0, 74).trimEnd() + "…" : clean;
  });

  return parsed;
}
