const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "snippets", "typography.css"), "utf8");
const start = css.indexOf("/* BEGIN LOCAL FONT DATA */");
const end = css.indexOf("/* END LOCAL FONT DATA */");
assert(start >= 0 && end > start, "Generated font block is required");
const faces = [...css.slice(start, end).matchAll(/@font-face\s*\{([^}]+)\}/g)];
assert.equal(faces.length, 3);
const expected = [
    ["HarmonyOS_Sans_SC_Regular.woff", "HarmonyOS Sans SC", 400, "font/woff", "woff"],
    ["HarmonyOS_Sans_SC_Bold.woff", "HarmonyOS Sans SC", 700, "font/woff", "woff"],
    ["Cascadia-Code-Regular.ttf", "Cascadia Code Local", 400, "font/ttf", "truetype"],
];
for (let index = 0; index < expected.length; index += 1) {
    const [file, family, weight, mime, format] = expected[index];
    const face = faces[index][1];
    const data = /url\("data:([^;]+);base64,([A-Za-z0-9+/=]+)"\)/.exec(face);
    assert(data, `Expected a portable data URL for ${file}`);
    assert.equal(data[1], mime);
    assert(face.includes(`font-family: "${family}"`));
    assert(face.includes(`font-weight: ${weight}`));
    assert(face.includes(`format("${format}")`));
    assert(Buffer.from(data[2], "base64").equals(fs.readFileSync(path.join(root, "snippets", "font.css", "fonts", file))), `Embedded font differs from ${file}; rebuild it`);
}
console.log("PASS three embedded font faces match their original font files, weights and formats");
