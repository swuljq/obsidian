const { Modal, Notice, Plugin } = require("obsidian");

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const COMPLETION_SUFFIX_RE = /\s+✅\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s*$/u;

const STATUS_CLASSES = [
    "scd-status-remaining",
    "scd-status-due-today",
    "scd-status-overdue",
    "scd-status-completed",
];

class CountdownModal extends Modal {
    constructor(app, onSubmit) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        this.titleEl.setText("插入日程倒计时");
        this.contentEl.addClass("scd-modal");

        const form = this.contentEl.createEl("form");
        const today = formatLocalDate(new Date());
        const startInput = this.createDateField(form, "开始日期", today);
        const endInput = this.createDateField(form, "结束日期", today);

        const actions = form.createDiv({ cls: "scd-modal-actions" });
        const cancelButton = actions.createEl("button", {
            text: "取消",
            attr: { type: "button" },
        });
        actions.createEl("button", {
            text: "插入",
            cls: "mod-cta",
            attr: { type: "submit" },
        });

        cancelButton.addEventListener("click", () => this.close());
        form.addEventListener("submit", (event) => {
            event.preventDefault();

            const start = parseDate(startInput.value);
            const end = parseDate(endInput.value);
            if (!start || !end) {
                new Notice("请选择有效的开始日期和结束日期");
                return;
            }
            if (end.ordinal < start.ordinal) {
                new Notice("结束日期不能早于开始日期");
                return;
            }

            this.onSubmit(start.value, end.value);
            this.close();
        });

        window.setTimeout(() => startInput.focus(), 0);
    }

    createDateField(form, labelText, value) {
        const field = form.createDiv({ cls: "scd-modal-field" });
        field.createEl("label", { text: labelText });
        const input = field.createEl("input", {
            attr: { type: "date", required: "required" },
        });
        input.value = value;
        return input;
    }

    onClose() {
        this.contentEl.empty();
    }
}

module.exports = class ScheduleCountdownPlugin extends Plugin {
    onload() {
        this.refreshFrame = 0;
        this.midnightTimer = 0;
        this.taskStates = new Map();
        this.pendingFileContents = new Map();
        this.fileQueues = new Map();

        this.addCommand({
            id: "insert-schedule-countdown",
            name: "插入日程倒计时",
            editorCallback: (editor) => {
                new CountdownModal(this.app, (start, end) => {
                    this.insertMarker(editor, start, end);
                }).open();
            },
        });

        this.registerMarkdownPostProcessor((element) => {
            for (const code of element.querySelectorAll("code")) {
                if (code.closest("pre")) continue;
                const marker = parseMarker(code.textContent);
                if (!marker) continue;
                this.decorateReadingLabel(code, marker);
            }

            this.decorateCompletionTimes(element);
        });

        this.registerDomEvent(document, "click", (event) => {
            if (event.target instanceof HTMLInputElement && event.target.type === "checkbox") {
                window.setTimeout(() => this.scheduleRefresh(), 0);
            }
        });

        this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
        this.registerEvent(
            this.app.vault.on("modify", (file) => this.queueTaskStateUpdate(file))
        );
        this.registerEvent(
            this.app.vault.on("create", (file) => this.initializeFileState(file))
        );
        this.registerEvent(
            this.app.vault.on("delete", (file) => this.removeFileState(file.path))
        );
        this.registerEvent(
            this.app.vault.on("rename", (file, oldPath) => {
                this.moveFileState(oldPath, file.path);
            })
        );

        this.scheduleMidnightRefresh();
        this.app.workspace.onLayoutReady(() => {
            this.scheduleRefresh();
            void this.initializeTaskStates();
        });
    }

    onunload() {
        if (this.refreshFrame) cancelAnimationFrame(this.refreshFrame);
        if (this.midnightTimer) window.clearTimeout(this.midnightTimer);
        this.taskStates.clear();
        this.pendingFileContents.clear();
        this.fileQueues.clear();
    }

    insertMarker(editor, start, end) {
        const cursor = editor.getCursor();
        const line = editor.getLine(cursor.line);
        const prefix = cursor.ch > 0 && !/\s/.test(line.charAt(cursor.ch - 1)) ? " " : "";
        const marker = `${prefix}\`countdown:${start}~${end}\``;

        editor.replaceRange(marker, cursor);
        editor.setCursor({ line: cursor.line, ch: cursor.ch + marker.length });
        editor.focus();
    }

    decorateReadingLabel(element, marker) {
        element.classList.add("scd-countdown", "scd-reading-label");
        element.dataset.scdStart = marker.start.value;
        element.dataset.scdEnd = marker.end.value;
        this.updateLabel(element, marker, true);
    }

    scheduleRefresh() {
        if (this.refreshFrame) return;
        this.refreshFrame = requestAnimationFrame(() => {
            this.refreshFrame = 0;
            this.refreshLabels();
        });
    }

    refreshLabels() {
        for (const element of document.querySelectorAll(".scd-reading-label")) {
            const marker = parseMarker(
                `countdown:${element.dataset.scdStart}~${element.dataset.scdEnd}`
            );
            if (marker) this.updateLabel(element, marker, true);
        }

        for (const element of document.querySelectorAll(".markdown-rendered")) {
            this.decorateCompletionTimes(element);
        }
    }

    decorateCompletionTimes(container) {
        const textNodes = [];

        for (const task of container.querySelectorAll("li.task-list-item")) {
            const walker = document.createTreeWalker(task, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();

            while (node) {
                if (
                    node.parentElement?.closest("li.task-list-item") === task &&
                    !node.parentElement.closest(".scd-completion-time")
                ) {
                    const match = /(\s*)(✅\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})(\s*)$/u.exec(
                        node.textContent || ""
                    );
                    if (match) textNodes.push({ node, match });
                }
                node = walker.nextNode();
            }
        }

        for (const { node, match } of textNodes) {
            const text = node.textContent || "";
            const fragment = document.createDocumentFragment();
            fragment.append(text.slice(0, match.index) + match[1]);

            const completion = document.createElement("span");
            completion.className = "scd-completion-time";
            completion.textContent = match[2];
            fragment.append(completion);

            if (match[3]) fragment.append(match[3]);
            node.replaceWith(fragment);
        }
    }

    updateLabel(element, marker, replaceText) {
        const completed = this.isTaskComplete(element);
        const status = getCountdownStatus(marker.end, new Date(), completed);
        const targetClass = `scd-status-${status.type}`;

        for (const statusClass of STATUS_CLASSES) {
            if (statusClass !== targetClass && element.classList.contains(statusClass)) {
                element.classList.remove(statusClass);
            }
        }
        if (!element.classList.contains(targetClass)) {
            element.classList.add(targetClass);
        }
        element.dataset.scdLabel = status.label;
        element.title = `开始：${marker.start.value}  结束：${marker.end.value}`;

        if (replaceText && element.textContent !== status.label) {
            element.textContent = status.label;
        }
    }

    isTaskComplete(element) {
        const task = element.closest("li.task-list-item, .HyperMD-task-line, .cm-line");
        if (!task) return false;

        if (task.classList.contains("is-checked")) return true;
        if (/^[xX]$/.test(task.getAttribute("data-task") || "")) return true;

        const checkbox = task.querySelector(
            'input.task-list-item-checkbox, input[type="checkbox"]'
        );
        return Boolean(checkbox && checkbox.checked);
    }

    async initializeTaskStates() {
        const files = this.app.vault.getMarkdownFiles();
        await Promise.all(files.map((file) => this.initializeFileState(file)));
    }

    async initializeFileState(file) {
        if (!file || file.extension !== "md") return;

        try {
            const content = await this.app.vault.cachedRead(file);
            if (!this.taskStates.has(file.path)) {
                this.taskStates.set(file.path, parseTaskStates(content));
            }
        } catch (error) {
            console.error(`Schedule Countdown: failed to read ${file.path}`, error);
        }
    }

    queueTaskStateUpdate(file) {
        if (!file || file.extension !== "md") return;

        const path = file.path;
        const previousQueue = this.fileQueues.get(path) || Promise.resolve();
        const nextQueue = previousQueue
            .catch(() => {})
            .then(() => this.processTaskStateUpdate(file))
            .catch((error) => {
                console.error(`Schedule Countdown: failed to update ${path}`, error);
            })
            .finally(() => {
                if (this.fileQueues.get(path) === nextQueue) {
                    this.fileQueues.delete(path);
                }
            });

        this.fileQueues.set(path, nextQueue);
    }

    async processTaskStateUpdate(file) {
        const path = file.path;
        const content = await this.app.vault.read(file);
        const pendingContent = this.pendingFileContents.get(path);

        if (pendingContent === content) {
            this.pendingFileContents.delete(path);
            this.taskStates.set(path, parseTaskStates(content));
            return;
        }
        if (pendingContent !== undefined) {
            this.pendingFileContents.delete(path);
        }

        const previousStates = this.taskStates.get(path);
        if (!previousStates) {
            this.taskStates.set(path, parseTaskStates(content));
            return;
        }

        const result = applyTaskTransitions(
            previousStates,
            content,
            formatCompletionTime(new Date())
        );

        if (!result.changed) {
            this.taskStates.set(path, result.states);
            return;
        }

        this.pendingFileContents.set(path, result.content);
        this.taskStates.set(path, parseTaskStates(result.content));

        try {
            await this.app.vault.modify(file, result.content);
        } catch (error) {
            this.pendingFileContents.delete(path);
            this.taskStates.set(path, parseTaskStates(content));
            throw error;
        }
    }

    removeFileState(path) {
        this.taskStates.delete(path);
        this.pendingFileContents.delete(path);
        this.fileQueues.delete(path);
    }

    moveFileState(oldPath, newPath) {
        const state = this.taskStates.get(oldPath);
        this.removeFileState(oldPath);
        if (state) this.taskStates.set(newPath, state);
    }

    scheduleMidnightRefresh() {
        if (this.midnightTimer) window.clearTimeout(this.midnightTimer);

        const now = new Date();
        const nextMidnight = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() + 1,
            0,
            0,
            1
        );
        this.midnightTimer = window.setTimeout(() => {
            this.refreshLabels();
            this.scheduleMidnightRefresh();
        }, nextMidnight.getTime() - now.getTime());
    }
};

function formatLocalDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function formatCompletionTime(date) {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${formatLocalDate(date)} ${hours}:${minutes}`;
}

function parseTaskLine(line) {
    const match = /^(\s*[-*+]\s+\[)([ xX])(\])(?:\s.*)?$/.exec(line);
    if (!match) return null;

    const withoutCompletion = line.replace(COMPLETION_SUFFIX_RE, "").trimEnd();
    const identity = withoutCompletion.replace(
        /^(\s*[-*+]\s+\[)[ xX](\])/,
        "$1 $2"
    );

    return {
        checked: /^[xX]$/.test(match[2]),
        hasCompletion: COMPLETION_SUFFIX_RE.test(line),
        identity,
    };
}

function parseTaskStates(content) {
    const states = new Map();
    const lines = content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
        const task = parseTaskLine(lines[index]);
        if (task) states.set(index, task);
    }

    return states;
}

function applyTaskTransitions(previousStates, content, completionTime) {
    const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);
    let changed = false;

    for (let index = 0; index < lines.length; index += 1) {
        const current = parseTaskLine(lines[index]);
        const previous = previousStates.get(index);

        if (!current || !previous || current.identity !== previous.identity) continue;

        if (!previous.checked && current.checked && !current.hasCompletion) {
            lines[index] = `${lines[index].trimEnd()} ✅ ${completionTime}`;
            changed = true;
            continue;
        }

        if (previous.checked && !current.checked && current.hasCompletion) {
            lines[index] = lines[index].replace(COMPLETION_SUFFIX_RE, "").trimEnd();
            changed = true;
        }
    }

    const resultContent = lines.join(lineEnding);
    return {
        changed,
        content: resultContent,
        states: parseTaskStates(resultContent),
    };
}

function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const milliseconds = Date.UTC(year, month - 1, day);
    const date = new Date(milliseconds);

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return {
        value,
        ordinal: Math.floor(milliseconds / MS_PER_DAY),
    };
}

function parseMarker(value) {
    const match = /^countdown\s*:\s*(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})$/i.exec(
        (value || "").trim()
    );
    if (!match) return null;

    const start = parseDate(match[1]);
    const end = parseDate(match[2]);
    if (!start || !end || end.ordinal < start.ordinal) return null;

    return { start, end };
}

function getCountdownStatus(endDate, now = new Date(), completed = false) {
    if (completed) {
        return { type: "completed", label: "已完成" };
    }

    const todayOrdinal = Math.floor(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_PER_DAY
    );
    const daysUntilEnd = endDate.ordinal - todayOrdinal;

    if (daysUntilEnd === 0) {
        return { type: "due-today", label: "今天截止" };
    }
    if (daysUntilEnd < 0) {
        return { type: "overdue", label: `已逾期 ${Math.abs(daysUntilEnd)} 天` };
    }

    return { type: "remaining", label: `还剩 ${daysUntilEnd + 1} 天` };
}
