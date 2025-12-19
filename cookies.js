const fs = require("fs");
const path = require("path");

async function loadCookies(page) {
  const cookiesPath = path.join(__dirname, "cookies.json");

  if (!fs.existsSync(cookiesPath)) {
    console.warn(`⚠️ Cookie file not found at ${cookiesPath}`);
    return false;
  }

  let cookies;
  try {
    cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
  } catch (error) {
    console.warn(`⚠️ Failed to parse cookies.json: ${error.message}`);
    return false;
  }

  if (!Array.isArray(cookies) || cookies.length === 0) {
    console.warn("⚠️ cookies.json is empty or not an array");
    return false;
  }

  try {
    await page.setCookie(...cookies);
    console.log("✅ Cookies loaded successfully");
    return true;
  } catch (error) {
    console.warn(`⚠️ Failed to apply cookies: ${error.message}`);
    return false;
  }
}

module.exports = { loadCookies };
