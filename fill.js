const fs = require("fs");
const path = require("path");
const { openChatGPT } = require("./browser");

const DEFAULT_OPTIONS = {
  timeoutSeconds: 300,
  pollInterval: 1000,
  stableChecks: 5,
  responseSelectors: [
    "div.markdown.prose",
    "div[class*='prose']",
    "div[class*='markdown']",
    "div[data-message-author-role='assistant']",
    "div[class*='message']",
  ],
  logFile: path.join(__dirname, "log.txt"),
  imageOutputDir: path.join(__dirname, "image"),
  imagePublicPath: "/image",
  downloadImages: true,
};

function createLogger(logFile) {
  return (message) => {
    const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
    const entry = `[${timestamp}] ${message}`;
    console.log(entry);
    fs.appendFileSync(logFile, `${entry}\n`);
  };
}

function ensurePrompt(prompt) {
  if (typeof prompt !== "string") {
    throw new Error("❌ البرومبت يجب أن يكون نصًا.");
  }

  const normalized = prompt.trim();
  if (!normalized) {
    throw new Error("❌ البرومبت فارغ بعد إزالة المسافات.");
  }

  return normalized;
}

async function typePrompt(page, prompt) {
  const selector = "#prompt-textarea, [contenteditable='true'], textarea";
  await page.waitForSelector(selector, { timeout: 15000 });

  const result = await page.evaluate((text) => {
    const element =
      document.querySelector("#prompt-textarea") ||
      document.querySelector("[contenteditable='true']") ||
      document.querySelector("textarea");

    if (!element) {
      return false;
    }

    if ("value" in element) {
      element.value = text;
      element.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      element.innerText = text;
      element.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }

    return true;
  }, prompt);

  if (!result) {
    throw new Error("❌ لم يتم العثور على مربع الإدخال.");
  }
}

async function sendPrompt(page) {
  const button = await page.waitForSelector("button[data-testid='send-button']", {
    timeout: 15000,
  });

  await button.click();
}

async function collectResponse(page, opts, log) {
  let finalText = "";
  let finalImages = [];
  let lastLength = 0;
  let stableCount = 0;
  let lastImageCount = 0;
  let imageStableCount = 0;
  const deadline = Date.now() + opts.timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const responses = await page.evaluate((selectors) => {
      const fallbackElements = Array.from(
        document.querySelectorAll(selectors.join(","))
      );

      const assistantElements = Array.from(
        document.querySelectorAll("[data-message-author-role='assistant']")
      );

      const textResponses = fallbackElements
        .map((e) => e.innerText.trim())
        .filter(Boolean);

      const assistantTexts = assistantElements
        .map((el) => el.innerText.trim())
        .filter(Boolean);

      const images = [];
      const assistantImages = [];

      const collectImages = (element, bucket) => {
        element.querySelectorAll("img").forEach((img) => {
          const src = img.getAttribute("src");
          if (src) {
            bucket.push(src);
          }
        });
      };

      fallbackElements.forEach((el) => collectImages(el, images));
      assistantElements.forEach((el) => collectImages(el, assistantImages));

      return {
        textResponses,
        images,
        assistantTexts,
        assistantImages,
      };
    }, opts.responseSelectors);

    const textCandidates =
      responses.assistantTexts.length > 0
        ? responses.assistantTexts
        : responses.textResponses;

    if (textCandidates.length) {
      finalText = textCandidates[textCandidates.length - 1];

      if (finalText.length === lastLength) {
        stableCount += 1;
      } else {
        stableCount = 0;
        lastLength = finalText.length;
      }

      if (stableCount >= opts.stableChecks) {
        break;
      }
    }

    const imageCandidates =
      responses.assistantImages.length > 0
        ? responses.assistantImages
        : responses.images;

    if (imageCandidates.length) {
      finalImages = imageCandidates;

      if (imageCandidates.length === lastImageCount) {
        imageStableCount += 1;
      } else {
        imageStableCount = 0;
        lastImageCount = imageCandidates.length;
      }

      if (!textCandidates.length && imageStableCount >= opts.stableChecks) {
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, opts.pollInterval));
  }

  if (!finalText.trim() && !finalImages.length) {
    throw new Error("❌ لم يتم العثور على رد.");
  }

  log("⏳ الانتظار 3 ثواني قبل الحفظ...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  return { text: finalText, images: finalImages };
}

function persistTextResponse(finalText, log) {
  const outputPath = path.join(__dirname, "outputs", "lastOutput.txt");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, finalText);
  log(`💾 تم الحفظ: ${outputPath}`);
}

function getExtensionFromContentType(contentType = "") {
  const subtype = contentType.split("/")[1];
  if (!subtype) {
    return "png";
  }

  if (subtype.includes("jpeg")) {
    return "jpg";
  }

  return subtype.split(";")[0];
}

async function downloadImages(page, imageSources, log) {
  const uniqueSources = Array.from(new Set(imageSources));

  if (!uniqueSources.length) {
    return [];
  }

  log(`🖼️ تم العثور على ${uniqueSources.length} صورة، جاري التحميل...`);

  const downloaded = await page.evaluate(async (sources) => {
    const results = [];

    for (const src of sources) {
      try {
        const response = await fetch(src);
        const arrayBuffer = await response.arrayBuffer();
        const contentType = response.headers.get("content-type") || "image/png";
        const bytes = Array.from(new Uint8Array(arrayBuffer));
        const base64 = btoa(String.fromCharCode(...bytes));
        results.push({ src, contentType, base64 });
      } catch (error) {
        results.push({ src, error: error.message });
      }
    }

    return results;
  }, uniqueSources);

  const successfulDownloads = downloaded.filter((item) => !item.error);

  if (successfulDownloads.length !== uniqueSources.length) {
    log("⚠️ بعض الصور لم يتم تحميلها بنجاح.");
  }

  return successfulDownloads;
}

function persistImages(images, outputDir, publicBasePath, log) {
  if (!images.length) {
    return [];
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const timestamp = Date.now();

  return images.map((img, index) => {
    const extension = getExtensionFromContentType(img.contentType);
    const fileName = `image-${timestamp}-${index + 1}.${extension}`;
    const filePath = path.join(outputDir, fileName);
    const normalizedBase = publicBasePath.endsWith("/")
      ? publicBasePath.slice(0, -1)
      : publicBasePath;
    const publicPath = `${normalizedBase}/${fileName}`;

    fs.writeFileSync(filePath, Buffer.from(img.base64, "base64"));
    log(`🖼️ تم حفظ صورة: ${filePath}`);

    return { source: img.src, url: publicPath, filePath };
  });
}

async function fillPrompt(page, prompt, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const log = createLogger(opts.logFile);
  const sanitizedPrompt = ensurePrompt(prompt);
  const startTime = Date.now();

  try {
    log("🟢 بدء معالجة البرومبت...");

    await typePrompt(page, sanitizedPrompt);
    log("✍️ تم إدخال البرومبت.");

    await sendPrompt(page);
    log("📤 تم الإرسال.");

    const finalResponse = await collectResponse(page, opts, log);

    if (finalResponse.text) {
      persistTextResponse(finalResponse.text, log);
    }

    let savedImages = [];

    if (opts.downloadImages) {
      const downloadedImages = await downloadImages(
        page,
        finalResponse.images,
        log
      );
        savedImages = persistImages(
          downloadedImages,
          opts.imageOutputDir,
          opts.imagePublicPath,
          log
        );
      }

    log("⏳ الانتظار 3 ثواني بعد الحفظ...");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    log("🏁 تم اكتمال الرد بالكامل.");

    return { text: finalResponse.text, images: savedImages };
  } catch (error) {
    log(`❌ خطأ: ${error.message}`);
    throw error;
  } finally {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`⌛ مدة التنفيذ: ${elapsed} ثانية.`);
  }
}

async function generateArticle(promptText) {
  const { browser, page } = await openChatGPT();

  try {
    console.log(`🧠 توليد مقال: ${promptText}`);
    const result = await fillPrompt(page, promptText);
    return result;
  } finally {
    await browser.close();
  }
}

module.exports = { fillPrompt, generateArticle };
