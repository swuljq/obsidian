const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function fixture(mode = "source") {
    const notices = [];
    class MarkdownView {}
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve("./main.js"), "utf8"), {
        module,
        require(name) {
            assert.equal(name, "obsidian");
            return {
                Plugin: class {},
                MarkdownView,
                Notice: class { constructor(message) { notices.push(message); } }
            };
        }
    });

    const scroller = { scrollTop: 8900, scrollLeft: 27, mode };
    const embed = { getAttribute: name => name === "src" ? "example.png" : null };
    const image = {
        closest: selector => selector.includes(".internal-embed") ? embed : scroller,
        getAttribute: () => null
    };
    const original = "Paragraph\n".repeat(400) + "![[example.png|100]]\nEnd";
    const state = { text: original, dispatches: [], leaves: [] };
    const editor = {
        getValue: () => state.text,
        getCursor: () => ({ line: 0, ch: 0 }),
        replaceRange() { assert.fail("replaceRange would scroll to the off-screen cursor"); },
        cm: {
            dispatch(transaction) {
                state.dispatches.push(transaction);
                const { from, to, insert } = transaction.changes;
                state.text = state.text.slice(0, from) + insert + state.text.slice(to);
                // Exercise the snapshot restore even if layout synchronously changes scroll.
                scroller.scrollTop = 0;
                scroller.scrollLeft = 0;
            }
        }
    };
    const owner = Object.assign(new MarkdownView(), {
        containerEl: { contains: element => element === image },
        file: { path: "owner.md" },
        editor
    });
    const other = Object.assign(new MarkdownView(), {
        containerEl: { contains: () => false },
        file: { path: "other.md" },
        editor: { getValue() { assert.fail("Another pane must not be edited"); } }
    });
    state.leaves = [{ view: other }, { view: owner }];
    const plugin = new module.exports();
    plugin.app = { workspace: {
        getLeavesOfType(type) {
            assert.equal(type, "markdown");
            return state.leaves;
        },
        getActiveViewOfType() { assert.fail("Use the image owner, not the active pane"); }
    } };
    return { plugin, image, scroller, state, editor, original, notices };
}

for (const mode of ["source", "reading"]) {
    test(`save width without cursor scrolling and preserve ${mode} viewport`, async () => {
        const f = fixture(mode);
        await f.plugin.persistWidth(f.image, 240);
        assert.equal(f.state.text, f.original.replace("|100]]", "|240]]"));
        assert.equal(f.state.dispatches.length, 1);
        assert.equal(f.state.dispatches[0].scrollIntoView, false);
        assert.equal(f.state.dispatches[0].userEvent, "input.image-resize");
        assert.equal(f.scroller.scrollTop, 8900);
        assert.equal(f.scroller.scrollLeft, 27);
        assert.equal(f.editor.getCursor().line, 0);
        assert.equal(f.notices.length, 0);
    });
}

test("save standard Markdown image width in the owning pane", async () => {
    const f = fixture();
    f.state.text = "Paragraph\n".repeat(400) + "![caption|100](example.png)";
    await f.plugin.persistWidth(f.image, 320);
    assert(f.state.text.endsWith("![caption|320](example.png)"));
    assert.equal(f.scroller.scrollTop, 8900);
});

test("do not edit a different note when the image has no owning view", async () => {
    const f = fixture();
    f.state.leaves.pop();
    await f.plugin.persistWidth(f.image, 240);
    assert.equal(f.state.dispatches.length, 0);
    assert.equal(f.notices.length, 1);
});

test("do not change content or viewport if the image reference is absent", async () => {
    const f = fixture();
    f.state.text = "No matching image";
    await f.plugin.persistWidth(f.image, 240);
    assert.equal(f.state.dispatches.length, 0);
    assert.equal(f.state.text, "No matching image");
    assert.equal(f.scroller.scrollTop, 8900);
    assert.equal(f.notices.length, 1);
});
