(function (global) {
  "use strict";

  function createMarkdownFeature({ state, elements, showToast, applyFunctionTheme, onContentChange }) {
    const notifyContentChange = () => {
      if (typeof onContentChange === "function") onContentChange();
    };
    function isMarkdownFile(file) {
      return Boolean(file && /\.(md|markdown|mdown|mkdn|txt)$/i.test(file.name || ""));
    }

    async function openMarkdownFiles(files) {
      const file = (files || []).find(isMarkdownFile);
      if (!file) {
        showToast("请选择 .md、.markdown 或 .txt 文件。", true);
        return;
      }
      if (elements.functionSelect.value !== "markdown") {
        elements.functionSelect.value = "markdown";
        elements.functionSelect.dispatchEvent(new Event("change"));
      }
      try {
        elements.markdownStatus.textContent = "正在读取文件…";
        const source = await file.text();
        state.markdownSource = source;
        state.markdownFileName = file.name;
        state.markdownFileSize = file.size || 0;
        state.markdownEditMode = false;
        renderMarkdownDocument(source, file);
      } catch (error) {
        elements.markdownStatus.textContent = "文件读取失败";
        showToast(`Markdown 文件读取失败：${error.message || error}`, true);
      }
    }

    function renderMarkdownDocument(source, file) {
      state.markdownSource = source;
      if (file?.name) state.markdownFileName = file.name;
      if (Number.isFinite(file?.size)) state.markdownFileSize = file.size;
      if (elements.markdownEditor.value !== source) elements.markdownEditor.value = source;
      const parsed = markdownToHtml(source);
      renderMarkdownInto(elements.markdownRendered, parsed);
      elements.markdownRendered.classList.remove("hidden");
      elements.markdownEmpty.classList.add("hidden");
      elements.markdownEditor.classList.add("hidden");
      elements.markdownContent.classList.remove("markdown-editing");
      elements.markdownEditToggle.textContent = "编辑 Markdown";
      elements.markdownEditToggle.setAttribute("aria-pressed", "false");
      elements.markdownFileMeta.textContent = `${file.name} · ${formatMarkdownBytes(file.size)} · ${parsed.lineCount} 行`;
      elements.markdownStatus.textContent = `${parsed.wordCount.toLocaleString()} 个字符 · ${parsed.headingCount} 个标题 · ${parsed.tableCount} 个表格`;
      renderMarkdownToc(parsed.toc);
      setMarkdownFontScale(state.markdownFontScale, false);
      updateMarkdownLayout();
      updateMarkdownStickyHeading();
      notifyContentChange();
    }

    function updateMarkdownPreview(source, statusSuffix = "") {
      const previousRatio = state.markdownEditMode ? markdownScrollRatio(elements.markdownRendered) : null;
      const parsed = markdownToHtml(source);
      renderMarkdownInto(elements.markdownRendered, parsed);
      elements.markdownRendered.classList.remove("hidden");
      elements.markdownEmpty.classList.add("hidden");
      elements.markdownFileMeta.textContent = `${state.markdownFileName} · ${formatMarkdownBytes(state.markdownFileSize)} · ${parsed.lineCount} 行`;
      elements.markdownStatus.textContent = `${parsed.wordCount.toLocaleString()} 个字符 · ${parsed.headingCount} 个标题 · ${parsed.tableCount} 个表格${statusSuffix ? ` · ${statusSuffix}` : ""}`;
      renderMarkdownToc(parsed.toc);
      updateMarkdownLayout();
      updateMarkdownStickyHeading();
      if (previousRatio !== null) {
        requestAnimationFrame(() => {
          const max = Math.max(0, elements.markdownRendered.scrollHeight - elements.markdownRendered.clientHeight);
          elements.markdownRendered.scrollTop = previousRatio * max;
          updateMarkdownStickyHeading();
        });
      }
      notifyContentChange();
    }

    function toggleMarkdownEdit() {
      if (!state.markdownEditMode && elements.markdownRendered.classList.contains("hidden") && !state.markdownSource) {
        state.markdownFileName = "untitled.md";
        state.markdownFileSize = 0;
        elements.markdownEditor.value = "";
      }
      state.markdownEditMode = !state.markdownEditMode;
      elements.markdownContent.classList.toggle("markdown-editing", state.markdownEditMode);
      elements.markdownEditor.classList.toggle("hidden", !state.markdownEditMode);
      elements.markdownRendered.classList.remove("hidden");
      elements.markdownEmpty.classList.add("hidden");
      elements.markdownEditToggle.textContent = state.markdownEditMode ? "完成编辑" : "编辑 Markdown";
      elements.markdownEditToggle.setAttribute("aria-pressed", String(state.markdownEditMode));
      if (state.markdownEditMode) {
        elements.markdownEditor.value = state.markdownSource;
        updateMarkdownPreview(state.markdownSource, "实时预览");
        requestAnimationFrame(() => elements.markdownEditor.focus());
      } else {
        state.markdownSource = elements.markdownEditor.value;
        updateMarkdownPreview(state.markdownSource);
      }
      updateMarkdownStickyHeading();
    }

    function handleMarkdownEditorInput() {
      state.markdownSource = elements.markdownEditor.value;
      notifyContentChange();
      elements.markdownStatus.textContent = "正在编辑 · 预览会自动更新…";
      clearTimeout(state.markdownEditTimer);
      state.markdownEditTimer = setTimeout(() => updateMarkdownPreview(state.markdownSource, "实时预览"), 180);
    }

    function markdownScrollRatio(element) {
      const max = Math.max(0, element.scrollHeight - element.clientHeight);
      return max ? element.scrollTop / max : 0;
    }

    function syncMarkdownEditorScroll() {
      if (!state.markdownEditMode || state.markdownScrollSyncing) return;
      const ratio = markdownScrollRatio(elements.markdownEditor);
      state.markdownScrollSyncing = true;
      const targetMax = Math.max(0, elements.markdownRendered.scrollHeight - elements.markdownRendered.clientHeight);
      elements.markdownRendered.scrollTop = ratio * targetMax;
      requestAnimationFrame(() => { state.markdownScrollSyncing = false; });
    }

    function syncMarkdownPreviewScroll() {
      if (!state.markdownEditMode || state.markdownScrollSyncing) return;
      const ratio = markdownScrollRatio(elements.markdownRendered);
      state.markdownScrollSyncing = true;
      const targetMax = Math.max(0, elements.markdownEditor.scrollHeight - elements.markdownEditor.clientHeight);
      elements.markdownEditor.scrollTop = ratio * targetMax;
      requestAnimationFrame(() => { state.markdownScrollSyncing = false; });
    }

    function downloadMarkdownSource() {
      const source = state.markdownEditMode ? elements.markdownEditor.value : state.markdownSource;
      if (!source && !state.markdownFileName) {
        showToast("请先打开或编辑 Markdown 内容。", true);
        return;
      }
      const baseName = (state.markdownFileName || "untitled.md").replace(/\.[^.]+$/, "") || "untitled";
      const blob = new Blob([source], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${baseName}.md`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      elements.markdownStatus.textContent = "Markdown 已下载";
    }

    function formatMarkdownBytes(bytes) {
      const value = Number(bytes) || 0;
      if (value < 1024) return `${value} B`;
      if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
      return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    }

    function escapeMarkdownHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
    }

    function safeMarkdownUrl(value) {
      const url = String(value || "").trim();
      if (/^(https?:|mailto:|#|\/|data:image\/(?:png|jpeg|gif|webp);)/i.test(url)) return url;
      return "#";
    }

    // Inline Markdown for the emergency fallback renderer only. The normal path
    // is markdown-it, so this only has to keep the old behaviour alive if the
    // vendored engine is unavailable.
    function markdownInline(value) {
      let output = escapeMarkdownHtml(value);
      output = output.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_, alt) => escapeMarkdownHtml(alt || "图片"));
      output = output.replace(/\[([^\]]+)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_, label, url, title) => {
        const safeUrl = safeMarkdownUrl(url);
        if (safeUrl === "#") return label;
        const titleAttr = title ? ` title="${escapeMarkdownHtml(title)}"` : "";
        return `<a href="${escapeMarkdownHtml(safeUrl)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
      });
      output = output.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
      output = output.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, boldA, boldB) => `<strong>${boldA || boldB}</strong>`);
      output = output.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
      output = output.replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, (_, italicA, italicB) => `<em>${italicA || italicB}</em>`);
      output = output.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, prefix, url) => `${prefix}<a href="${escapeMarkdownHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeMarkdownHtml(url)}</a>`);
      return output;
    }

    // --- markdown-it engine (markdown-it/markdown-it) ----------------------
    // The previous hand-written parser handled a friendly subset of GFM. The
    // vendored markdown-it build replaces it with a spec-complete parser, while
    // everything downstream of `markdownToHtml` (TOC structure, table wrappers
    // and the column-resize feature) keeps its existing DOM contract.

    const MARKDOWN_IT_OPTIONS = {
      html: false,          // raw HTML in the source stays escaped, as before
      linkify: true,        // bare URLs become links (previous behaviour)
      breaks: false,        // soft breaks keep Markdown semantics
      typographer: false,
      langPrefix: "language-",
    };

    // URIs the previous renderer allowed. Anything else (`javascript:`, remote
    // data URLs, unknown schemes) is rejected before sanitising.
    const SAFE_MARKDOWN_LINK = /^(?:https?:|mailto:|#|\/|\.{1,2}\/)/i;

    let markdownEngine = null;

    function getMarkdownEngine() {
      if (markdownEngine) return markdownEngine;
      if (typeof global.markdownit !== "function") return null;
      const engine = global.markdownit(MARKDOWN_IT_OPTIONS);
      if (typeof global.markdownitTaskLists === "function") {
        engine.use(global.markdownitTaskLists, { enabled: false, label: true });
      }
      markdownEngine = engine;
      return engine;
    }

    function renderWithEngine(source) {
      const engine = getMarkdownEngine();
      if (!engine) return null;
      const raw = engine.render(String(source || "").replace(/^\uFEFF/, ""));
      const safe = sanitizeMarkdownHtml(raw);
      return applyMarkdownDomContract(safe);
    }

    function sanitizeMarkdownHtml(html) {
      const purify = global.DOMPurify;
      if (!purify || typeof purify.sanitize !== "function") return html;
      return purify.sanitize(html, {
        USE_PROFILES: { html: true },
        ADD_ATTR: ["target", "rel", "align", "type", "checked", "disabled"],
        // markdown-it emits `style="text-align:…"` for aligned table columns and
        // task-list inputs for `- [x]`; both are part of the rendered contract.
        ADD_TAGS: ["input", "col", "colgroup"],
        ALLOW_DATA_ATTR: false,
        FORBID_TAGS: ["form"],
        FORBID_ATTR: ["srcset", "onerror", "onload", "formaction"],
      });
    }

    function parseSanitizedFragment(html) {
      const template = document.createElement("template");
      template.innerHTML = html;
      return template.content;
    }

    function applyMarkdownDomContract(html) {
      const fragment = parseSanitizedFragment(html);
      const toc = [];
      const headings = fragment.querySelectorAll("h1, h2, h3, h4, h5, h6");
      headings.forEach((heading, index) => {
        const id = `markdown-heading-${index + 1}`;
        heading.id = id;
        toc.push({
          id,
          level: Number(heading.tagName.slice(1)),
          text: (heading.textContent || "").trim(),
        });
      });
      applyMarkdownLinkPolicy(fragment);
      const tableCount = wrapMarkdownTables(fragment);
      return { fragment, toc, headingCount: headings.length, tableCount };
    }

    function applyMarkdownLinkPolicy(fragment) {
      fragment.querySelectorAll("a[href]").forEach((link) => {
        const href = link.getAttribute("href") || "";
        if (!SAFE_MARKDOWN_LINK.test(href.trim())) {
          // Never let a document define a javascript: or unknown-scheme target.
          link.replaceWith(document.createTextNode(link.textContent || ""));
          return;
        }
        if (!href.trim().startsWith("#")) {
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noopener noreferrer");
        }
      });
    }

    function wrapMarkdownTables(fragment) {
      let count = 0;
      fragment.querySelectorAll("table").forEach((table) => {
        // Tables without an explicit <thead> come from delimiters the previous
        // parser rejected; wrap them so styling and column resizing still apply.
        const wrap = document.createElement("div");
        wrap.className = "markdown-table-wrap";
        const columnCount = table.querySelectorAll("thead th").length
          || table.querySelector("tbody tr")?.children.length
          || 0;
        const rowCount = table.querySelectorAll("tbody tr").length;
        wrap.dataset.rowCount = String(rowCount);
        wrap.dataset.columnCount = String(columnCount);
        const caption = document.createElement("div");
        caption.className = "markdown-table-caption";
        const captionLabel = document.createElement("span");
        captionLabel.textContent = "表格";
        const captionMeta = document.createElement("span");
        captionMeta.textContent = `${rowCount} 行 · ${columnCount} 列`;
        caption.append(captionLabel, captionMeta);
        table.setAttribute("aria-rowcount", String(rowCount + (table.querySelector("thead") ? 1 : 0)));
        const colgroup = document.createElement("colgroup");
        for (let index = 0; index < columnCount; index += 1) {
          const col = document.createElement("col");
          col.dataset.colIndex = String(index);
          colgroup.append(col);
        }
        table.prepend(colgroup);
        table.replaceWith(wrap);
        wrap.append(caption, table);
        count += 1;
      });
      return count;
    }

    function markdownToHtml(source) {
      const text = String(source || "");
      const rendered = renderWithEngine(text);
      const lineCount = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n").length;
      const wordCount = text.replace(/\s/g, "").length;
      if (rendered) {
        return {
          fragment: rendered.fragment,
          toc: rendered.toc,
          headingCount: rendered.headingCount,
          tableCount: rendered.tableCount,
          wordCount,
          lineCount,
          engine: "markdown-it",
        };
      }
      // Fallback kept only for the (unexpected) case where the vendored engine
      // failed to load; it renders the same shapes the DOM contract expects.
      const fallback = markdownToHtmlLegacy(text);
      return { ...fallback, fragment: parseSanitizedFragment(fallback.html), wordCount, lineCount, engine: "legacy" };
    }

    function renderMarkdownInto(target, parsed) {
      target.replaceChildren(parsed.fragment);
    }

    function markdownToHtmlLegacy(source) {
      const lines = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
      const toc = [];
      let html = "";
      let headingCount = 0;
      let wordCount = 0;
      let i = 0;
      const blockStart = (index) => {
        const line = lines[index];
        return /^(?:#{1,6}\s|```|~~~|>|[-*+]\s+|\d+[.)]\s+|---+\s*$|\*\*\*+\s*$)/.test(line);
      };
      while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed) { i += 1; continue; }
        const fence = trimmed.match(/^(```+|~~~+)\s*([\w-]*)\s*$/);
        if (fence) {
          const marker = fence[1][0];
          const codeLines = [];
          i += 1;
          while (i < lines.length && !lines[i].trim().startsWith(marker.repeat(fence[1].length))) { codeLines.push(lines[i]); i += 1; }
          if (i < lines.length) i += 1;
          const language = fence[2] ? ` class="language-${escapeMarkdownHtml(fence[2])}"` : "";
          html += `<pre><code${language}>${escapeMarkdownHtml(codeLines.join("\n"))}</code></pre>`;
          continue;
        }
        const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
        if (heading) {
          const level = heading[1].length;
          const text = heading[2].trim();
          const id = `markdown-heading-${toc.length + 1}`;
          toc.push({ id, level, text: text.replace(/[`*_~]/g, "") });
          headingCount += 1;
          html += `<h${level} id="${id}">${markdownInline(text)}</h${level}>`;
          i += 1;
          continue;
        }
        if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { html += "<hr>"; i += 1; continue; }
        if (/^\s*>/.test(line)) {
          const quoteLines = [];
          while (i < lines.length && /^\s*>/.test(lines[i])) { quoteLines.push(lines[i].replace(/^\s*>\s?/, "")); i += 1; }
          html += `<blockquote>${quoteLines.map(markdownInline).join("<br>")}</blockquote>`;
          continue;
        }
        const listMatch = line.match(/^\s*([-*+] |\d+[.)]\s+)/);
        if (listMatch) {
          const ordered = /^\s*\d/.test(line);
          const items = [];
          while (i < lines.length) {
            const match = lines[i].match(/^\s*(?:[-*+] |\d+[.)]\s+)(.*)$/);
            if (!match || (/^\s*\d/.test(lines[i]) !== ordered)) break;
            let itemText = match[1];
            const task = itemText.match(/^\[([ xX])\]\s+(.*)$/);
            if (task) items.push(`<li class="task-item"><input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""}>${markdownInline(task[2])}</li>`);
            else items.push(`<li>${markdownInline(itemText)}</li>`);
            i += 1;
          }
          html += `<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`;
          continue;
        }
        const paragraph = [line];
        i += 1;
        while (i < lines.length && lines[i].trim() && !blockStart(i)) { paragraph.push(lines[i]); i += 1; }
        html += `<p>${renderMarkdownSequence(paragraph)}</p>`;
      }
      wordCount = String(source || "").replace(/\s/g, "").length;
      return { html, toc, headingCount, tableCount: 0, wordCount, lineCount: lines.length };
    }

    function renderMarkdownSequence(lines) {
      return lines.map((line, index) => {
        const hardBreak = /(?: {2,}|\\)$/.test(line);
        const cleanLine = line.replace(/ {2,}$/, "").replace(/\\$/, "");
        const separator = index === lines.length - 1
          ? ""
          : hardBreak
            ? "<br>"
            : markdownSoftBreakSeparator(line, lines[index + 1]);
        return markdownInline(cleanLine) + separator;
      }).join("");
    }

    function markdownSoftBreakSeparator(previousLine, nextLine) {
      const previous = String(previousLine || "").trimEnd();
      const next = String(nextLine || "").trimStart();
      if (!previous || !next) return "";
      // Markdown treats a single source newline as whitespace. Avoid inserting
      // visible spaces between CJK characters while keeping English words apart.
      if (/[\u3400-\u9fff]$/.test(previous) || /^[\u3400-\u9fff]/.test(next)) return "";
      return " ";
    }

    function renderMarkdownToc(toc) {
      elements.markdownTocList.replaceChildren();
      state.markdownTocItems = toc.map((item) => item.id);
      if (!toc.length) {
        const empty = document.createElement("span");
        empty.className = "markdown-toc-empty";
        empty.textContent = "文档中没有标题";
        elements.markdownTocList.append(empty);
        if (elements.markdownTocCurrent) elements.markdownTocCurrent.textContent = "";
        return;
      }
      const fragment = document.createDocumentFragment();
      toc.forEach((item) => {
        const link = document.createElement("a");
        link.href = `#${item.id}`;
        link.textContent = item.text;
        link.className = `toc-level-${Math.min(3, item.level)}`;
        link.dataset.target = item.id;
        link.title = item.text;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        fragment.append(link);
      });
      elements.markdownTocList.append(fragment);
    }

    function setMarkdownFontScale(value, persist = true) {
      state.markdownFontScale = Math.max(0.8, Math.min(1.4, Math.round((Number(value) || 1) * 10) / 10));
      elements.markdownRendered.style.setProperty("--md-scale", String(state.markdownFontScale));
      elements.markdownFontValue.textContent = `${Math.round(state.markdownFontScale * 100)}%`;
      elements.markdownFontDown.disabled = state.markdownFontScale <= 0.8;
      elements.markdownFontUp.disabled = state.markdownFontScale >= 1.4;
      if (persist) updateMarkdownLayout();
    }

    function toggleMarkdownTableFit() {
      state.markdownTableFit = !state.markdownTableFit;
      elements.markdownTableFit.classList.toggle("active", state.markdownTableFit);
      elements.markdownTableFit.setAttribute("aria-pressed", String(state.markdownTableFit));
      // Manual column widths conflict with the fit toggle, so switching it
      // clears every manually resized table back to auto layout.
      clearAllManualTableWidths();
      updateMarkdownLayout();
    }

    function updateMarkdownLayout() {
      if (!elements.markdownRendered || elements.markdownRendered.classList.contains("hidden")) return;
      const available = (state.markdownEditMode ? elements.markdownRendered?.clientWidth : elements.markdownContent?.clientWidth) || 0;
      elements.markdownRendered.querySelectorAll(".markdown-table-wrap").forEach((wrap) => {
        const table = wrap.querySelector("table");
        if (!table) return;
        // Manually resized tables keep their widths on resize/re-render paths
        // (window resize, font scale, layout updates) until the document is
        // re-rendered, which rebuilds innerHTML and clears the marker.
        if (table.classList.contains("manual-col-widths")) return;
        const columns = Number(wrap.dataset.columnCount || table.querySelectorAll("thead th").length || 0);
        const wide = columns >= 6 || (columns >= 5 && available < 700);
        wrap.classList.toggle("wide-table", wide);
        wrap.classList.toggle("no-fit", !state.markdownTableFit);
        wrap.classList.toggle("compact", state.markdownTableFit && available < 760);
        table.setAttribute("data-auto-rows", state.markdownTableFit ? "true" : "false");
      });
    }

    // --- Manual table column width resizing (session-only) ---
    // Dragging a header cell's right edge resizes that column and its right
    // neighbour by the same delta, keeping the table at 100% width. Widths are
    // written to <col> elements; unset columns share the remaining space via
    // table-layout:fixed. Re-rendering rebuilds innerHTML, clearing all manual
    // widths back to the default layout.

    const MIN_COLUMN_WIDTH = 80; // keep in sync with markdown.css th/td min-width

    let columnDrag = null;

    function findColumnResizeTarget(event, checkPointer = true) {
      if (event.button !== 0) return null;
      if (checkPointer && event.pointerType !== "mouse") return null;
      const th = event.target.closest?.("thead th");
      if (!th || !th.closest(".markdown-table-wrap")) return null;
      const table = th.closest("table");
      if (!table) return null;
      const headers = table.querySelectorAll("thead th");
      const colIndex = Array.prototype.indexOf.call(headers, th);
      if (colIndex < 0 || colIndex >= headers.length - 1) return null; // no grip on the last column / single-column table
      if (th.getBoundingClientRect().right - event.clientX > 8) return null; // must hit the right-edge grip
      return { table, colIndex };
    }

    function startColumnDrag(event, { table, colIndex }) {
      const cols = table.querySelectorAll("col");
      const col = cols[colIndex];
      const neighbor = cols[colIndex + 1];
      if (!col || !neighbor) return;
      // Switch to fixed layout on pointerdown (not on release) so the width
      // changes apply pixel-perfect while dragging even on no-fit/wide tables
      // that normally use table-layout:auto.
      table.classList.add("manual-col-widths");
      const headers = table.querySelectorAll("thead th");
      columnDrag = {
        table, colIndex, pointerId: event.pointerId,
        col, neighbor, th: headers[colIndex],
        startX: event.clientX,
        startLeft: headers[colIndex].getBoundingClientRect().width,
        startRight: headers[colIndex + 1].getBoundingClientRect().width,
      };
      columnDrag.th.classList.add("is-resizing");
      document.body.classList.add("resizing-column");
      elements.markdownRendered.setPointerCapture(event.pointerId);
    }

    function moveColumnDrag(event) {
      if (!columnDrag) return;
      // Edit-mode preview re-renders (180ms debounce) can rebuild innerHTML
      // mid-drag, detaching the captured <col> elements; abort silently.
      if (!columnDrag.table.isConnected || !columnDrag.col.isConnected) {
        endColumnDrag();
        return;
      }
      const dx = event.clientX - columnDrag.startX;
      // Keep the dragged pair's total width constant: cap dx so the right
      // neighbour never drops below its minimum, otherwise unset columns
      // would be squeezed below their floor and the table would overflow.
      const cappedDx = Math.min(dx, columnDrag.startRight - MIN_COLUMN_WIDTH);
      columnDrag.col.style.width = `${Math.max(MIN_COLUMN_WIDTH, columnDrag.startLeft + cappedDx)}px`;
      columnDrag.neighbor.style.width = `${Math.max(MIN_COLUMN_WIDTH, columnDrag.startRight - cappedDx)}px`;
    }

    function endColumnDrag() {
      if (!columnDrag) return;
      columnDrag.th.classList.remove("is-resizing");
      document.body.classList.remove("resizing-column");
      if (elements.markdownRendered.hasPointerCapture(columnDrag.pointerId)) {
        elements.markdownRendered.releasePointerCapture(columnDrag.pointerId);
      }
      columnDrag = null;
    }

    function resetColumnWidth(event) {
      const target = findColumnResizeTarget(event, false);
      if (!target) return;
      const col = target.table.querySelector(`col[data-col-index="${target.colIndex}"]`);
      if (col) col.style.width = "";
      // If no column keeps a manual width, drop the marker and recompute the
      // wrap classes (wide-table/no-fit/compact may be stale from before drag).
      if (!target.table.querySelector('col[style*="width"]')) {
        target.table.classList.remove("manual-col-widths");
        updateMarkdownLayout();
      }
    }

    function clearManualTableWidths(table) {
      table.querySelectorAll("col").forEach((col) => { col.style.width = ""; });
      table.classList.remove("manual-col-widths");
    }

    function clearAllManualTableWidths() {
      elements.markdownRendered?.querySelectorAll("table.manual-col-widths").forEach(clearManualTableWidths);
    }

    function bindTableColumnResize() {
      elements.markdownRendered.addEventListener("pointerdown", (event) => {
        const target = findColumnResizeTarget(event);
        if (target) startColumnDrag(event, target);
      });
      elements.markdownRendered.addEventListener("pointermove", moveColumnDrag);
      elements.markdownRendered.addEventListener("pointerup", endColumnDrag);
      elements.markdownRendered.addEventListener("pointercancel", endColumnDrag);
      elements.markdownRendered.addEventListener("lostpointercapture", endColumnDrag);
      elements.markdownRendered.addEventListener("dblclick", resetColumnWidth);
      // Header cells may contain links; prevent HTML5 drag ghosts on them.
      elements.markdownRendered.addEventListener("dragstart", (event) => {
        if (event.target.closest?.("thead th")) event.preventDefault();
      });
    }

    // Which section is being read, tracked from the scroll position rather than
    // from the last click, so a heading reached by scrolling, by search, or by
    // the outline all agree.
    //
    // This drives the outline only. Headings are deliberately NOT sticky (see
    // markdown.css): several headings pinned at the same offset stack on top of
    // one another, and the outline already answers "where am I" without also
    // restyling the heading in the reading column.
    function updateMarkdownStickyHeading() {
      if (!elements.markdownRendered || elements.markdownRendered.classList.contains("hidden") || !elements.markdownContent) return;
      const headings = [...elements.markdownRendered.querySelectorAll("h2, h3, h4, h5, h6")];
      const scrollRoot = state.markdownEditMode ? elements.markdownRendered : elements.markdownContent;
      const contentTop = scrollRoot.getBoundingClientRect().top;
      syncMarkdownTocActive(currentMarkdownHeading(headings, contentTop), scrollRoot);
    }

    // The heading being read is the last one whose *bottom* has passed the top
    // edge, not the last whose top has: a heading is already "current" while it
    // is still partly visible under the toolbar.
    function currentMarkdownHeading(headings, contentTop) {
      let current = null;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().bottom <= contentTop + 4) current = heading;
        else break;
      }
      return current || headings[0] || null;
    }

    // Keep the outline's own scroll position pinned to the section being read.
    function syncMarkdownTocActive(active, scrollRoot) {
      const links = [...elements.markdownTocList.querySelectorAll("a")];
      if (!links.length) return;
      const activeId = active?.id || (state.markdownTocItems?.[0] ?? "");
      let currentLink = null;
      for (const link of links) {
        const isCurrent = link.dataset.target === activeId;
        link.classList.toggle("active", isCurrent);
        link.setAttribute("aria-current", isCurrent ? "true" : "false");
        if (isCurrent) currentLink = link;
      }
      if (elements.markdownTocCurrent) {
        elements.markdownTocCurrent.textContent = currentLink ? currentLink.textContent : "";
      }
      // Keep the active row inside the outline's own viewport without moving
      // the document: `nearest` is a no-op when it is already visible.
      currentLink?.scrollIntoView({ block: "nearest" });
      const scrollable = scrollRoot.scrollHeight - scrollRoot.clientHeight;
      const ratio = scrollable > 0 ? Math.min(1, Math.max(0, scrollRoot.scrollTop / scrollable)) : 0;
      if (elements.markdownTocProgress) {
        const height = elements.markdownToc?.clientHeight || 0;
        elements.markdownTocProgress.style.height = `${Math.round(ratio * height)}px`;
      }
    }

    async function toggleMarkdownFullscreen() {
      const workspace = elements.markdownWorkspace;
      if (!workspace) return;
      try {
        if (document.fullscreenElement === workspace) await document.exitFullscreen();
        else if (workspace.requestFullscreen) await workspace.requestFullscreen();
        else throw new Error("fullscreen unavailable");
      } catch (_) {
        workspace.classList.toggle("fullscreen-fallback");
        updateMarkdownFullscreenButton();
      }
    }

    function updateMarkdownFullscreenButton() {
      const active = document.fullscreenElement === elements.markdownWorkspace || elements.markdownWorkspace.classList.contains("fullscreen-fallback");
      elements.markdownFullscreen.textContent = active ? "退出全屏" : "全屏查看";
      elements.markdownFullscreen.setAttribute("aria-pressed", String(active));
    }

    bindTableColumnResize();

    document.addEventListener("fullscreenchange", updateMarkdownFullscreenButton);
    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && state.markdownEditMode) {
        event.preventDefault();
        downloadMarkdownSource();
        return;
      }
      if (event.key === "Escape" && elements.markdownWorkspace?.classList.contains("fullscreen-fallback")) {
        elements.markdownWorkspace.classList.remove("fullscreen-fallback");
        updateMarkdownFullscreenButton();
      }
    });

    return {
      isMarkdownFile,
      openFiles: openMarkdownFiles,
      renderDocument: renderMarkdownDocument,
      updatePreview: updateMarkdownPreview,
      toggleEdit: toggleMarkdownEdit,
      handleEditorInput: handleMarkdownEditorInput,
      syncEditorScroll: syncMarkdownEditorScroll,
      syncPreviewScroll: syncMarkdownPreviewScroll,
      downloadSource: downloadMarkdownSource,
      setFontScale: setMarkdownFontScale,
      toggleTableFit: toggleMarkdownTableFit,
      updateLayout: updateMarkdownLayout,
      updateStickyHeading: updateMarkdownStickyHeading,
      toggleFullscreen: toggleMarkdownFullscreen,
      updateFullscreenButton: updateMarkdownFullscreenButton,
    };
  }

  global.MarkdownFeature = { create: createMarkdownFeature };
})(window);
