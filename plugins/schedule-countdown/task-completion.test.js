const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("./main.js"), "utf8");
const sandbox = {
    console,
    module: { exports: {} },
    exports: {},
    require(id) {
        if (id === "obsidian") {
            return { Plugin: class {}, Modal: class {}, Notice: class {} };
        }
        return require(id);
    },
};

vm.runInNewContext(
    `${source}\nmodule.exports = { applyTaskTransitions, formatCompletionTime, parseTaskStates };`,
    sandbox,
    { filename: "main.js" }
);

const { applyTaskTransitions, formatCompletionTime, parseTaskStates } =
    sandbox.module.exports;

const timestamp = "2026-09-20 14:35";

let before = "- [ ] 普通任务\n* [x] 已完成旧任务\n+ [ ] 带倒计时 `countdown:2026-09-20~2026-09-24`";
let after = "- [x] 普通任务\n* [x] 已完成旧任务\n+ [X] 带倒计时 `countdown:2026-09-20~2026-09-24`";
let result = applyTaskTransitions(parseTaskStates(before), after, timestamp);

assert.equal(result.changed, true);
assert.equal(
    result.content,
    "- [x] 普通任务 ✅ 2026-09-20 14:35\n" +
        "* [x] 已完成旧任务\n" +
        "+ [X] 带倒计时 `countdown:2026-09-20~2026-09-24` ✅ 2026-09-20 14:35"
);

before = result.content;
after = before.replace("- [x] 普通任务", "- [ ] 普通任务");
result = applyTaskTransitions(parseTaskStates(before), after, "2026-09-20 15:00");
assert.equal(result.changed, true);
assert.equal(result.content.split("\n")[0], "- [ ] 普通任务");

before = "- [ ] 不应错配";
after = "新增一行\n- [x] 不应错配";
result = applyTaskTransitions(parseTaskStates(before), after, timestamp);
assert.equal(result.changed, false);

before = "- [x] 插件启用前已完成";
result = applyTaskTransitions(parseTaskStates(before), before, timestamp);
assert.equal(result.changed, false);

assert.equal(
    formatCompletionTime(new Date(2026, 8, 20, 4, 5)),
    "2026-09-20 04:05"
);

console.log("task completion tests passed");
