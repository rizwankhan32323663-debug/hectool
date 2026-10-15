// HecTool AI backend — Netlify Function
// POST /.netlify/functions/ai  { task, input, options }  ->  { result: string }
// Provider: Pollinations (free, NO API key required).
// No key is read, stored, logged, or sent anywhere. User input is never
// logged or stored. Errors are generic — no upstream details leak.

const MAX_INPUT = {
  write: 600,
  email: 2200,
  summarize: 12000,
  translate: 5000,
  caption: 1200,
  paraphrase: 12000,
  grammar: 12000,
  product: 3400,
  hashtag: 1200,
  story: 1900,
};

const ALLOWED_TONES = ["professional", "friendly", "casual", "formal", "creative"];
const ALLOWED_LENGTHS = ["short", "medium", "long", "detailed"];

function s(v, max) {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function pick(v, allowed, fallback) {
  const val = typeof v === "string" ? v.trim().toLowerCase() : "";
  return allowed.includes(val) ? val : fallback;
}

function buildPrompt(task, input, options) {
  const o = options && typeof options === "object" ? options : {};
  switch (task) {
    case "write": {
      const format = ["blog post", "article", "paragraph", "essay"].includes(
        (o.format || "").toLowerCase()
      )
        ? o.format
        : "article";
      const length = pick(o.length, ["short", "medium", "long"], "medium");
      const tone = pick(o.tone, ALLOWED_TONES, "professional");
      return `Write a ${length} ${format} in a ${tone} tone on this topic: ${input}\n\nReturn only the written piece, no commentary or headings about the task.`;
    }
    case "email": {
      const tone = pick(o.tone, ["formal", "informal", "professional", "friendly"], "professional");
      const recipient = s(o.recipient, 120);
      return `Write a ${tone} email for this purpose: ${input}\n${recipient ? `Recipient: ${recipient}\n` : ""}Return only the email, starting with a subject line, no commentary.`;
    }
    case "summarize": {
      const length = pick(o.length, ["short", "medium", "detailed"], "medium");
      const style = ["paragraph", "bullets"].includes((o.style || "").toLowerCase())
        ? o.style
        : "paragraph";
      return `Summarize the following text in a ${length} ${style} format. Return only the summary, no commentary.\n\n${input}`;
    }
    case "translate": {
      const from = s(o.from || o.source || o.sourceLanguage, 40) || "English";
      const to = s(o.to || o.target || o.targetLanguage, 40) || "Urdu";
      return `Translate the following text from ${from} to ${to}. Return only the translation, no commentary, no explanations.\n\n${input}`;
    }
    case "caption": {
      const platform = ["Instagram", "Facebook", "TikTok"].includes(o.platform)
        ? o.platform
        : "Instagram";
      const tone = pick(o.tone, ["engaging", "funny", "professional", "inspirational"], "engaging");
      return `Write 3 social media captions for ${platform} in a ${tone} tone about: ${input}\nInclude relevant hashtags with each caption. Return only the captions, no commentary.`;
    }
    case "paraphrase": {
      const style = pick(o.style || o.mode, ["simple", "formal", "creative", "casual", "fluent"], "simple");
      const strength = pick(o.strength, ["light", "medium", "strong"], "medium");
      return `Paraphrase the following text in a ${style} style with ${strength} strength. Keep the original meaning. Return only the paraphrased text, no commentary.\n\n${input}`;
    }
    case "grammar": {
      const detail = o.detail === "explained" ? "explained" : "corrected";
      if (detail === "explained") {
        return `Correct the grammar, spelling and punctuation of the following text. Return the corrected text, then a short bullet list of the corrections you made.\n\n${input}`;
      }
      return `Correct the grammar, spelling and punctuation of the following text. Return only the corrected text, no commentary.\n\n${input}`;
    }
    case "product": {
      const tone = pick(o.tone, ["persuasive", "professional", "fun", "luxury"], "persuasive");
      const length = pick(o.length, ["short", "medium", "long"], "medium");
      return `Write a ${length} ${tone} product description for an online store based on this:\n${input}\n\nReturn only the product description, no commentary.`;
    }
    case "hashtag": {
      const platform = ["Instagram", "TikTok", "both"].includes(o.platform) ? o.platform : "Instagram";
      const countRaw = String(o.count || "20");
      const count = ["15", "20", "30"].includes(countRaw) ? countRaw : "20";
      return `Generate ${count} hashtags for ${platform} about: ${input}\nReturn only the hashtags, separated by spaces, no commentary.`;
    }
    case "story": {
      const genre = ["adventure", "fantasy", "mystery", "funny", "heartwarming", "sci-fi"].includes(
        (o.genre || "").toLowerCase()
      )
        ? o.genre
        : "adventure";
      const length = pick(o.length, ["short", "medium", "long"], "medium");
      return `Write a ${length} ${genre} story based on this:\n${input}\n\nReturn only the story, no commentary.`;
    }
    default:
      return "";
  }
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };
  const fail = (statusCode) => ({
    statusCode,
    headers,
    body: JSON.stringify({ error: "Request failed." }),
  });

  try {
    if (event.httpMethod !== "POST") return fail(405);

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return fail(400);
    }

    const task = typeof body.task === "string" ? body.task.trim() : "";
    if (!Object.prototype.hasOwnProperty.call(MAX_INPUT, task)) return fail(400);

    const input = typeof body.input === "string" ? body.input.trim() : "";
    if (!input) return fail(400);
    if (input.length > MAX_INPUT[task]) return fail(413);

    const options = body.options && typeof body.options === "object" ? body.options : {};
    const prompt = buildPrompt(task, input, options);
    if (!prompt) return fail(400);

    // Pollinations: up to 2 attempts (initial + ONE retry on retryable
    // failure), model "openai" (the only anonymous model; its canonical
    // name is "openai-fast"). No fallback chain. Only
    // choices[0].message.content is used — never the reasoning field.
    // Retryable: network failure, or HTTP 429 / 502 / 503 / 504.
    // Non-retryable statuses keep the original mapping (429→429,
    // 400/413/422→400, 401/403/404→403, other→502) on the final attempt.
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let res = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch("https://text.pollinations.ai/openai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai",
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            max_tokens: 2048,
          }),
        });
      } catch {
        res = null;
      }
      if (res && res.ok) break;
      const retryable =
        res === null || res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
      if (!retryable) break;
      if (attempt === 0) await sleep(1000);
    }

    if (!res) return fail(502);

    if (!res.ok) {
      if (res.status === 429) return fail(429);
      if (res.status === 400 || res.status === 413 || res.status === 422) return fail(400);
      if (res.status === 401 || res.status === 403 || res.status === 404) return fail(403);
      return fail(502);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      return fail(502);
    }
    const text =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      typeof data.choices[0].message.content === "string"
        ? data.choices[0].message.content
        : "";
    if (!text.trim()) return fail(502);

    return { statusCode: 200, headers, body: JSON.stringify({ result: text.trim() }) };
  } catch {
    return fail(500);
  }
};
