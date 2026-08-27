(function (global) {
  "use strict";

  function createMarkdownFeature({ state, elements, showToast, applyFunctionTheme }) {
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
        elements.functionTrigger.firstChild.textContent = "Markdown 查看 ";
        applyFunctionTheme("markdown");
        elements.reviewWorkspace.classList.add("hidden");
        elements.compareWorkspace.classList.add("hidden");
        elements.imagesWorkspace.classList.add("hidden");
        elements.markdownWorkspace.classList.remove("hidden");
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
      elements.markdownRendered.innerHTML = parsed.html;
      elements.markdownRendered.classList.remove("hidden");
      elements.markdownEmpty.classList.add("hidden");
      elements.markdownEditor.classList.add("hidden");
      elements.markdownContent.classList.remove("markdown-editing");
      elements.markdownEditToggle.textContent = "缂栬緫 Markdown";
      elements.markdownEditToggle.setAttribute("aria-pressed", "false");
      elements.markdownFileMeta.textContent = `${file.name} · ${formatMarkdownBytes(file.size)} · ${parsed.lineCount} 行`;
      elements.markdownStatus.textContent = `${parsed.wordCount.toLocaleString()} 个字符 · ${parsed.headingCount} 个标题 · ${parsed.tableCount} 个表格`;
      renderMarkdownToc(parsed.toc);
      setMarkdownFontScale(state.markdownFontScale, false);
      updateMarkdownLayout();
      updateMarkdownStickyHeading();
    }

    function updateMarkdownPreview(source, statusSuffix = "") {
      const previousRatio = state.markdownEditMode ? markdownScrollRatio(elements.markdownRendered) : null;
      const parsed = markdownToHtml(source);
      elements.markdownRendered.innerHTML = parsed.html;
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

    function markdownInline(value) {
      let output = escapeMarkdownHtml(value);
      const tokens = [];
      const token = (html) => {
        const marker = `\u0000MD${tokens.length}\u0000`;
        tokens.push(html);
        return marker;
      };
      output = output.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_, alt, url, title) => {
        const safeUrl = safeMarkdownUrl(url);
        if (safeUrl === "#") return escapeMarkdownHtml(alt || "图片");
        const titleAttr = title ? ` title="${escapeMarkdownHtml(title)}"` : "";
        return token(`<img src="${escapeMarkdownHtml(safeUrl)}" alt="${escapeMarkdownHtml(alt)}"${titleAttr} loading="lazy">`);
      });
      output = output.replace(/\[([^\]]+)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_, label, url, title) => {
        const safeUrl = safeMarkdownUrl(url);
        if (safeUrl === "#") return label;
        const titleAttr = title ? ` title="${escapeMarkdownHtml(title)}"` : "";
        return token(`<a href="${escapeMarkdownHtml(safeUrl)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`);
      });
      output = output.replace(/`([^`\n]+)`/g, (_, code) => token(`<code>${code}</code>`));
      output = output.replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, (_, boldA, boldB) => `<strong>${boldA || boldB}</strong>`);
      output = output.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
      output = output.replace(/\*([^*\n]+)\*|_([^_\n]+)_/g, (_, italicA, italicB) => `<em>${italicA || italicB}</em>`);
      output = output.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, prefix, url) => `${prefix}${token(`<a href="${escapeMarkdownHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeMarkdownHtml(url)}</a>`)}`);
      return output.replace(/\u0000MD(\d+)\u0000/g, (_, index) => tokens[Number(index)] || "");
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

    function renderMarkdownParagraph(lines) {
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

    function splitMarkdownTableRow(line) {
      let value = String(line || "").trim();
      if (value.startsWith("|")) value = value.slice(1);
      if (value.endsWith("|")) value = value.slice(0, -1);
      const cells = [];
      let current = "";
      let escaped = false;
      for (const char of value) {
        if (char === "|" && !escaped) {
          cells.push(current.trim().replace(/\\\|/g, "|"));
          current = "";
          continue;
        }
        if (char === "\\" && !escaped) { escaped = true; current += char; continue; }
        escaped = false;
        current += char;
      }
      cells.push(current.trim().replace(/\\\|/g, "|"));
      return cells;
    }

    function isMarkdownTableSeparator(line) {
      const cells = splitMarkdownTableRow(line);
      return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
    }

    function renderMarkdownTable(headerLine, separatorLine, rowLines) {
      const headers = splitMarkdownTableRow(headerLine);
      const separators = splitMarkdownTableRow(separatorLine);
      const alignments = headers.map((_, index) => {
        const cell = separators[index] || "";
        return cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.startsWith(":") ? "left" : cell.endsWith(":") ? "right" : "";
      });
      const head = headers.map((cell, index) => `<th${alignments[index] ? ` style="text-align:${alignments[index]}"` : ""}>${markdownInline(cell)}</th>`).join("");
      const rows = rowLines.map((line) => {
        const cells = splitMarkdownTableRow(line);
        while (cells.length < headers.length) cells.push("");
        return `<tr>${headers.map((_, index) => `<td${alignments[index] ? ` style="text-align:${alignments[index]}"` : ""}>${markdownInline(cells[index] || "")}</td>`).join("")}</tr>`;
      }).join("");
      const rowCount = rowLines.length;
      return `<div class="markdown-table-wrap" data-row-count="${rowCount}" data-column-count="${headers.length}"><div class="markdown-table-caption"><span>表格</span><span>${rowCount} 行 · ${headers.length} 列</span></div><table aria-rowcount="${rowCount + 1}"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function markdownToHtml(source) {
      const lines = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
      const toc = [];
      let html = "";
      let headingCount = 0;
      let tableCount = 0;
      let wordCount = 0;
      let i = 0;
      const blockStart = (line, next) => /^(?:#{1,6}\s|```|~~~|>|[-*+]\s+|\d+[.)]\s+|---+\s*$|\*\*\*+\s*$)/.test(line) || (next && isMarkdownTableSeparator(next));
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
        if (i + 1 < lines.length && line.includes("|") && isMarkdownTableSeparator(lines[i + 1])) {
          const separatorLine = lines[i + 1];
          const rowLines = [];
          i += 2;
          while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { rowLines.push(lines[i]); i += 1; }
          html += renderMarkdownTable(line, separatorLine, rowLines);
          tableCount += 1;
          continue;
        }
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
        while (i < lines.length && lines[i].trim() && !blockStart(lines[i], lines[i + 1])) { paragraph.push(lines[i]); i += 1; }
        html += `<p>${renderMarkdownParagraph(paragraph)}</p>`;
      }
      wordCount = String(source || "").replace(/\s/g, "").length;
      return { html, toc, headingCount, tableCount, wordCount, lineCount: lines.length };
    }

    function renderMarkdownToc(toc) {
      elements.markdownTocList.replaceChildren();
      if (!toc.length) {
        elements.markdownTocList.innerHTML = '<span class="markdown-toc-empty">文档中没有标题</span>';
        return;
      }
      const fragment = document.createDocumentFragment();
      toc.forEach((item) => {
        const link = document.createElement("a");
        link.href = `#${item.id}`;
        link.textContent = item.text;
        link.className = `toc-level-${Math.min(3, item.level)}`;
        link.dataset.target = item.id;
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
      updateMarkdownLayout();
    }

    function updateMarkdownLayout() {
      if (!elements.markdownRendered || elements.markdownRendered.classList.contains("hidden")) return;
      const available = (state.markdownEditMode ? elements.markdownRendered?.clientWidth : elements.markdownContent?.clientWidth) || 0;
      elements.markdownRendered.querySelectorAll(".markdown-table-wrap").forEach((wrap) => {
        const table = wrap.querySelector("table");
        if (!table) return;
        const columns = Number(wrap.dataset.columnCount || table.querySelectorAll("thead th").length || 0);
        const wide = columns >= 6 || (columns >= 5 && available < 700);
        wrap.classList.toggle("wide-table", wide);
        wrap.classList.toggle("no-fit", !state.markdownTableFit);
        wrap.classList.toggle("compact", state.markdownTableFit && available < 760);
        table.setAttribute("data-auto-rows", state.markdownTableFit ? "true" : "false");
      });
    }

    function updateMarkdownStickyHeading() {
      if (!elements.markdownRendered || elements.markdownRendered.classList.contains("hidden") || !elements.markdownContent) return;
      const headings = [...elements.markdownRendered.querySelectorAll("h2, h3, h4, h5, h6")];
      if (!headings.length) {
        elements.markdownContent.style.setProperty("--markdown-sticky-offset", "0px");
        elements.markdownRendered.style.setProperty("--markdown-sticky-offset", "0px");
        return;
      }
      const scrollRoot = state.markdownEditMode ? elements.markdownRendered : elements.markdownContent;
      const contentTop = scrollRoot.getBoundingClientRect().top;
      let active = null;
      for (const heading of headings) {
        const top = heading.getBoundingClientRect().top;
        if (top <= contentTop + 4) active = heading;
        else break;
      }
      for (const heading of headings) heading.classList.toggle("markdown-active-heading", heading === active);
      const stickyOffset = active ? Math.max(0, Math.ceil(active.getBoundingClientRect().height)) : 0;
      elements.markdownContent.style.setProperty("--markdown-sticky-offset", `${stickyOffset}px`);
      elements.markdownRendered.style.setProperty("--markdown-sticky-offset", `${stickyOffset}px`);
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
      updateFullscreenButton,
    };
  }

  global.MarkdownFeature = { create: createMarkdownFeature };
})(window);
