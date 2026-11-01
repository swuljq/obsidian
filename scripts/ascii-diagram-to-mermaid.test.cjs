const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "../plugins/ascii-diagram-to-mermaid/main.js"), "utf8");
const answer = '```mermaid\nflowchart LR\n n1["A"] --> n2["B"]\n```';

function setup(request = async () => ({ status: 200, json: { choices: [{ message: { content: answer } }] } }), timers = {}) {
  const notices = [];
  const context = {
    module: { exports: {} }, URL, console, setTimeout, clearTimeout, ...timers,
    require(name) {
      assert.equal(name, "obsidian", "No subprocess or filesystem dependencies");
      return {
        Plugin: class {}, PluginSettingTab: class {}, Modal: class {},
        Notice: class { constructor(message) { notices.push(message); } },
        requestUrl: request,
      };
    },
  };
  vm.runInNewContext(source, context);
  const plugin = new context.module.exports();
  plugin.settings = { apiBaseUrl: "https://example.test/v1/", apiKey: "test-key", apiModel: "gemini-3.8-flash-high" };
  return { plugin, notices };
}

test("conversion sends the expected OpenAI request and only the supplied diagram", async () => {
  let options;
  const { plugin } = setup(async (request) => {
    options = request;
    return { status: 200, json: { choices: [{ message: { content: answer } }] } };
  });
  assert.equal(await plugin.convertWithApi("A --> B"), answer);
  assert.equal(options.url, "https://example.test/v1/chat/completions");
  assert.equal(options.method, "POST");
  assert.equal(options.headers.Authorization, "Bearer test-key");
  const body = JSON.parse(options.body);
  assert.equal(body.model, "gemini-3.8-flash-high");
  assert.equal(body.stream, false);
  assert.equal(body.max_tokens, 4096);
  assert.equal(body.messages.length, 1);
  assert.match(body.messages[0].content, /SOURCE DIAGRAM:[\s\S]*A --> B/);
  assert.ok(!options.body.includes("test-key"));
});

test("legacy OpenCode settings do not override API defaults", async () => {
  const { plugin } = setup();
  plugin.loadData = async () => ({ model: "old-provider/old-model", opencodePath: "old-path" });
  plugin.addSettingTab = () => {};
  plugin.registerMarkdownPostProcessor = () => {};
  plugin._startMermaidDomWatcher = () => {};
  await plugin.onload();
  assert.equal(plugin.settings.apiBaseUrl, "https://subapi1.amshymb.com/v1");
  assert.equal(plugin.settings.apiModel, "gemini-3.8-flash-high");
  assert.equal(plugin.settings.apiKey, "");
  assert.equal(plugin.settings.opencodePath, undefined);
});

test("configuration is validated before sending credentials", async () => {
  let calls = 0;
  const { plugin } = setup(async () => { calls++; });
  for (const url of ["invalid", "http://example.test/v1", "https://user:pass@example.test/v1", "https://example.test/v1?key=x", "https://example.test/v1#x"]) {
    plugin.settings.apiBaseUrl = url;
    await assert.rejects(plugin.requestCompletion("test"), /API 地址/);
  }
  plugin.settings.apiBaseUrl = "https://example.test/v1";
  plugin.settings.apiKey = " ";
  await assert.rejects(plugin.requestCompletion("test"), /API Key/);
  plugin.settings.apiKey = "test-key";
  plugin.settings.apiModel = " ";
  await assert.rejects(plugin.requestCompletion("test"), /模型名称/);
  assert.equal(calls, 0);
});

test("HTTP errors are actionable and do not expose raw server responses", async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    const { plugin } = setup(async () => ({ status, text: "secret-error-test-key" }));
    await assert.rejects(plugin.requestCompletion("test"), (error) => {
      assert.match(error.message, new RegExp(`HTTP ${status}`));
      assert.ok(!error.message.includes("test-key"));
      return true;
    });
  }
});

test("transport errors are sanitized", async () => {
  const { plugin } = setup(async () => { throw new Error("Authorization: Bearer test-key"); });
  await assert.rejects(plugin.requestCompletion("test"), (error) => {
    assert.match(error.message, /无法连接 API/);
    assert.ok(!error.message.includes("test-key"));
    return true;
  });
});

test("synchronous request errors are also sanitized", async () => {
  const { plugin } = setup(() => { throw new Error("Authorization: Bearer test-key"); });
  await assert.rejects(plugin.requestCompletion("test"), (error) => {
    assert.match(error.message, /无法连接 API/);
    assert.ok(!error.message.includes("test-key"));
    return true;
  });
});

test("malformed, empty and truncated answers are rejected", async () => {
  const responses = [
    { status: 200, get json() { throw new Error("invalid JSON"); } },
    { status: 200, json: {} },
    { status: 200, json: { choices: [{ message: { content: " " } }] } },
    { status: 200, json: { choices: [{ finish_reason: "length", message: { content: answer } }] } },
  ];
  for (const response of responses) {
    const { plugin } = setup(async () => response);
    await assert.rejects(plugin.convertWithApi("A --> B"));
  }
  const { plugin } = setup(async () => ({ status: 200, json: { choices: [{ message: { content: "No diagram" } }] } }));
  await assert.rejects(plugin.convertWithApi("A --> B"), /没有检测到 Mermaid/);
});

test("timeout stops waiting and clears its timer", async () => {
  let cleared = false;
  const { plugin } = setup(() => new Promise(() => {}), {
    setTimeout(callback, ms) { assert.equal(ms, 120000); queueMicrotask(callback); return 42; },
    clearTimeout(id) { assert.equal(id, 42); cleared = true; },
  });
  await assert.rejects(plugin.requestCompletion("test"), /超过 120 秒/);
  assert.equal(cleared, true);
});

test("four-node chain keeps the existing compact layout", () => {
  const { plugin } = setup();
  const result = plugin.normalizeMermaidLayout('```mermaid\nflowchart LR\nn1["A"] --> n2["B"] --> n3["C"] --> n4["D"]\n```');
  assert.match(result, /block-beta\n  columns 3/);
  assert.match(result, /space:3/);
  assert.match(result, /n4\["D"\] space n3\["C"\]/);
});

test("failed conversion restores the button without modifying the note", async () => {
  const { plugin, notices } = setup(async () => ({ status: 401 }));
  let modified = false;
  plugin.app = { workspace: { getActiveViewOfType: () => ({ file: {} }) } };
  plugin.replaceFence = async () => { modified = true; };
  const classes = new Set();
  const button = { disabled: false, classList: { contains: (x) => classes.has(x), add: (x) => classes.add(x), remove: (x) => classes.delete(x) } };
  const label = {};
  await plugin.convertRenderedBlock({ textContent: "A --> B" }, {}, {}, { getSectionInfo: () => ({ lineStart: 0, lineEnd: 2 }) }, button, label);
  assert.equal(modified, false);
  assert.equal(button.disabled, false);
  assert.equal(classes.has("adm-busy"), false);
  assert.equal(label.textContent, "转 Mermaid");
  assert.match(notices[0], /401/);
});

test("connection test uses a short prompt and reports success", async () => {
  let prompt;
  const { plugin, notices } = setup(async (options) => {
    prompt = JSON.parse(options.body).messages[0].content;
    return { status: 200, json: { choices: [{ message: { content: "OK" } }] } };
  });
  await plugin.testConnection();
  assert.equal(prompt, "Reply with OK only.");
  assert.match(notices[0], /连接正常/);
});

test("replacement refuses to overwrite a changed diagram", async () => {
  const { plugin } = setup();
  let modified = false;
  plugin.app = { vault: { read: async () => "```text\nchanged\n```", modify: async () => { modified = true; } } };
  await assert.rejects(plugin.replaceFence({}, 0, 2, "A --> B", answer), /内容在转换期间发生变化/);
  assert.equal(modified, false);
});
