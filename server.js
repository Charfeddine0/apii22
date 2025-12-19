const express = require("express");
const cors = require("cors");
const path = require("path");
const { openChatGPT } = require("./browser");
const { fillPrompt } = require("./fill");

const app = express();
const IMAGE_DIR = path.join(__dirname, "image");

app.use(express.text({ limit: "200mb", type: "text/plain" }));
app.use(express.json({ limit: "200mb", strict: false }));
app.use(express.urlencoded({ extended: true, limit: "200mb" }));
app.use(cors());
app.use("/outputs", express.static(path.join(__dirname, "outputs")));
app.use("/image", express.static(IMAGE_DIR));

let browserRef = null;
let pageRef = null;

async function ensureBrowser() {
  if (pageRef) {
    return pageRef;
  }

  console.log("🚀 Launching browser...");
  const instance = await openChatGPT();
  browserRef = instance.browser;
  pageRef = instance.page;
  console.log("✅ Browser Ready");
  return pageRef;
}

function extractPrompt(body) {
  if (body === null || body === undefined) {
    return "";
  }

  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") {
        return extractPrompt(parsed);
      }
    } catch (error) {
      // ignore JSON parse errors and treat as plain text
    }

    return body.trim();
  }

  if (body && typeof body === "object") {
    if (typeof body.prompt === "string") {
      return body.prompt.trim();
    }
    if (typeof body.message === "string") {
      return body.message.trim();
    }
  }

  const fallback =
    typeof body === "object" ? JSON.stringify(body).trim() : String(body).trim();
  return fallback;
}

app.post("/generate", async (req, res) => {
  try {
    const prompt = extractPrompt(req.body);

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message:
          "❌ يجب إرسال نص البرومبت مباشرة في الـ body، أو داخل { prompt: '...' } أو { message: '...' }",
      });
    }

    console.log(`📩 Received prompt: ${prompt.slice(0, 200)}...`);

    const page = await ensureBrowser();
    const result = await fillPrompt(page, prompt, { downloadImages: false });

    return res.json({
      success: true,
      generated: result.text,
    });
  } catch (error) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/image", async (req, res) => {
  try {
    const prompt = extractPrompt(req.body);

    if (!prompt) {
      return res.status(400).json({
        success: false,
        message:
          "❌ يجب إرسال نص البرومبت مباشرة في الـ body، أو داخل { prompt: '...' } أو { message: '...' }",
      });
    }

    console.log(`🖼️ Received image prompt: ${prompt.slice(0, 200)}...`);

    const page = await ensureBrowser();
    const result = await fillPrompt(page, prompt, {
      imageOutputDir: IMAGE_DIR,
      imagePublicPath: "/image",
      downloadImages: true,
    });

    return res.json({
      success: true,
      generated: result.text,
      images: result.images,
    });
  } catch (error) {
    console.error("❌ API Error:", error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(3002, () => {
  console.log("🌐 API running on http://localhost:3002");
});
