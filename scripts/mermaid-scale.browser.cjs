const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require(process.argv[2] || "playwright");

const pluginDir = path.join(__dirname, "../plugins/ascii-diagram-to-mermaid");
const source = fs.readFileSync(path.join(pluginDir, "main.js"), "utf8");
const css = fs.readFileSync(path.join(pluginDir, "styles.css"), "utf8");

test("Mermaid scale controls work in a real browser", async () => {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent(`<!DOCTYPE html><html><head><style>
      :root { --background-secondary: #eee; --text-muted: #555; }
      body { margin: 0; } main { width: min(1000px, 100%); margin: auto; }
      svg { max-width: 1200px; } ${css}
      </style></head><body><main class="markdown-rendered">
      <div class="block-language-mermaid" id="first"><div class="mermaid" id="inner">
      <svg viewBox="0 0 1200 960" width="100%" style="max-width:1200px" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="1180" height="940" fill="#eee9ff" stroke="#9673ff"/></svg>
      </div></div><p id="following">Following paragraph</p>
      <div class="mermaid" id="second"><svg viewBox="0 0 1200 960" width="100%" xmlns="http://www.w3.org/2000/svg"><rect width="1200" height="960" fill="#eee9ff"/></svg></div>
      </main></body></html>`);
    await page.waitForLoadState("networkidle");
    await page.evaluate((code) => {
      window.listeners = [];
      window.fullscreenSvg = null;
      window.module = { exports: {} };
      window.require = () => ({
        Plugin: class {
          async loadData() { return {}; }
          addSettingTab() {}
          registerMarkdownPostProcessor() {}
          registerDomEvent(element, name, callback) {
            element.addEventListener(name, callback);
            window.listeners.push(() => element.removeEventListener(name, callback));
          }
        },
        PluginSettingTab: class {},
        Modal: class {
          constructor() {
            this.modalEl = document.createElement("div");
            this.contentEl = document.createElement("div");
            this.modalEl.appendChild(this.contentEl);
            this.modalEl.addClass = (name) => this.modalEl.classList.add(name);
            this.contentEl.addClass = (name) => this.contentEl.classList.add(name);
            this.contentEl.empty = () => this.contentEl.replaceChildren();
          }
          open() { document.body.appendChild(this.modalEl); this.onOpen(); }
        },
        setIcon(button) {
          button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M4 12h16"/></svg>';
        },
      });
      (0, eval)(code);
      window.plugin = new window.module.exports();
      return window.plugin.onload();
    }, source);

    const diagram = page.locator("#inner > svg");
    const toolbar = page.locator("#inner > .adm-mermaid-toolbar");
    const percent = toolbar.locator(".adm-scale-percentage");
    const smaller = toolbar.getByRole("button", { name: "缩小 Mermaid 图", exact: true });
    const larger = toolbar.getByRole("button", { name: "放大 Mermaid 图", exact: true });
    const reset = toolbar.getByRole("button", { name: "重置 Mermaid 图大小", exact: true });
    await toolbar.waitFor({ state: "attached" });
    assert.equal(await page.locator(".adm-mermaid-toolbar").count(), 2, "Nested Mermaid containers must not get duplicate controls");
    assert.equal(await percent.textContent(), "100%");
    assert.equal(await larger.isDisabled(), true);
    assert.equal(await reset.isDisabled(), true);
    const before = await diagram.boundingBox();
    const paragraphBefore = await page.locator("#following").boundingBox();
    await page.locator("#inner").hover();
    for (let i = 0; i < 3; i++) await smaller.click();
    const after = await diagram.boundingBox();
    const paragraphAfter = await page.locator("#following").boundingBox();
    assert.equal(await percent.textContent(), "70%");
    assert.ok(Math.abs(after.width / before.width - 0.7) < 0.01, "Width must scale to 70%");
    assert.ok(Math.abs(after.height / before.height - 0.7) < 0.01, "Height must scale to 70%");
    assert.ok(Math.abs((paragraphBefore.y - paragraphAfter.y) - (before.height - after.height)) < 1, "Following text must move up without leftover space");
    assert.ok(Math.abs(after.x + after.width / 2 - 640) < 1, "Diagram must remain centered");
    assert.equal(await page.locator("#second .adm-scale-percentage").textContent(), "100%");

    await toolbar.getByRole("button", { name: "全屏查看 Mermaid 图", exact: true }).click();
    const fullscreen = page.locator(".adm-fullscreen-content > svg");
    const fullscreenBox = await fullscreen.boundingBox();
    assert.ok(fullscreenBox.width > after.width, "Fullscreen must ignore inline scale");
    assert.equal(await fullscreen.evaluate((svg) => svg.style.getPropertyValue("--adm-svg-scale")), "");
    await page.locator(".adm-fullscreen-modal").evaluate((el) => el.remove());

    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await diagram.boundingBox();
    assert.ok(Math.abs(mobile.width - 390 * 0.7) < 1, "Scaled diagram must adapt to narrow windows");
    assert.ok(await toolbar.evaluate((el) => el.getBoundingClientRect().right <= innerWidth));
    for (let i = 0; i < 5; i++) await smaller.click();
    assert.equal(await percent.textContent(), "20%");
    assert.equal(await smaller.isDisabled(), true);
    await larger.click();
    assert.equal(await percent.textContent(), "30%");
    await reset.click();
    assert.equal(await percent.textContent(), "100%");
    assert.equal(await diagram.evaluate((svg) => svg.classList.contains("adm-scaled-svg")), false);

    await smaller.focus();
    assert.equal(await toolbar.evaluate((el) => getComputedStyle(el).opacity), "1", "Keyboard focus must show controls");
    await page.emulateMedia({ media: "print" });
    assert.equal(await toolbar.evaluate((el) => getComputedStyle(el).display), "none");
    await page.emulateMedia({ media: "screen" });

    await smaller.click();
    await page.evaluate(() => {
      const old = document.querySelector("#inner > svg");
      const fresh = old.cloneNode(true);
      fresh.classList.remove("adm-scaled-svg");
      fresh.style.cssText = "";
      fresh.setAttribute("viewBox", "0 0 800 640");
      old.replaceWith(fresh);
    });
    await page.waitForFunction(() => document.querySelector("#inner > svg").style.getPropertyValue("--adm-svg-width") === "800px");
    assert.equal(await toolbar.count(), 1);
    assert.equal(await percent.textContent(), "90%");
    await reset.click();

    await smaller.click();
    await page.evaluate(() => {
      window.plugin.onunload();
      window.listeners.splice(0).forEach((remove) => remove());
    });
    assert.equal(await page.locator(".adm-mermaid-toolbar").count(), 0);
    assert.equal(await page.locator(".adm-scaled-svg").count(), 0);
    assert.equal(await diagram.evaluate((svg) => svg.style.getPropertyValue("--adm-svg-scale")), "");
    await page.evaluate(() => window.plugin.onload());
    await page.locator("#inner .adm-mermaid-toolbar").waitFor({ state: "attached" });
    assert.equal(await page.locator(".adm-mermaid-toolbar").count(), 2);
    assert.equal(await page.locator("#inner .adm-scale-percentage").textContent(), "100%");
    await page.locator("#inner button[data-action=smaller]").click();
    await page.evaluate(() => {
      const container = document.querySelector("#inner");
      container.innerHTML = '<svg width="600" height="480" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="480"/></svg>';
    });
    await page.locator("#inner .adm-mermaid-toolbar").waitFor({ state: "attached" });
    assert.equal(await page.locator("#inner .adm-scale-percentage").textContent(), "100%", "Full rerender must reset the scale");
    const fallbackBefore = await diagram.boundingBox();
    await page.locator("#inner button[data-action=smaller]").click();
    await page.locator("#inner button[data-action=smaller]").click();
    const fallbackAfter = await diagram.boundingBox();
    assert.ok(Math.abs(fallbackAfter.width / fallbackBefore.width - 0.8) < 0.01, "Missing viewBox must use stable initial dimensions, not compound scaling");
    assert.deepEqual(errors, []);
    console.log("Verified desktop/mobile sizing, document flow, centering, independent state, bounds, reset, fullscreen, keyboard, print, SVG replacement and plugin reload.");
  } finally {
    await browser.close();
  }
});
