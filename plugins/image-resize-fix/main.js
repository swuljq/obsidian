const { Plugin, MarkdownView, Notice } = require("obsidian");

module.exports = class ImageResizeFixPlugin extends Plugin {
    onload() {
        this.resizeState = null;

        this.onWindowPointerDown = (event) => this.handlePointerDown(event);
        this.onWindowClick = (event) => this.handleImageClick(event);
        this.onWindowDoubleClick = (event) => this.handleImageClick(event);
        this.onWindowDragStart = (event) => this.handleDragStart(event);

        // Capture phase: intercept Obsidian's native resize interaction first.
        window.addEventListener("pointerdown", this.onWindowPointerDown, true);
        window.addEventListener("click", this.onWindowClick, true);
        window.addEventListener("dblclick", this.onWindowDoubleClick, true);
        window.addEventListener("dragstart", this.onWindowDragStart, true);

        this.register(() => {
            window.removeEventListener("pointerdown", this.onWindowPointerDown, true);
            window.removeEventListener("click", this.onWindowClick, true);
            window.removeEventListener("dblclick", this.onWindowDoubleClick, true);
            window.removeEventListener("dragstart", this.onWindowDragStart, true);
        });
    }

    onunload() {
        this.cleanupActiveResize();
    }

    isMarkdownImageWrapper(wrapper) {
        if (!(wrapper instanceof HTMLElement)) return false;

        // Only touch images embedded inside Markdown notes.
        // Do NOT touch image-file tabs, side panes, thumbnails, etc.
        return Boolean(
            wrapper.closest(
                ".markdown-source-view.mod-cm6, .markdown-preview-view, .markdown-rendered"
            )
        );
    }

    handleDragStart(event) {
        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;

        const wrapper = target.closest(".image-wrapper");
        if (!this.isMarkdownImageWrapper(wrapper)) return;

        event.preventDefault();
    }

    handleImageClick(event) {
        if (this.resizeState) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            return;
        }

        const target = event.target;
        if (!(target instanceof HTMLImageElement)) return;

        const wrapper = target.closest(".image-wrapper");
        if (!this.isMarkdownImageWrapper(wrapper)) return;

        // Disable click-to-lightbox on the image body only.
        // Native toolbar buttons (magnifier / edit block) are separate
        // elements, so they remain usable.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    handlePointerDown(event) {
        if (event.button !== 0) return;

        const target = event.target;
        if (!(target instanceof Element)) return;

        const corner = target.closest(".image-resize-corner");
        if (!corner) return;

        const wrapper = corner.closest(".image-wrapper");
        if (!this.isMarkdownImageWrapper(wrapper)) return;

        const image = wrapper.querySelector("img");
        if (!(image instanceof HTMLImageElement)) return;

        // Fully take over the native resize handle.
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        this.beginResize(event, wrapper, image, corner);
    }

    beginResize(event, wrapper, image, corner) {
        this.cleanupActiveResize();

        const rect = image.getBoundingClientRect();
        if (!rect.width) return;

        const state = {
            wrapper,
            image,
            corner,
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: rect.width,
            currentWidth: Math.round(rect.width),
            moved: false,
            onMove: null,
            onUp: null
        };

        this.resizeState = state;
        wrapper.classList.add("irq-resizing");

        try {
            corner.setPointerCapture(event.pointerId);
        } catch (_) {
            // Window-level listeners below are sufficient.
        }

        state.onMove = (moveEvent) => {
            if (!this.resizeState || moveEvent.pointerId !== state.pointerId) return;

            moveEvent.preventDefault();
            moveEvent.stopPropagation();
            moveEvent.stopImmediatePropagation();

            const deltaX = moveEvent.clientX - state.startX;
            if (Math.abs(deltaX) >= 1) state.moved = true;

            let width = Math.round(state.startWidth + deltaX);
            width = Math.max(80, width);

            const noteContainer =
                wrapper.closest(".markdown-preview-sizer") ||
                wrapper.closest(".cm-content") ||
                wrapper.closest(".markdown-rendered");

            if (noteContainer) {
                const containerRect = noteContainer.getBoundingClientRect();
                if (containerRect.width > 0) {
                    width = Math.min(width, Math.floor(containerRect.width));
                }
            }

            state.currentWidth = width;

            // Update both forms so the picture follows the pointer immediately.
            image.setAttribute("width", String(width));
            image.style.width = `${width}px`;
            image.style.height = "auto";
        };

        state.onUp = async (upEvent) => {
            if (!this.resizeState || upEvent.pointerId !== state.pointerId) return;

            upEvent.preventDefault();
            upEvent.stopPropagation();
            upEvent.stopImmediatePropagation();

            const finalWidth = state.currentWidth;
            const didMove = state.moved;

            this.cleanupActiveResize();

            if (didMove) {
                await this.persistWidth(image, finalWidth);
            }
        };

        window.addEventListener("pointermove", state.onMove, true);
        window.addEventListener("pointerup", state.onUp, true);
        window.addEventListener("pointercancel", state.onUp, true);
    }

    cleanupActiveResize() {
        const state = this.resizeState;
        if (!state) return;

        if (state.onMove) {
            window.removeEventListener("pointermove", state.onMove, true);
        }
        if (state.onUp) {
            window.removeEventListener("pointerup", state.onUp, true);
            window.removeEventListener("pointercancel", state.onUp, true);
        }

        if (state.wrapper) {
            state.wrapper.classList.remove("irq-resizing");
        }

        this.resizeState = null;
    }

    async persistWidth(image, width) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view || !view.file || !view.editor) {
            new Notice("Image Resize Fix：没有找到当前 Markdown 编辑器");
            return;
        }

        const editor = view.editor;
        const text = editor.getValue();
        const fileName = this.getImageFileName(image);
        const cursorOffset = this.positionToOffset(text, editor.getCursor());
        const match = this.findBestImageMatch(text, fileName, width, cursorOffset);

        if (!match) {
            new Notice("Image Resize Fix：没有定位到当前图片的 Markdown 引用");
            return;
        }

        editor.replaceRange(
            match.replacement,
            this.offsetToPosition(text, match.start),
            this.offsetToPosition(text, match.end)
        );
    }

    getImageFileName(image) {
        const values = [];
        const embed = image.closest(".internal-embed, .image-embed");

        if (embed) {
            values.push(embed.getAttribute("src"));
            values.push(embed.getAttribute("data-src"));
        }

        values.push(image.getAttribute("alt"));
        values.push(image.getAttribute("src"));

        for (const value of values) {
            const base = this.extractBaseName(value);
            if (base) return base;
        }

        return "";
    }

    extractBaseName(value) {
        if (!value) return "";

        let text = String(value).trim();
        if (!text) return "";

        try {
            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(text)) {
                const url = new URL(text);
                text = decodeURIComponent(url.pathname || "");
            } else {
                text = decodeURIComponent(text);
            }
        } catch (_) {
            try {
                text = decodeURIComponent(text);
            } catch (_) {}
        }

        text = text.split("?")[0].split("#")[0];
        text = text.replace(/^<|>$/g, "");
        const parts = text.split(/[\\/]/);
        return (parts[parts.length - 1] || "").trim();
    }

    normalizeName(value) {
        return this.extractBaseName(value).toLowerCase();
    }

    findBestImageMatch(text, fileName, width, cursorOffset) {
        const wanted = this.normalizeName(fileName);
        const candidates = [];
        let match;

        // Obsidian wiki embeds: ![[image.png]] / ![[image.png|499]]
        const wikiRegex = /!\[\[([^\]\n]+)\]\]/g;
        while ((match = wikiRegex.exec(text)) !== null) {
            const inner = match[1];
            const parts = inner.split("|");
            const path = parts[0].trim();

            if (wanted && this.normalizeName(path) !== wanted) continue;

            let replacement;
            if (parts.length === 1) {
                replacement = `![[${path}|${width}]]`;
            } else {
                const last = parts[parts.length - 1].trim();
                if (/^\d+(?:x\d+)?$/i.test(last)) {
                    parts[parts.length - 1] = String(width);
                    replacement = `![[${parts.join("|")}]]`;
                } else {
                    replacement = `![[${path}|${width}]]`;
                }
            }

            candidates.push({
                start: match.index,
                end: match.index + match[0].length,
                replacement
            });
        }

        // Standard Markdown images: ![alt](path)
        const markdownRegex = /!\[([^\]\n]*)\]\(([^)\n]+)\)/g;
        while ((match = markdownRegex.exec(text)) !== null) {
            const alt = match[1];
            const destination = match[2].trim();

            let compareDestination = destination;
            const angle = destination.match(/^<([^>]+)>/);
            if (angle) {
                compareDestination = angle[1];
            } else {
                compareDestination = destination.split(/\s+["']/)[0];
            }

            if (wanted && this.normalizeName(compareDestination) !== wanted) continue;

            const altParts = alt.split("|");
            const lastAlt = altParts[altParts.length - 1].trim();
            if (/^\d+(?:x\d+)?$/i.test(lastAlt)) {
                altParts[altParts.length - 1] = String(width);
            } else {
                altParts.push(String(width));
            }

            candidates.push({
                start: match.index,
                end: match.index + match[0].length,
                replacement: `![${altParts.join("|")}](${destination})`
            });
        }

        if (candidates.length === 0) return null;

        candidates.sort(
            (a, b) =>
                Math.abs(a.start - cursorOffset) -
                Math.abs(b.start - cursorOffset)
        );

        return candidates[0];
    }

    positionToOffset(text, pos) {
        const lines = text.split("\n");
        let offset = 0;

        for (let i = 0; i < pos.line && i < lines.length; i++) {
            offset += lines[i].length + 1;
        }

        return offset + pos.ch;
    }

    offsetToPosition(text, offset) {
        const before = text.slice(0, offset);
        const lines = before.split("\n");
        return {
            line: lines.length - 1,
            ch: lines[lines.length - 1].length
        };
    }
};
