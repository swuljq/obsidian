const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sandbox = {
    module: { exports: {} },
    require(id) {
        if (id === "obsidian") return { Plugin: class {} };
        throw new Error(`Unexpected dependency: ${id}`);
    },
};
vm.runInNewContext(
    fs.readFileSync(require.resolve("./main.js"), "utf8") +
        "\nmodule.exports = {parseHeadings, headingDepths, headingParents, outlineWidth, headingAtLine};",
    sandbox
);
const { parseHeadings, headingDepths, headingParents, outlineWidth, headingAtLine } = sandbox.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(parseHeadings([
    "---", "title: test", "# YAML, not a heading", "---",
    "# First", "## Child ##", "#### Deep", "## Child", "# Last",
].join("\n"))), [
    { title: "First", level: 1, line: 4 },
    { title: "Child", level: 2, line: 5 },
    { title: "Deep", level: 4, line: 6 },
    { title: "Child", level: 2, line: 7 },
    { title: "Last", level: 1, line: 8 },
]);
assert.deepEqual(plain(parseHeadings([
    "```js", "# No", "``", "## Still code", "```",
    "~~~", "# Not a heading", "~~~", "    # Indented code",
    "> # Quoted", "- # List heading", "#NoSpace", "####### Too deep",
    "Title", "===", "Section", "---", "", "---", "## Valid",
].join("\n"))), [
    { title: "Title", level: 1, line: 13 },
    { title: "Section", level: 2, line: 15 },
    { title: "Valid", level: 2, line: 19 },
]);
assert.deepEqual(plain(parseHeadings("## A\r\n### B")), [
    { title: "A", level: 2, line: 0 }, { title: "B", level: 3, line: 1 },
]);
assert.deepEqual(plain(headingDepths([{ level: 2 }, { level: 4 }, { level: 6 }, { level: 3 }, { level: 2 }])), [0, 1, 2, 1, 0]);
assert.deepEqual(plain(headingParents([{ level: 2 }, { level: 4 }, { level: 6 }, { level: 3 }, { level: 2 }])), [-1, 0, 1, 0, -1]);
assert.equal(outlineWidth(519), 0);
assert.equal(outlineWidth(520), 160);
assert.equal(outlineWidth(600), 240);
assert.equal(outlineWidth(1200), 240);
assert.equal(outlineWidth(1200, 320), 320);
assert.equal(outlineWidth(1200, 9999), 480);
assert.equal(outlineWidth(1200, -200), 160);
assert.equal(outlineWidth(600, 480), 240);
assert.equal(outlineWidth(1200, NaN), 240);
assert.equal(headingAtLine([], 0), -1);
const duplicate = parseHeadings("## Same\ntext\n## Same");
assert.equal(headingAtLine(duplicate, 0), 0);
assert.equal(headingAtLine(duplicate, 2.5), 1);
console.log("PASS heading parsing, fence exclusions, parent hierarchy, duplicate positions, and resize limits");
