const { Plugin } = require('obsidian');

const RENDERED_BLOCK_LANGUAGES = new Set([
    'mermaid',
    'table',
    'dataview',
    'dataviewjs',
    'query',
    'tasks',
]);

module.exports = class CodeTitleFencePlugin extends Plugin {
    onload() {
        this._observers = new Set();
        this._resizeObservers = new Set();

        const processor = this.registerMarkdownPostProcessor((el) => {
            const codeBlocks = el.querySelectorAll('pre > code');

            for (const code of codeBlocks) {
                this.decorateCodeBlock(code);
            }
        });

        // Run early so "language-python:main.py" can be normalized to
        // "language-python" before Obsidian finishes syntax highlighting.
        processor.sortOrder = -1000;
    }

    onunload() {
        for (const observer of this._observers) {
            observer.disconnect();
        }
        this._observers.clear();

        for (const observer of this._resizeObservers) {
            observer.disconnect();
        }
        this._resizeObservers.clear();
    }

    decorateCodeBlock(code) {
        const pre = code.parentElement;
        if (!pre || pre.tagName !== 'PRE') return;
        if (pre.dataset.ctfProcessed === '1') return;

        const languageClass = this.findLanguageClass(code, pre);
        if (!languageClass) return;

        const rawInfo = languageClass.slice('language-'.length).trim();
        if (!rawInfo) return;

        const parsed = this.parseFenceInfo(rawInfo);
        if (!parsed.language) return;
        if (RENDERED_BLOCK_LANGUAGES.has(parsed.language.toLowerCase())) return;

        this.normalizeLanguageClass(code, pre, languageClass, parsed.language);

        const parent = pre.parentNode;
        if (!parent) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'ctf-code-block';
        if (parsed.title) wrapper.classList.add('ctf-has-title');

        parent.insertBefore(wrapper, pre);

        if (parsed.title) {
            const titleBar = document.createElement('div');
            titleBar.className = 'ctf-code-title';

            const titleText = document.createElement('span');
            titleText.className = 'ctf-code-title-name';
            titleText.textContent = parsed.title;

            titleBar.appendChild(titleText);
            wrapper.appendChild(titleBar);
        }

        const body = document.createElement('div');
        body.className = 'ctf-code-body';
        wrapper.appendChild(body);

        const gutter = document.createElement('div');
        gutter.className = 'ctf-line-numbers';
        gutter.setAttribute('aria-hidden', 'true');
        body.appendChild(gutter);
        body.appendChild(pre);

        pre.classList.add('ctf-has-line-numbers');
        pre.dataset.ctfProcessed = '1';
        pre.dataset.codeLanguage = parsed.language;
        if (parsed.title) pre.dataset.codeTitle = parsed.title;

        this.watchRenderedCode(pre, body, gutter);
    }

    watchRenderedCode(pre, body, gutter) {
        let rafId = 0;

        const refresh = () => {
            rafId = 0;
            if (!pre.isConnected || !body.isConnected) return;

            const currentCode = pre.querySelector('code');
            if (!currentCode) return;

            this.relocateCopyButton(pre, body);
            this.syncCodeMetrics(currentCode, pre, body);
            this.updateLineNumberGutter(currentCode, pre, gutter);
        };

        const scheduleRefresh = () => {
            if (rafId) return;
            rafId = requestAnimationFrame(refresh);
        };

        // Obsidian can replace/highlight descendants after the Markdown
        // postprocessor has run. Observe all DOM changes inside the <pre>.
        const mutationObserver = new MutationObserver(scheduleRefresh);
        mutationObserver.observe(pre, {
            childList: true,
            subtree: true,
            characterData: true,
        });
        this._observers.add(mutationObserver);

        // The rendered height can also change without a text mutation
        // (font/CSS/theme/layout changes). Recalculate when that happens.
        if (typeof ResizeObserver !== 'undefined') {
            const resizeObserver = new ResizeObserver(scheduleRefresh);
            resizeObserver.observe(pre);
            this._resizeObservers.add(resizeObserver);
        }

        // Keep the language badge visually anchored while only the code column
        // scrolls horizontally. The badge itself is still provided by the
        // user's existing code-style.css pseudo-element.
        this.registerDomEvent(pre, 'scroll', () => {
            pre.style.setProperty('--ctf-scroll-left', `${pre.scrollLeft}px`);
        });

        // Syntax highlighting can finish over several render turns.
        scheduleRefresh();
        requestAnimationFrame(scheduleRefresh);
        window.setTimeout(scheduleRefresh, 80);
        window.setTimeout(scheduleRefresh, 250);
        window.setTimeout(scheduleRefresh, 600);
    }


    relocateCopyButton(pre, body) {
        // Obsidian places the native copy button inside <pre>. Since v1.1.5
        // only the PRE/code column scrolls horizontally, leaving the button
        // there makes it travel with the scrollable content. Move the actual
        // native button (without cloning it) to the fixed body layer so its
        // existing click handler is preserved and it stays at the visible
        // top-right corner.
        const selector = [
            '.copy-code-button',
            'button[aria-label*="Copy"]',
            'button[aria-label*="copy"]',
            'button[aria-label*="复制"]',
        ].join(', ');

        const candidate = pre.querySelector(selector);
        const existing = body.querySelector(':scope > .ctf-copy-button');

        if (!candidate) return;

        if (existing && existing !== candidate) {
            existing.remove();
        }

        candidate.classList.add('ctf-copy-button');
        body.appendChild(candidate);
    }

    updateLineNumberGutter(code, pre, gutter) {
        // v1.1.3: source/DOM text is authoritative for line numbering.
        // Height-derived counting is only a last-resort fallback because
        // padding, borders, badges, or theme CSS can otherwise over-count.
        const textContentCount = this.countLines(code.textContent || '');
        const innerTextCount = this.countLines(code.innerText || '');

        // v1.1.4: code blocks are forced to no-wrap in styles.css, so each
        // rendered row corresponds to one source row. Use rendered height as
        // an additional safety net for DOM/highlighter cases where line breaks
        // are not fully represented in textContent/innerText.
        const renderedCount = this.estimateRenderedLineCount(code, pre);

        const lineCount = Math.max(
            1,
            textContentCount,
            innerTextCount,
            renderedCount
        );

        if (Number(gutter.dataset.lineCount) === lineCount) return;

        const fragment = document.createDocumentFragment();

        for (let i = 1; i <= lineCount; i += 1) {
            const number = document.createElement('span');
            number.className = 'ctf-line-number';
            number.textContent = String(i);
            fragment.appendChild(number);
        }

        gutter.replaceChildren(fragment);
        gutter.dataset.lineCount = String(lineCount);
    }

    countLines(text) {
        if (!text) return 1;

        const normalized = text
            .replace(/\r\n?/g, '\n')
            .replace(/[\u2028\u2029]/g, '\n');

        const lines = normalized.split('\n');

        // A final fence newline is not another visible source line.
        if (lines.length > 1 && lines[lines.length - 1] === '') {
            lines.pop();
        }

        return Math.max(lines.length, 1);
    }

    estimateRenderedLineCount(code, pre) {
        const preStyle = getComputedStyle(pre);
        const codeStyle = getComputedStyle(code);

        const fontSize = parseFloat(codeStyle.fontSize) || 16;
        const preLineHeight = parseFloat(preStyle.lineHeight);
        const codeLineHeight = parseFloat(codeStyle.lineHeight);

        let lineHeight = Math.max(
            Number.isFinite(preLineHeight) ? preLineHeight : 0,
            Number.isFinite(codeLineHeight) ? codeLineHeight : 0
        );

        if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
            lineHeight = fontSize * 1.65;
        }

        const paddingTop = parseFloat(preStyle.paddingTop) || 0;
        const paddingBottom = parseFloat(preStyle.paddingBottom) || 0;

        const contentHeight = Math.max(
            0,
            pre.scrollHeight - paddingTop - paddingBottom
        );

        if (contentHeight <= 0 || lineHeight <= 0) return 1;

        return Math.max(1, Math.round((contentHeight + 0.25) / lineHeight));
    }

    syncCodeMetrics(code, pre, body) {
        const preStyle = getComputedStyle(pre);
        const codeStyle = getComputedStyle(code);

        const fontSize = parseFloat(codeStyle.fontSize) || 16;
        const preLineHeight = parseFloat(preStyle.lineHeight);
        const codeLineHeight = parseFloat(codeStyle.lineHeight);

        // <code> is inline inside <pre>. The actual line box can be taller
        // than codeStyle.lineHeight because the PRE strut also participates.
        // Use the larger value so the separate gutter cannot drift upward.
        let effectiveLineHeight = Math.max(
            Number.isFinite(preLineHeight) ? preLineHeight : 0,
            Number.isFinite(codeLineHeight) ? codeLineHeight : 0
        );

        if (!Number.isFinite(effectiveLineHeight) || effectiveLineHeight <= 0) {
            effectiveLineHeight = fontSize * 1.65;
        }

        body.style.setProperty('--ctf-code-padding-top', preStyle.paddingTop);
        body.style.setProperty('--ctf-code-padding-bottom', preStyle.paddingBottom);
        body.style.setProperty('--ctf-code-font-size', codeStyle.fontSize);
        body.style.setProperty('--ctf-code-line-height', `${effectiveLineHeight}px`);
    }

    parseFenceInfo(rawInfo) {
        const separatorIndex = rawInfo.indexOf(':');

        if (separatorIndex < 0) {
            return {
                language: rawInfo.trim(),
                title: null,
            };
        }

        if (separatorIndex === 0 || separatorIndex === rawInfo.length - 1) {
            return {
                language: rawInfo.trim(),
                title: null,
            };
        }

        const language = rawInfo.slice(0, separatorIndex).trim();
        let title = rawInfo.slice(separatorIndex + 1).trim();

        if (!language || !title) {
            return {
                language: rawInfo.trim(),
                title: null,
            };
        }

        try {
            title = decodeURIComponent(title);
        } catch (_) {
            // Keep the original title if it is not URI encoded.
        }

        return { language, title };
    }

    findLanguageClass(code, pre) {
        const classes = [...code.classList, ...pre.classList];
        return classes.find((name) => name.startsWith('language-'));
    }

    normalizeLanguageClass(code, pre, oldClass, language) {
        code.classList.remove(oldClass);
        pre.classList.remove(oldClass);

        const normalized = `language-${language}`;
        code.classList.add(normalized);
        pre.classList.add(normalized);
    }
};
