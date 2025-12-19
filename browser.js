// browser.js
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");
const { loadCookies } = require("./cookies");

const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";
const DEFAULT_HEADLESS = "new";
const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-blink-features=AutomationControlled",
  "--window-size=1280,800",
];

function validateChatgptUrl(candidate, sourceLabel) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return null;
  }

  try {
    const url = new URL(candidate.trim());

    if (url.protocol !== "https:") {
      console.warn(`⚠️ ${sourceLabel} must use https, falling back to default.`);
      return null;
    }

    return url.toString();
  } catch (error) {
    console.warn(`⚠️ Invalid ${sourceLabel}: ${error.message}`);
    return null;
  }
}

function resolveHeadless(value, sourceLabel) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "new") {
      return "new";
    }

    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  if (value !== undefined) {
    console.warn(`⚠️ Invalid headless value in ${sourceLabel}, falling back to default.`);
  }

  return null;
}

function loadConfig() {
  const configPath = path.join(__dirname, "config.json");
  const envUrlOverride = validateChatgptUrl(
    process.env.CHATGPT_URL,
    "CHATGPT_URL environment variable"
  );
  const envHeadlessOverride = resolveHeadless(
    process.env.HEADLESS_MODE ?? process.env.HEADLESS,
    "HEADLESS_MODE environment variable"
  );

  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      console.warn(`⚠️ Failed to parse config.json: ${error.message}`);
    }
  } else {
    console.warn(`⚠️ config.json not found, using default URL ${DEFAULT_CHATGPT_URL}`);
  }

  const chatgptUrl =
    envUrlOverride ||
    validateChatgptUrl(fileConfig.chatgpt_url, "chatgpt_url in config.json") ||
    DEFAULT_CHATGPT_URL;

  const headless =
    envHeadlessOverride ||
    resolveHeadless(fileConfig.headless, "headless in config.json") ||
    DEFAULT_HEADLESS;

  return { chatgpt_url: chatgptUrl, headless };
}

async function addStealthTweaks(page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  );

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "visible" });
    Object.defineProperty(document, "hidden", { get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
}

function registerHumanScroll(page) {
  page.humanScroll = async function humanScroll() {
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      for (let i = 0; i < 15; i += 1) {
        window.scrollBy({
          top: Math.random() * 400 + 200,
          behavior: "smooth",
        });
        await delay(Math.random() * 600 + 300);
      }
    });
  };
}

function registerInfiniteScroll(page) {
  page.startInfiniteScroll = function startInfiniteScroll() {
    // Run persistent scroll without keeping the evaluate promise pending forever.
    return page.evaluate(() => {
      function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      async function infiniteScroll() {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const direction = Math.random() > 0.5 ? 1 : -1;
          const distance = Math.random() * 600 + 200;

          window.scrollBy({
            top: distance * direction,
            behavior: "smooth",
          });

          await delay(3000 + Math.random() * 4000);
        }
      }

      void infiniteScroll();
    });
  };
}

async function openChatGPT() {
  const config = loadConfig();
  const headlessLabel = config.headless === false ? "full" : "headless";
  console.log(`🚀 Launching browser in ${headlessLabel} mode...`);
  const browser = await puppeteer.launch({
    headless: config.headless,
    defaultViewport: null,
    args: PUPPETEER_ARGS,
  });

  const page = await browser.newPage();

  await addStealthTweaks(page);
  registerHumanScroll(page);
  registerInfiniteScroll(page);

  let cookiesLoaded = false;
  try {
    cookiesLoaded = await loadCookies(page);
  } catch (error) {
    console.warn(`⚠️ Failed to load cookies before navigation: ${error.message}`);
  }

  await page.goto(config.chatgpt_url, { waitUntil: "networkidle2" });

  if (!cookiesLoaded) {
    try {
      await loadCookies(page);
      await page.reload({ waitUntil: "networkidle2" });
    } catch (error) {
      console.warn(`⚠️ Failed to reload with cookies: ${error.message}`);
    }
  }

  try {
    await page.waitForSelector("#history", { timeout: 60000 });
    console.log("✅ جاهز.");
  } catch {
    console.log("⚠️ #history لم يظهر");
  }

  await page.humanScroll();
  page.startInfiniteScroll();

  return { browser, page };
}

module.exports = { openChatGPT };
