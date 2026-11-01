const {
  Plugin,
  PluginSettingTab,
  Setting,
  Notice,
  MarkdownView,
  Modal,
  setIcon,
} = require("obsidian");

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const DEFAULT_SETTINGS = {
  opencodePath: "",
  model: "",
};

const PROCESS_TIMEOUT_MS = 120000;

class AsciiDiagramToMermaidPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.decoratedBlocks = new Set();
    this._mermaidObservers = [];

    this.addSettingTab(new AsciiDiagramSettingTab(this.app, this));

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.decorateCodeBlocks(el, ctx);
    });

    // 持久监听整个文档，捕获 Mermaid SVG 的渲染（异步，PostProcessor 之后才出现）
    this._startMermaidDomWatcher();
  }

  onunload() {
    for (const { pre, wrap, button, createdWrap, addedWrapClass } of this.decoratedBlocks || []) {
      button.remove();
      delete pre.dataset.admDecorated;

      if (createdWrap && wrap.isConnected && wrap.childElementCount === 1 && wrap.firstElementChild === pre) {
        wrap.replaceWith(pre);
      } else if (addedWrapClass) {
        wrap.classList.remove("adm-pre-wrap");
      }
    }
    this.decoratedBlocks?.clear();

    for (const obs of this._mermaidObservers || []) {
      try { obs.disconnect(); } catch (_) {}
    }
    this._mermaidObservers = [];
  }

  /**
   * 在 document.body 上挂一个持久 MutationObserver，
   * 监视任何新增的 SVG 节点，若其父容器是 .block-language-mermaid 或 .mermaid，
   * 则立即处理（解锁宽度 + 注入全屏按钮）。
   * 同时扫描当前已存在的 SVG（处理插件加载时已打开的文件）。
   */
  _startMermaidDomWatcher() {
    // 先处理已存在的
    this._processMermaidSvgs(document.body);

    const obs = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          // 新增节点本身是 SVG
          if (node.nodeName === "svg" || node.nodeName === "SVG") {
            this._tryHandleSvg(node);
          }
          // 新增节点内含 SVG（Mermaid 把整个 .block-language-mermaid 的内容一次插入）
          const svgs = node.querySelectorAll ? node.querySelectorAll("svg") : [];
          for (const svg of svgs) {
            this._tryHandleSvg(svg);
          }
        }
      }
    });

    obs.observe(document.body, { childList: true, subtree: true });
    this._mermaidObservers.push(obs);
  }

  /** 扫描 root 下已存在的所有 Mermaid SVG 并处理 */
  _processMermaidSvgs(root) {
    const containers = root.querySelectorAll(
      ".block-language-mermaid, .mermaid"
    );
    for (const container of containers) {
      const svg = container.querySelector("svg");
      if (svg) {
        this._unlockSvgWidth(svg);
        this._injectFullscreenButton(container, svg);
      }
    }
  }

  /** 检查 svg 的父容器是否是 Mermaid 块，是则处理 */
  _tryHandleSvg(svg) {
    const container = svg.closest(".block-language-mermaid, .mermaid");
    if (!container) return;
    this._unlockSvgWidth(svg);
    this._injectFullscreenButton(container, svg);
  }

  /**
   * 清除 Obsidian 渲染器注入的内联尺寸限制，
   * 让 CSS 的 max-width: 100% 接管缩放（超宽缩小，本来就窄保持原样）。
   */
  _unlockSvgWidth(svg) {
    if (!svg || !svg.style) return;
    // Obsidian 注入 style="max-width: Npx"，清除后 CSS 才能生效
    svg.style.maxWidth = "";
    // 同时清除内联 width，让 CSS width: auto 接管
    svg.style.width = "";
  }

  /**
   * 在 Mermaid 容器右上角注入全屏按钮（每个容器只注入一次）。
   * 点击后弹出全屏遮罩，SVG 自适应缩放至 90vw/90vh。
   * 点击遮罩背景或按 Esc 关闭。
   */
  _injectFullscreenButton(container, svg) {
    // 避免重复注入
    if (container.dataset.admFullscreen === "1") return;
    container.dataset.admFullscreen = "1";

    // 给容器加 position:relative 的 wrapper class
    container.classList.add("adm-mermaid-wrap");

    // 创建全屏按钮
    const button = document.createElement("button");
    button.className = "adm-fullscreen-button";
    button.type = "button";
    button.setAttribute("aria-label", "全屏查看 Mermaid 图");
    setIcon(button, "expand");
    container.appendChild(button);

    this.registerDomEvent(button, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._openFullscreen(svg);
    });
  }

  /**
   * 用 Obsidian Modal 弹出全屏查看器。
   * Modal 由 Obsidian 自己管理层叠和遮罩，能正确覆盖整个 UI。
   */
  _openFullscreen(svg) {
    const modal = new MermaidFullscreenModal(this.app, svg);
    modal.open();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  decorateCodeBlocks(root, ctx) {
    const codes = root.querySelectorAll(
      "pre > code.language-plain, pre > code.language-Plain, " +
      "pre > code.language-text, pre > code.language-Text, " +
      "pre > code.language-txt, pre > code.language-Txt"
    );

    for (const code of codes) {
      const pre = code.parentElement;
      if (!pre || pre.dataset.admDecorated === "1") continue;
      pre.dataset.admDecorated = "1";

      let wrap = pre.parentElement;
      let createdWrap = false;
      let addedWrapClass = false;

      if (wrap && wrap.classList.contains("ctf-code-body")) {
        // Reuse Code Title Fence's grid container so <pre> remains its direct
        // child and its shared border, spacing, and line numbers stay aligned.
        if (!wrap.classList.contains("adm-pre-wrap")) {
          wrap.classList.add("adm-pre-wrap");
          addedWrapClass = true;
        }
      } else if (!wrap || !wrap.classList.contains("adm-pre-wrap")) {
        wrap = document.createElement("div");
        wrap.className = "adm-pre-wrap";
        pre.parentNode.insertBefore(wrap, pre);
        wrap.appendChild(pre);
        createdWrap = true;
      }

      const button = document.createElement("button");
      button.className = "adm-convert-button";
      button.type = "button";
      button.setAttribute("aria-label", "Convert ASCII diagram to Mermaid");
      setIcon(button, "wand-sparkles");
      const label = document.createElement("span");
      label.textContent = "转 Mermaid";
      button.appendChild(label);
      wrap.appendChild(button);
      this.decoratedBlocks.add({
        pre,
        wrap,
        button,
        createdWrap,
        addedWrapClass,
      });

      this.registerDomEvent(button, "click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.convertRenderedBlock(code, pre, wrap, ctx, button, label);
      });
    }
  }

  async convertRenderedBlock(code, pre, wrap, ctx, button, label) {
    if (button.classList.contains("adm-busy")) return;

    const source = code.textContent || "";
    if (!source.trim()) {
      new Notice("框图为空，无法转换。");
      return;
    }

    const info =
      ctx.getSectionInfo(wrap) ||
      ctx.getSectionInfo(pre) ||
      ctx.getSectionInfo(code);

    if (!info) {
      new Notice("无法定位当前代码块，请切换一次阅读视图后重试。");
      return;
    }

    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = activeView?.file || this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("找不到当前笔记文件。");
      return;
    }

    button.classList.add("adm-busy");
    button.disabled = true;
    label.textContent = "转换中…";

    try {
      const mermaid = await this.convertWithOpenCode(source);
      await this.replaceFence(file, info.lineStart, info.lineEnd, source, mermaid);
      new Notice("已转换为 Mermaid。");
    } catch (error) {
      console.error("[ASCII Diagram to Mermaid] conversion failed", error);
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`转换失败：${msg}`, 8000);
      button.classList.remove("adm-busy");
      button.disabled = false;
      label.textContent = "转 Mermaid";
    }
  }

  buildInstructionFile(diagram) {
    return `ASCII / Unicode diagram to Mermaid conversion task.\n\n` +
      `Follow every rule below.\n` +
      `1. Output exactly one fenced Mermaid code block and nothing else.\n` +
      `2. Analyze the graph topology and label lengths before choosing a layout.\n` +
      `3. For a simple directed chain of at least 4 boxes with no branch, merge, or cycle, use a compact block-beta snake layout with dedicated empty rows and columns for arrows.\n` +
      `4. For 4-8 chain nodes, use columns 3. Each content row must be node, space, node; alternate node order on each content row. Insert a full space:3 row between every two content rows. Example for four nodes: row 1 is n1 space n2; row 2 is space:3; row 3 is n4 space n3.\n` +
      `5. Never place block-beta nodes directly adjacent across a row or between rows. The empty column and empty row are required so Obsidian can display complete connector lines and arrowheads. Declare all real edges separately in source order and never connect an edge to space.\n` +
      `6. Otherwise use flowchart LR when the source is mainly left-to-right, and flowchart TB for hierarchy, branching, merging, cycles, or mainly top-to-bottom relationships.\n` +
      `7. Convert each source box into exactly one Mermaid node. Do not merge or omit steps merely to reduce diagram size.\n` +
      `8. Wrap prose/process labels at semantic boundaries with <br/>. Aim for about 12-16 CJK characters or 24-32 Latin characters per line and usually 2-3 lines per node.\n` +
      `9. Do not split identifiers, class names, method calls, annotations, field names, or short technical terms across lines.\n` +
      `10. The first meaningful line in a data/entity box is usually its title. Keep its remaining fields on separate <br/> lines even when that exceeds three lines.\n` +
      `11. Preserve original names and markers such as PK, UK, FK, JSON and status values.\n` +
      `12. Preserve arrow direction and nearby relationship labels.\n` +
      `13. If an arrow points to a named external object that has no box, create a small node for it.\n` +
      `14. Do not invent relationships that are not represented in the source.\n` +
      `15. Use safe node ids n1, n2, n3... and quote visible node labels.\n` +
      `16. Prefer a compact readable result over excessive whitespace, but never sacrifice meaning or create crossing arrows unnecessarily.\n` +
      `17. Do not add classDef, themes, colors, explanations, or prose.\n\n` +
      `SOURCE DIAGRAM:\n` +
      `----------------\n` +
      diagram + `\n`;
  }

  async convertWithOpenCode(diagram) {
    const exe = this.resolveOpenCodePath();
    if (!exe) {
      throw new Error("找不到 OpenCode。请在插件设置中填写 opencode.cmd 的完整路径。");
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "obsidian-ascii-mermaid-"));
    const taskFile = path.join(tmpDir, "task.txt");
    fs.writeFileSync(taskFile, this.buildInstructionFile(diagram), "utf8");

    try {
      const message =
        "Read the attached task file and follow it exactly. Output only the requested Mermaid code block.";
      const args = ["run", message];
      if (this.settings.model && this.settings.model.trim()) {
        args.push("--model", this.settings.model.trim());
      }

      // --file accepts multiple values, so positional messages must come first.
      args.push("--file", taskFile);

      const stdout = await this.runProcess(exe, args);
      return this.normalizeMermaidLayout(this.extractMermaid(stdout));
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch (_) {}
    }
  }

  runProcess(exe, args) {
    return new Promise((resolve, reject) => {
      let child;

      const cwd = this.app.vault.adapter.getBasePath?.() || process.cwd();

      if (process.platform === "win32" && /\.(cmd|bat)$/i.test(exe)) {
        /*
         * npm global commands on Windows are usually .cmd wrappers.
         * Do NOT build a quoted `cmd.exe /c` command line here: cmd.exe's
         * quote rules are easy to break (especially when the executable is
         * already quoted in settings), and its localized error output can be
         * decoded as mojibake.
         *
         * Instead, pass both the executable path and argv through environment
         * variables and let PowerShell invoke the .cmd file with the call
         * operator.  This preserves paths containing spaces and Unicode text.
         */
        const shell = this.findPowerShell();
        if (!shell) {
          reject(new Error("找不到 PowerShell，无法在 Windows 中启动 opencode.cmd。"));
          return;
        }

        const env = {
          ...process.env,
          ADM_OPENCODE_EXE: exe,
          ADM_OPENCODE_ARGS_JSON: JSON.stringify(args),
        };

        const psScript = [
          "$ErrorActionPreference = 'Stop'",
          "try { & \"$env:SystemRoot\\System32\\chcp.com\" 65001 | Out-Null } catch {}",
          "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
          "$OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
          "$exe = $env:ADM_OPENCODE_EXE",
          "$argv = @((ConvertFrom-Json -InputObject $env:ADM_OPENCODE_ARGS_JSON))",
          "& $exe @argv",
          "if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }",
        ].join("; ");

        child = spawn(shell, [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          psScript,
        ], {
          windowsHide: true,
          cwd,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        child = spawn(exe, args, {
          windowsHide: true,
          cwd,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.terminateProcess(child);
        reject(new Error("OpenCode 转换超过 120 秒，已终止。请检查模型配置或网络连接。"));
      }, PROCESS_TIMEOUT_MS);

      child.stdout?.on("data", (d) => (stdout += d.toString("utf8")));
      child.stderr?.on("data", (d) => (stderr += d.toString("utf8")));

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(err);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        const cleanStdout = this.cleanProcessOutput(stdout);
        const cleanStderr = this.cleanProcessOutput(stderr);
        if (code === 0) {
          resolve(cleanStdout);
        } else {
          const detail = cleanStderr || cleanStdout || `OpenCode exited with code ${code}`;
          reject(new Error(detail));
        }
      });
    });
  }

  terminateProcess(child) {
    if (!child || child.killed) return;

    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.on("error", () => child.kill());
      return;
    }

    child.kill();
  }

  cleanProcessOutput(output) {
    return String(output || "")
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/\x1B[@-_]/g, "")
      .trim();
  }

  findPowerShell() {
    if (process.platform !== "win32") return null;

    for (const command of ["pwsh.exe", "powershell.exe"]) {
      try {
        const res = spawnSync("where.exe", [command], {
          encoding: "utf8",
          windowsHide: true,
        });
        if (res.status === 0) {
          const first = (res.stdout || "")
            .split(/\r?\n/)
            .map((x) => x.trim())
            .find(Boolean);
          if (first) return first;
        }
      } catch (_) {}
    }

    // Windows PowerShell is present on normal Windows 10/11 installs.
    const fallback = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    );
    return fs.existsSync(fallback) ? fallback : null;
  }

  extractMermaid(output) {
    const fenced = output.match(/```mermaid\s*([\s\S]*?)```/i);
    if (fenced) {
      return `\`\`\`mermaid\n${fenced[1].trim()}\n\`\`\``;
    }

    const raw = output.match(/(?:^|\n)\s*(flowchart|graph|erDiagram|block-beta|block)\b[\s\S]*/i);
    if (raw) {
      let body = raw[0].trim().replace(/\n```\s*$/, "").trim();
      return `\`\`\`mermaid\n${body}\n\`\`\``;
    }

    throw new Error("OpenCode 已返回结果，但没有检测到 Mermaid 代码。");
  }

  normalizeMermaidLayout(mermaid) {
    const fenced = mermaid.match(/^```mermaid\s*\n([\s\S]*?)\n```$/i);
    if (!fenced) return mermaid;

    const body = fenced[1].trim();
    if (!/^(?:flowchart|graph|block-beta|block)\b/i.test(body)) return mermaid;

    const lines = body.split(/\r?\n/);
    const nodes = new Map();

    for (const line of lines) {
      const nodePattern = /([A-Za-z_][A-Za-z0-9_-]*)\s*(\[\s*"(?:\\.|[^"\\])*"\s*\])/g;
      let match;
      while ((match = nodePattern.exec(line)) !== null) {
        nodes.set(match[1], `${match[1]}${match[2]}`);
      }
    }

    if (nodes.size < 4 || nodes.size > 8) return mermaid;

    // Dense data/entity boxes are better handled by the regular flowchart layout.
    for (const definition of nodes.values()) {
      const breaks = (definition.match(/<br\s*\/?\s*>/gi) || []).length;
      if (breaks >= 4 || /\b(?:PK|FK|UK)\b/.test(definition)) return mermaid;
    }

    const edges = [];
    for (const line of lines) {
      if (!line.includes("-->")) continue;

      const parts = line.trim().split(/\s*-->\s*/);
      if (parts.length < 2) continue;

      let from = this.findMermaidNodeId(parts[0]);
      for (let index = 1; index < parts.length && from; index += 1) {
        const labelMatch = parts[index].match(/^\s*\|([^|]*)\|\s*/);
        const targetPart = labelMatch
          ? parts[index].slice(labelMatch[0].length)
          : parts[index];
        const to = this.findMermaidNodeId(targetPart);
        if (!to) break;

        edges.push({ from, to, label: labelMatch?.[1] || "" });
        from = to;
      }
    }

    if (edges.length !== nodes.size - 1) return mermaid;

    const incoming = new Map([...nodes.keys()].map((id) => [id, 0]));
    const outgoing = new Map();
    for (const edge of edges) {
      if (!nodes.has(edge.from) || !nodes.has(edge.to)) return mermaid;
      if (outgoing.has(edge.from)) return mermaid;
      outgoing.set(edge.from, edge);
      incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
      if (incoming.get(edge.to) > 1) return mermaid;
    }

    const starts = [...nodes.keys()].filter((id) => incoming.get(id) === 0);
    if (starts.length !== 1) return mermaid;

    const sequence = [];
    const orderedEdges = [];
    const visited = new Set();
    let current = starts[0];

    while (current && !visited.has(current)) {
      visited.add(current);
      sequence.push(current);
      const edge = outgoing.get(current);
      if (!edge) break;
      orderedEdges.push(edge);
      current = edge.to;
    }

    if (sequence.length !== nodes.size || orderedEdges.length !== nodes.size - 1) {
      return mermaid;
    }

    const output = ["block-beta", "  columns 3"];
    for (let index = 0; index < sequence.length; index += 2) {
      const row = index / 2;
      const first = nodes.get(sequence[index]);
      const secondId = sequence[index + 1];

      if (!secondId) {
        output.push(row % 2 === 0 ? `  ${first} space:2` : `  space:2 ${first}`);
      } else {
        const second = nodes.get(secondId);
        output.push(
          row % 2 === 0
            ? `  ${first} space ${second}`
            : `  ${second} space ${first}`
        );
      }

      if (index + 2 < sequence.length) output.push("  space:3");
    }

    for (const edge of orderedEdges) {
      const label = edge.label ? `|${edge.label}|` : "";
      output.push(`  ${edge.from} -->${label} ${edge.to}`);
    }

    return `\`\`\`mermaid\n${output.join("\n")}\n\`\`\``;
  }

  findMermaidNodeId(segment) {
    return segment.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)/)?.[1] || null;
  }

  async replaceFence(file, lineStart, lineEnd, source, mermaid) {
    const original = await this.app.vault.read(file);
    const lines = original.split(/\r?\n/);

    const start = Math.max(0, lineStart);
    const end = Math.min(lines.length - 1, lineEnd);
    const section = lines.slice(start, end + 1).join("\n");

    if (!/```(?:plain|text|txt)\b/i.test(section)) {
      throw new Error("当前代码块位置已经变化，为避免覆盖内容已取消替换。");
    }

    const sourceTrimmed = source.replace(/\r\n/g, "\n").trim();
    const sectionNormalized = section.replace(/\r\n/g, "\n");
    if (sourceTrimmed && !sectionNormalized.includes(sourceTrimmed)) {
      throw new Error("代码块内容在转换期间发生变化，为避免误覆盖已取消替换。");
    }

    const newLines = [
      ...lines.slice(0, start),
      ...mermaid.split("\n"),
      ...lines.slice(end + 1),
    ];

    await this.app.vault.modify(file, newLines.join("\n"));
  }

  normalizeConfiguredPath(value) {
    let v = String(value || "").trim();

    // Users often paste a path as "C:\\...\\opencode.cmd".  Quotes are
    // display syntax, not part of the real file name, so strip one matching
    // outer pair before fs.existsSync / process launch.
    if (v.length >= 2) {
      const first = v[0];
      const last = v[v.length - 1];
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        v = v.slice(1, -1).trim();
      }
    }

    return v;
  }

  resolveOpenCodePath() {
    const configured = this.normalizeConfiguredPath(this.settings.opencodePath || "");
    if (configured) {
      if (fs.existsSync(configured)) return configured;
      // Also allow a command name instead of a full path.
      if (!/[\\/]/.test(configured)) {
        const found = this.findCommand(configured);
        if (found) return found;
      }
    }

    return this.findCommand(process.platform === "win32" ? "opencode.cmd" : "opencode") ||
      this.findCommand("opencode");
  }

  findCommand(command) {
    try {
      if (process.platform === "win32") {
        const res = spawnSync("where.exe", [command], {
          encoding: "utf8",
          windowsHide: true,
        });
        if (res.status === 0) {
          const first = (res.stdout || "")
            .split(/\r?\n/)
            .map((x) => x.trim())
            .find(Boolean);
          if (first) return first;
        }
      } else {
        const res = spawnSync("which", [command], { encoding: "utf8" });
        if (res.status === 0) return (res.stdout || "").trim() || null;
      }
    } catch (_) {}
    return null;
  }

  async testOpenCode() {
    const exe = this.resolveOpenCodePath();
    if (!exe) {
      new Notice("未找到 OpenCode。请填写完整路径。", 5000);
      return;
    }

    try {
      const output = await this.runProcess(exe, ["--version"]);
      const firstLine = (output || "").split(/\r?\n/).find(Boolean) || "可正常启动";
      new Notice(`OpenCode 正常：${firstLine}`, 6000);
    } catch (error) {
      console.error("[ASCII Diagram to Mermaid] OpenCode test failed", error);
      const msg = error instanceof Error ? error.message : String(error);
      new Notice(`OpenCode 启动失败：${msg}`, 8000);
    }
  }

}

class AsciiDiagramSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("OpenCode 路径")
      .setDesc("可留空自动查找；Windows 也可填写 opencode.cmd 的完整路径。")
      .addText((text) =>
        text
          .setPlaceholder("C:\\Users\\...\\AppData\\Roaming\\npm\\opencode.cmd")
          .setValue(this.plugin.settings.opencodePath)
          .onChange(async (value) => {
            this.plugin.settings.opencodePath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("模型")
      .setDesc("可选。留空时使用 OpenCode 当前默认模型；也可填写 provider/model。")
      .addText((text) =>
        text
          .setPlaceholder("留空使用默认模型")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("检测 OpenCode")
      .setDesc("检查插件当前能够找到的 OpenCode 命令。")
      .addButton((button) =>
        button.setButtonText("检测").onClick(() => this.plugin.testOpenCode())
      );
  }
}

/**
 * Mermaid 图全屏查看器。
 * 继承 Obsidian Modal，由框架负责遮罩、层叠、Esc 关闭。
 * 点击遮罩背景也可关闭（监听 modal-bg 点击）。
 */
class MermaidFullscreenModal extends Modal {
  constructor(app, svg) {
    super(app);
    this.svg = svg;
    this.modalEl.addClass("adm-fullscreen-modal");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("adm-fullscreen-content");

    // 克隆 SVG，清除内联尺寸，由 CSS 等比缩放
    const clonedSvg = this.svg.cloneNode(true);
    if (clonedSvg.style) clonedSvg.style.cssText = "";
    clonedSvg.removeAttribute("width");
    clonedSvg.removeAttribute("height");
    contentEl.appendChild(clonedSvg);

    // 强制修正 modal-container 的定位，避免 Electron 缩放时坐标系偏移
    const container = this.modalEl.closest(".modal-container");
    if (container) {
      container.style.position = "fixed";
      container.style.inset = "0";
      container.style.width = "100vw";
      container.style.height = "100vh";
      container.style.zIndex = "9999";
      container.style.display = "flex";
      container.style.alignItems = "center";
      container.style.justifyContent = "center";
      this._fixedContainer = container;
    }

    // 点击遮罩背景关闭
    const bg = container?.querySelector(".modal-bg");
    if (bg) {
      bg.addEventListener("click", () => this.close(), { once: true });
    }
  }

  onClose() {
    // 清除强制样式
    if (this._fixedContainer) {
      this._fixedContainer.style.cssText = "";
      this._fixedContainer = null;
    }
    this.contentEl.empty();
  }
}

module.exports = AsciiDiagramToMermaidPlugin;
