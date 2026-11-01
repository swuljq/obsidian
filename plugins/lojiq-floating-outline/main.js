const { Plugin } = require("obsidian");

// Used for unsaved editor text; saved notes use Obsidian's Markdown cache.
function parseHeadings(text) {
    const lines = text.split(/\r?\n/);
    const headings = [];
    let fence = null;
    let frontmatter = lines[0]?.replace(/^\uFEFF/, "") === "---";
    let previousText = null;

    for (let line = 0; line < lines.length; line += 1) {
        const value = lines[line];
        if (frontmatter) {
            if (line > 0 && /^(---|\.\.\.)\s*$/.test(value)) frontmatter = false;
            continue;
        }
        if (fence) {
            const close = /^ {0,3}(`+|~+)\s*$/.exec(value);
            if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null;
            continue;
        }
        const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(value);
        if (opening && !(opening[1][0] === "`" && opening[2].includes("`"))) {
            fence = { char: opening[1][0], length: opening[1].length };
            previousText = null;
            continue;
        }
        const atx = /^ {0,3}(#{1,6})(?:[\t ]+(.*)|[\t ]*)$/.exec(value);
        if (atx) {
            headings.push({ title: (atx[2] || "").replace(/[\t ]+#+[\t ]*$/, "").trim(), level: atx[1].length, line });
            previousText = null;
            continue;
        }
        const setext = /^ {0,3}(=+|-+)\s*$/.exec(value);
        if (setext && previousText !== null) {
            headings.push({ title: previousText.title, level: setext[1][0] === "=" ? 1 : 2, line: previousText.line });
            previousText = null;
            continue;
        }
        previousText = value.trim() && !/^(?: {4}|\t| {0,3}(?:>|[-+*]\s|\d+[.)]\s))/.test(value)
            ? { title: value.trim(), line } : null;
    }
    return headings;
}

function headingDepths(headings) {
    const stack = [];
    return headings.map(heading => {
        while (stack.length && stack[stack.length - 1] >= heading.level) stack.pop();
        const depth = stack.length;
        stack.push(heading.level);
        return depth;
    });
}

function outlineWidth(paneWidth, requested = 240) {
    // Leave at least 360px for the note; small panes use the full width instead.
    const maximum = Math.min(480, Math.floor(paneWidth - 360));
    if (maximum < 160) return 0;
    const desired = Number.isFinite(requested) ? requested : 240;
    return Math.min(maximum, Math.max(160, Math.round(desired)));
}

function headingParents(headings) {
    const stack = [];
    return headings.map((heading, index) => {
        while (stack.length && headings[stack[stack.length - 1]].level >= heading.level) stack.pop();
        const parent = stack.length ? stack[stack.length - 1] : -1;
        stack.push(index);
        return parent;
    });
}

function headingAtLine(headings, line) {
    let index = 0;
    for (let i = 0; i < headings.length; i += 1) {
        if (headings[i].line > line) break;
        index = i;
    }
    return headings.length ? index : -1;
}

function headingAtViewport(headings, rendered, top, lineHint) {
    let current = null;
    for (const heading of rendered) {
        if (heading.top <= top + 48) current = heading;
    }
    if (!current) return -1;
    const candidates = [];
    for (let index = 0; index < headings.length; index += 1) {
        if (headings[index].title === current.title && headings[index].level === current.level) candidates.push(index);
    }
    if (!candidates.length) return -1;
    const occurrences = rendered.filter(heading => heading.title === current.title && heading.level === current.level);
    // Full rendering gives an exact occurrence match, even for identical titles.
    if (occurrences.length === candidates.length) return candidates[occurrences.indexOf(current)];
    // Virtualized reading sections may omit earlier occurrences of the same title.
    if (Number.isFinite(lineHint)) {
        return candidates.reduce((best, index) => Math.abs(headings[index].line - lineHint) < Math.abs(headings[best].line - lineHint) ? index : best);
    }
    return candidates[0];
}

class PaneOutline {
    constructor(plugin, view, host) {
        this.plugin = plugin;
        this.view = view;
        this.host = host;
        this.win = host.ownerDocument.defaultView;
        this.headings = [];
        this.buttons = [];
        this.items = [];
        this.foldButtons = [];
        this.collapsed = new Set();
        this.keys = [];
        this.parents = [];
        this.activeIndex = -1;
        this.signature = "";
        this.frame = 0;
        this.timer = 0;
        this.disposed = false;
        this.nav = host.ownerDocument.createElement("nav");
        this.nav.className = "lfo-outline";
        this.nav.setAttribute("aria-label", "笔记大纲");
        this.nav.hidden = true;
        this.list = host.ownerDocument.createElement("ol");
        this.nav.append(this.list);
        this.divider = host.ownerDocument.createElement("div");
        this.divider.className = "lfo-divider";
        this.divider.hidden = true;
        this.divider.tabIndex = 0;
        this.divider.setAttribute("role", "separator");
        this.divider.setAttribute("aria-orientation", "vertical");
        this.divider.setAttribute("aria-label", "拖动调整大纲宽度；双击恢复默认宽度");
        host.classList.add("lfo-host");
        host.append(this.nav, this.divider);

        this.onScroll = event => {
            if (!this.nav.contains(event.target)) this.schedule();
        };
        this.onScrollIntent = event => {
            if (this.nav.contains(event.target) || this.divider.contains(event.target)) return;
            if (event.type === "keydown" && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) return;
            this.navigationIndex = null;
            this.schedule();
        };
        this.onResize = () => this.schedule();
        this.onClick = event => {
            const fold = event.target.closest("button[data-fold-index]");
            if (fold && this.nav.contains(fold)) {
                this.toggleFold(Number(fold.dataset.foldIndex));
                return;
            }
            const button = event.target.closest("button[data-index]");
            if (button && this.nav.contains(button)) this.jump(Number(button.dataset.index));
        };
        this.onPointerDown = event => {
            if (event.button !== 0 || !event.isPrimary || this.divider.hidden) return;
            event.preventDefault();
            this.drag = { id: event.pointerId, x: event.clientX, width: this.width, requested: this.plugin.width };
            this.host.classList.add("lfo-resizing");
            this.divider.setPointerCapture(event.pointerId);
        };
        this.onPointerMove = event => {
            if (!this.drag || event.pointerId !== this.drag.id) return;
            const direction = this.win.getComputedStyle(this.host).direction === "rtl" ? -1 : 1;
            const width = outlineWidth(this.host.getBoundingClientRect().width, this.drag.width + (event.clientX - this.drag.x) * direction);
            if (width) this.plugin.setWidth(width);
        };
        this.onPointerUp = event => {
            if (this.drag?.id === event.pointerId) this.endResize(true);
        };
        this.onPointerCancel = event => {
            if (this.drag?.id === event.pointerId) this.endResize(false);
        };
        this.onLostCapture = () => this.endResize(true);
        this.onBlur = () => this.endResize(true);
        this.onDividerKey = event => {
            if (event.key === "Escape" && this.drag) {
                event.preventDefault();
                this.endResize(false);
                return;
            }
            const direction = this.win.getComputedStyle(this.host).direction === "rtl" ? -1 : 1;
            let requested;
            if (event.key === "ArrowLeft") requested = this.width - 16 * direction;
            else if (event.key === "ArrowRight") requested = this.width + 16 * direction;
            else if (event.key === "Home") requested = 160;
            else if (event.key === "End") requested = 480;
            else return;
            event.preventDefault();
            const width = outlineWidth(this.host.getBoundingClientRect().width, requested);
            if (width) {
                this.plugin.setWidth(width);
                void this.plugin.saveSettings();
            }
        };
        this.onResetWidth = () => {
            this.plugin.setWidth(240);
            void this.plugin.saveSettings();
        };
        this.nav.addEventListener("click", this.onClick);
        this.divider.addEventListener("pointerdown", this.onPointerDown);
        this.divider.addEventListener("pointermove", this.onPointerMove);
        this.divider.addEventListener("pointerup", this.onPointerUp);
        this.divider.addEventListener("pointercancel", this.onPointerCancel);
        this.divider.addEventListener("lostpointercapture", this.onLostCapture);
        this.divider.addEventListener("keydown", this.onDividerKey);
        this.divider.addEventListener("dblclick", this.onResetWidth);
        host.addEventListener("scroll", this.onScroll, true);
        for (const type of ["wheel", "touchmove", "pointerdown", "keydown"]) host.addEventListener(type, this.onScrollIntent, { capture: true, passive: true });
        this.win.addEventListener("resize", this.onResize);
        this.win.addEventListener("blur", this.onBlur);
        this.resizeObserver = new this.win.ResizeObserver(() => this.schedule());
        this.resizeObserver.observe(host);
        this.mutationObserver = new this.win.MutationObserver(records => {
            if (records.some(record => !this.nav.contains(record.target) && record.target !== this.divider)) {
                if (this.mode !== this.view.getMode()) this.refresh();
                else this.schedule();
            }
        });
        this.mutationObserver.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
        this.refresh();
    }

    refreshLater() {
        this.win.clearTimeout(this.timer);
        this.timer = this.win.setTimeout(() => this.refresh(), 120);
    }

    refresh() {
        if (this.disposed) return;
        const file = this.view.file;
        if (this.mode !== this.view.getMode()) this.navigationIndex = null;
        if (this.filePath !== file?.path) {
            this.filePath = file?.path;
            this.collapsed.clear();
        }
        const editing = this.view.getMode() === "source";
        this.mode = this.view.getMode();
        const cached = file ? this.plugin.app.metadataCache.getFileCache(file)?.headings : null;
        const headings = editing && this.view.editor
            ? parseHeadings(this.view.editor.getValue())
            : (cached || []).map(heading => ({ title: heading.heading, level: heading.level, line: heading.position.start.line }));
        const signature = JSON.stringify([file?.path, headings]);
        if (signature !== this.signature) {
            this.signature = signature;
            this.headings = headings;
            this.render();
        }
        this.schedule();
    }

    render() {
        this.navigationIndex = null;
        const document = this.host.ownerDocument;
        const fragment = document.createDocumentFragment();
        const depths = headingDepths(this.headings);
        this.parents = headingParents(this.headings);
        this.items = [];
        this.foldButtons = [];
        const occurrences = new Map();
        this.keys = this.headings.map(heading => {
            const base = JSON.stringify([heading.level, heading.title]);
            const count = occurrences.get(base) || 0;
            occurrences.set(base, count + 1);
            return `${base}:${count}`;
        });
        this.collapsed = new Set([...this.collapsed].filter(key => this.keys.includes(key)));
        this.buttons = this.headings.map((heading, index) => {
            const item = document.createElement("li");
            item.className = "lfo-item";
            item.dataset.depth = depths[index];
            item.style.setProperty("--lfo-depth", depths[index]);
            if (this.headings[index + 1]?.level > heading.level) {
                item.classList.add("lfo-has-children");
                const fold = document.createElement("button");
                fold.type = "button";
                fold.className = "lfo-fold";
                fold.dataset.foldIndex = index;
                item.append(fold);
                this.foldButtons[index] = fold;
            }
            const button = document.createElement("button");
            button.type = "button";
            button.className = "lfo-heading";
            button.dataset.index = index;
            button.textContent = heading.title || "无标题";
            button.setAttribute("aria-label", `${heading.level} 级标题：${heading.title || "无标题"}`);
            item.append(button);
            fragment.append(item);
            this.items.push(item);
            return button;
        });
        this.list.replaceChildren(fragment);
        this.activeIndex = -1;
        this.applyFolds();
    }

    toggleFold(index) {
        const key = this.keys[index];
        if (this.collapsed.has(key)) this.collapsed.delete(key);
        else this.collapsed.add(key);
        this.applyFolds();
        this.activeIndex = -1;
        this.schedule();
    }

    applyFolds() {
        for (let index = 0; index < this.items.length; index += 1) {
            const parent = this.parents[index];
            this.items[index].hidden = parent >= 0 && (this.items[parent].hidden || this.collapsed.has(this.keys[parent]));
            const fold = this.foldButtons[index];
            if (fold) {
                const collapsed = this.collapsed.has(this.keys[index]);
                fold.setAttribute("aria-expanded", String(!collapsed));
                fold.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"}：${this.headings[index].title}`);
            }
        }
    }

    endResize(save) {
        if (!this.drag) return;
        const drag = this.drag;
        this.drag = null;
        this.host.classList.remove("lfo-resizing");
        if (this.divider.hasPointerCapture(drag.id)) this.divider.releasePointerCapture(drag.id);
        if (this.disposed) return;
        if (save) void this.plugin.saveSettings();
        else this.plugin.setWidth(drag.requested);
    }

    schedule() {
        if (this.disposed || this.frame) return;
        this.frame = this.win.requestAnimationFrame(() => {
            this.frame = 0;
            this.updateLayout();
            this.updateActive();
        });
    }

    updateLayout() {
        // Mode switches can replace the host's children without replacing the host.
        if (this.nav.parentNode !== this.host) this.host.append(this.nav);
        if (this.divider.parentNode !== this.host) this.host.append(this.divider);
        const editing = this.view.getMode() === "source";
        const sizer = this.host.querySelector(editing
            ? ".markdown-source-view .cm-content"
            : ".markdown-preview-view .markdown-preview-sizer");
        if (this.sizer !== sizer) {
            if (this.sizer) this.resizeObserver.unobserve(this.sizer);
            this.sizer = sizer;
            if (sizer) this.resizeObserver.observe(sizer);
        }
        const bounds = this.host.getBoundingClientRect();
        let width = 0;
        if (sizer && bounds.width && bounds.height && this.headings.length && !this.plugin.hidden) {
            width = outlineWidth(bounds.width, this.plugin.width);
        }
        this.width = width;
        if (!width && this.drag) this.endResize(true);
        this.nav.hidden = width === 0;
        this.divider.hidden = width === 0;
        if (this.host.classList.contains("lfo-docked") !== Boolean(width)) this.host.classList.toggle("lfo-docked", Boolean(width));
        if (width) {
            const value = `${width}px`;
            if (this.host.style.getPropertyValue("--lfo-pane-width") !== value) this.host.style.setProperty("--lfo-pane-width", value);
            this.divider.setAttribute("aria-valuemin", "160");
            this.divider.setAttribute("aria-valuemax", String(outlineWidth(bounds.width, 480)));
            this.divider.setAttribute("aria-valuenow", String(width));
        } else if (this.host.style.getPropertyValue("--lfo-pane-width")) {
            this.host.style.removeProperty("--lfo-pane-width");
        }
    }

    updateActive() {
        if (this.nav.hidden || !this.headings.length) return;
        // A native jump can emit a logical scroll line just before its target.
        // Keep the clicked entry selected until the next user scroll gesture.
        if (this.navigationIndex != null) {
            this.setActive(this.navigationIndex);
            return;
        }
        const scroll = this.view.getEphemeralState?.()?.scroll;
        let index = -1;
        if (this.view.getMode() === "preview") {
            const root = this.host.querySelector(".markdown-preview-view");
            const rendered = [];
            for (const element of root?.querySelectorAll("h1, h2, h3, h4, h5, h6") || []) {
                if (element.closest(".markdown-embed")) continue;
                const rect = element.getBoundingClientRect();
                if (!rect.height || !rect.width) continue;
                rendered.push({ title: element.getAttribute("data-heading") || element.textContent, level: Number(element.tagName[1]), top: rect.top });
            }
            index = headingAtViewport(this.headings, rendered, root?.getBoundingClientRect().top || 0, scroll);
        }
        if (index >= 0) {
            this.setActive(index);
            return;
        }
        // The logical line is a fallback for unrendered/virtualized sections.
        if (typeof scroll === "number" && Number.isFinite(scroll)) {
            index = headingAtLine(this.headings, scroll);
        } else if (this.view.getMode() === "source" && this.view.editor) {
            const scroller = this.host.querySelector(".cm-scroller");
            const rect = scroller?.getBoundingClientRect();
            const pos = rect && this.view.editor.posAtCoords?.({ left: this.sizer.getBoundingClientRect().left + 4, top: rect.top + 24 });
            index = headingAtLine(this.headings, pos?.line ?? this.view.editor.getCursor().line);
        } else {
            index = this.activeIndex >= 0 ? this.activeIndex : 0;
        }
        this.setActive(index);
    }

    setActive(index) {
        while (index >= 0 && this.items[index]?.hidden) index = this.parents[index];
        if (this.activeIndex === index) return;
        for (let i = 0; i < this.buttons.length; i += 1) {
            this.buttons[i].classList.toggle("is-active", i === index);
            if (i === index) this.buttons[i].setAttribute("aria-current", "location");
            else this.buttons[i].removeAttribute("aria-current");
        }
        this.activeIndex = index;
        const button = this.buttons[index];
        if (button) {
            const outer = this.nav.getBoundingClientRect();
            const inner = button.getBoundingClientRect();
            if (inner.top < outer.top) this.nav.scrollTop -= outer.top - inner.top;
            else if (inner.bottom > outer.bottom) this.nav.scrollTop += inner.bottom - outer.bottom;
        }
    }

    jump(index) {
        const heading = this.headings[index];
        if (!heading) return;
        this.navigationIndex = index;
        if (this.view.getMode() === "source" && this.view.editor) {
            const position = { line: heading.line, ch: 0 };
            this.view.editor.setCursor(position);
            this.view.editor.scrollIntoView({ from: position, to: position }, true);
            this.view.editor.focus();
        } else {
            this.view.setEphemeralState({ line: heading.line });
        }
        this.setActive(index);
    }

    destroy() {
        this.disposed = true;
        this.endResize(false);
        this.win.clearTimeout(this.timer);
        if (this.frame) this.win.cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.mutationObserver.disconnect();
        this.win.removeEventListener("resize", this.onResize);
        this.win.removeEventListener("blur", this.onBlur);
        this.host.removeEventListener("scroll", this.onScroll, true);
        for (const type of ["wheel", "touchmove", "pointerdown", "keydown"]) this.host.removeEventListener(type, this.onScrollIntent, true);
        this.nav.removeEventListener("click", this.onClick);
        this.divider.removeEventListener("pointerdown", this.onPointerDown);
        this.divider.removeEventListener("pointermove", this.onPointerMove);
        this.divider.removeEventListener("pointerup", this.onPointerUp);
        this.divider.removeEventListener("pointercancel", this.onPointerCancel);
        this.divider.removeEventListener("lostpointercapture", this.onLostCapture);
        this.divider.removeEventListener("keydown", this.onDividerKey);
        this.divider.removeEventListener("dblclick", this.onResetWidth);
        this.nav.remove();
        this.divider.remove();
        this.host.classList.remove("lfo-host", "lfo-docked", "lfo-resizing");
        this.host.style.removeProperty("--lfo-pane-width");
    }
}

module.exports = class FloatingOutlinePlugin extends Plugin {
    async onload() {
        this.panes = new Map();
        this.disposed = false;
        const data = await this.loadData();
        if (this.disposed) return;
        this.hidden = data?.hidden === true;
        this.width = outlineWidth(10000, data?.width);
        this.addCommand({
            id: "toggle-floating-outline",
            name: "显示／隐藏笔记左侧大纲",
            callback: async () => {
                this.hidden = !this.hidden;
                for (const pane of this.panes.values()) pane.schedule();
                await this.saveSettings();
            },
        });
        this.registerEvent(this.app.workspace.on("layout-change", () => this.syncPanes()));
        this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.syncPanes()));
        this.registerEvent(this.app.workspace.on("file-open", () => this.syncPanes()));
        this.registerEvent(this.app.workspace.on("editor-change", (editor, view) => {
            this.panes.get(view)?.refreshLater();
        }));
        this.registerEvent(this.app.metadataCache.on("changed", file => {
            for (const pane of this.panes.values()) {
                if (pane.view.file?.path === file.path) pane.refresh();
            }
        }));
        this.app.workspace.onLayoutReady(() => this.syncPanes());
    }

    setWidth(width) {
        this.width = outlineWidth(10000, width);
        for (const pane of this.panes.values()) pane.schedule();
    }

    async saveSettings() {
        try {
            await this.saveData({ hidden: this.hidden, width: this.width });
        } catch (error) {
            console.error("lojiq Floating Outline: failed to save settings", error);
        }
    }

    syncPanes() {
        if (this.disposed) return;
        const views = new Set();
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            const host = view.containerEl.querySelector(".view-content");
            if (!host || !view.file || typeof view.getMode !== "function") continue;
            views.add(view);
            if (this.panes.has(view) && this.panes.get(view).host !== host) {
                this.panes.get(view).destroy();
                this.panes.delete(view);
            }
            if (!this.panes.has(view)) this.panes.set(view, new PaneOutline(this, view, host));
            else this.panes.get(view).refresh();
        }
        for (const [view, pane] of this.panes) {
            if (!views.has(view)) {
                pane.destroy();
                this.panes.delete(view);
            }
        }
    }

    onunload() {
        this.disposed = true;
        for (const pane of this.panes.values()) pane.destroy();
        this.panes.clear();
    }
};
