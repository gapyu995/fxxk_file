(function (global) {
  "use strict";

  // Tool definitions drive the sidebar only; every panel's fields live in
  // index.html so the page keeps the same static-markup contract as the other
  // workspaces.
  const GROUPS = [
    { key: "text", label: "中文排版", hint: "编码、全角半角、中英标点" },
    { key: "tables", label: "表格互转", hint: "CSV / TSV / JSON / Markdown / HTML" },
    { key: "subtitles", label: "字幕互转", hint: "SRT / VTT / ASS / SSA / LRC" },
    { key: "documents", label: "文档互转", hint: "HTML → Markdown、DOCX ↔ Markdown" },
    { key: "pdf", label: "PDF 页面", hint: "合并、拆分、提取、删页、旋转、水印" },
    { key: "language", label: "数字与拼音", hint: "金额大写、中文数字、拼音标注" },
  ];

  function createConvertFeature({ elements, api, showToast }) {
    const state = { group: "text", capabilities: null };

    // Options come from the module's own tables so the HTML stays markup-free
    // and there is one list to change when a format is added.
    const TEXT_MODES = [
      { value: "transcode", label: "检测编码并转为 UTF-8" },
      { value: "fullwidth_to_halfwidth", label: "全角 → 半角" },
      { value: "halfwidth_to_fullwidth", label: "半角 → 全角" },
      { value: "punctuation_to_zh", label: "英文标点 → 中文标点" },
      { value: "punctuation_to_en", label: "中文标点 → 英文标点" },
    ];
    const TABLE_FORMATS = [
      { value: "", label: "自动识别" },
      { value: "csv", label: "CSV" },
      { value: "tsv", label: "TSV" },
      { value: "json", label: "JSON" },
      { value: "markdown", label: "Markdown 表格" },
      { value: "html", label: "HTML 表格" },
    ];
    const TABLE_OUTPUTS = TABLE_FORMATS.filter((item) => item.value);
    const SUBTITLE_TARGETS = [".srt", ".vtt", ".ass", ".ssa", ".lrc"].map((value) => ({ value, label: value }));
    const PDF_MODES = [
      { value: "merge", label: "合并多个 PDF" },
      { value: "split", label: "按页拆分为多个文件" },
      { value: "extract", label: "提取指定页" },
      { value: "delete", label: "删除指定页" },
      { value: "rotate", label: "旋转页面" },
      { value: "watermark", label: "添加文字水印" },
    ];

    function fillSelect(select, options, selected) {
      if (!select) return;
      select.replaceChildren();
      for (const option of options) {
        const node = document.createElement("option");
        node.value = option.value;
        node.textContent = option.label;
        if (option.value === selected) node.selected = true;
        select.append(node);
      }
    }

    function fillStaticOptions() {
      fillSelect(elements.convertTextMode, TEXT_MODES, "transcode");
      fillSelect(elements.convertTableSource, TABLE_FORMATS, "");
      fillSelect(elements.convertTableTarget, TABLE_OUTPUTS, "markdown");
      fillSelect(elements.convertSubtitleTarget, SUBTITLE_TARGETS, ".srt");
      fillSelect(elements.convertPdfMode, PDF_MODES, "merge");
    }

    async function loadCapabilities() {
      try {
        const result = await api("/api/convert/capabilities");
        state.capabilities = result.groups || {};
      } catch (error) {
        state.capabilities = {};
        showToast(`无法读取转换能力：${error.message}`, true);
      }
      renderGroups();
      return state.capabilities;
    }

    function renderGroups() {
      elements.convertGroups.replaceChildren();
      for (const group of GROUPS) {
        const capability = state.capabilities?.[group.key];
        const unavailable = Boolean(capability && !capability.available);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "convert-group";
        button.dataset.group = group.key;
        button.setAttribute("aria-pressed", String(state.group === group.key));
        button.disabled = unavailable;
        const label = document.createElement("strong");
        label.textContent = group.label;
        const hint = document.createElement("span");
        hint.textContent = unavailable ? "需要安装可选依赖" : group.hint;
        button.append(label, hint);
        if (unavailable) button.title = capability.reason || "";
        button.addEventListener("click", () => selectGroup(group.key));
        elements.convertGroups.append(button);
      }
    }

    function selectGroup(key) {
      state.group = key;
      for (const button of elements.convertGroups.querySelectorAll(".convert-group")) {
        button.setAttribute("aria-pressed", String(button.dataset.group === key));
      }
      for (const panel of elements.convertPanels.querySelectorAll(".convert-panel")) {
        panel.classList.toggle("hidden", panel.dataset.panel !== key);
      }
      clearResult();
    }

    function clearResult() {
      elements.convertStatus.textContent = "";
      elements.convertStatus.classList.remove("busy");
      elements.convertResult.classList.add("hidden");
      elements.convertResult.classList.remove("file-only");
      elements.convertResultText.value = "";
      elements.convertFiles.replaceChildren();
    }

    function showResult(payload, title = "转换完成") {
      elements.convertResult.classList.remove("hidden", "file-only");
      elements.convertTitle.textContent = title;
      elements.convertResultText.value = payload || "";
      const characters = payload ? [...payload].length : 0;
      const lines = payload ? payload.replace(/\n$/, "").split("\n").length : 0;
      elements.convertStats.textContent = payload ? `${characters} 个字符 · ${lines} 行` : "";
    }

    // Some conversions produce a file instead of text (DOCX, PDF, ZIP). The
    // card then drops the textarea and the copy/save row, because there is
    // nothing to copy — only a download button.
    function showFileResult(title) {
      elements.convertResult.classList.remove("hidden");
      elements.convertResult.classList.add("file-only");
      elements.convertTitle.textContent = title;
      elements.convertResultText.value = "";
      elements.convertStats.textContent = "";
    }

    function syncSubPanels() {
      const subtitleMode = elements.convertSubtitleMode.value;
      elements.convertSubtitleSingle.classList.toggle("hidden", subtitleMode === "merge");
      elements.convertSubtitlePair.classList.toggle("hidden", subtitleMode !== "merge");
      elements.convertSubtitleTargetField.classList.toggle("hidden", subtitleMode !== "convert");

      const documentMode = elements.convertDocumentMode.value;
      elements.convertDocumentFileField.classList.toggle("hidden", documentMode === "markdown_to_docx");

      const pdfMode = elements.convertPdfMode.value;
      elements.convertPdfPagesField.classList.toggle("hidden", !["extract", "delete", "rotate"].includes(pdfMode));
      elements.convertPdfDegreesField.classList.toggle("hidden", pdfMode !== "rotate");
      elements.convertPdfTextField.classList.toggle("hidden", pdfMode !== "watermark");
    }

    // --- runners -----------------------------------------------------------

    async function runText() {
      const form = new FormData();
      form.append("mode", elements.convertTextMode.value);
      form.append("content", elements.convertTextInput.value);
      const file = elements.convertTextFile.files[0];
      if (file) form.append("file", file);
      const result = await api("/api/convert/text", { method: "POST", body: form });
      showResult(result.text, result.source_encoding ? `检测到编码：${result.source_encoding}` : "转换完成");
    }

    async function runTables() {
      const form = new FormData();
      form.append("data", elements.convertTableInput.value);
      form.append("source", elements.convertTableSource.value);
      form.append("target", elements.convertTableTarget.value);
      const result = await api("/api/convert/tables", { method: "POST", body: form });
      showResult(result.text, `来源格式：${result.source}`);
    }

    async function runSubtitles() {
      const mode = elements.convertSubtitleMode.value;
      if (mode === "merge") {
        const [first, second] = elements.convertSubtitlePair.files;
        if (!first || !second) throw new Error("合并需要选择两份字幕文件。");
        const form = new FormData();
        form.append("first", first);
        form.append("second", second);
        form.append("separator", "\n");
        const result = await api("/api/convert/subtitles/merge", { method: "POST", body: form });
        showResult(result.text, `已合并，共 ${result.info.events} 条字幕`);
        addDownloadButton(result.filename, result.text);
        return;
      }
      const file = elements.convertSubtitleSingle.files[0];
      if (!file) throw new Error("请先选择字幕文件。");
      const form = new FormData();
      form.append("file", file);
      if (mode === "split") {
        const result = await api("/api/convert/subtitles/split", { method: "POST", body: form });
        showResult(
          result.files.map((item) => `===== ${item.filename} =====\n${item.text}`).join("\n"),
          `已拆分为 ${result.files.length} 条字幕轨`,
        );
        for (const item of result.files) addDownloadButton(item.filename, item.text);
        return;
      }
      form.append("target", elements.convertSubtitleTarget.value);
      const result = await api("/api/convert/subtitles/convert", { method: "POST", body: form });
      showResult(result.text, `已转换为 ${result.filename}（${result.info.events} 条字幕）`);
      addDownloadButton(result.filename, result.text);
    }

    async function runDocuments() {
      const mode = elements.convertDocumentMode.value;
      const form = new FormData();
      form.append("content", elements.convertDocumentInput.value);
      const file = elements.convertDocumentFile.files[0];
      if (file) form.append("file", file);
      if (mode === "markdown_to_docx") {
        const response = await fetch(`/api/convert/documents/${mode}`, { method: "POST", body: form });
        if (!response.ok) throw new Error(await readError(response));
        saveBlob(await response.blob(), "converted.docx");
        showFileResult("已生成 converted.docx 并开始下载");
        return;
      }
      const result = await api(`/api/convert/documents/${mode}`, { method: "POST", body: form });
      showResult(result.text, mode === "html_to_markdown" ? "HTML → Markdown" : "DOCX → Markdown");
    }

    async function runPdf() {
      const files = [...elements.convertPdfFiles.files];
      if (!files.length) throw new Error("请先选择 PDF 文件。");
      const mode = elements.convertPdfMode.value;
      const form = new FormData();
      for (const file of files) form.append("files", file);
      form.append("pages", elements.convertPdfPages.value || "all");
      form.append("degrees", elements.convertPdfDegrees.value || "90");
      form.append("watermark_text", elements.convertPdfText.value || "");
      const response = await fetch(`/api/convert/pdf/${mode}`, { method: "POST", body: form });
      if (!response.ok) throw new Error(await readError(response));
      if (mode === "split") {
        const result = await response.json();
        showFileResult(`已拆分为 ${result.count} 个单页 PDF`);
        const link = document.createElement("a");
        link.className = "button primary";
        link.href = result.download_url;
        link.textContent = "下载拆分结果 ZIP";
        elements.convertFiles.append(link);
        return;
      }
      const names = {
        merge: "merged.pdf",
        extract: "extracted.pdf",
        delete: "pages-removed.pdf",
        rotate: "rotated.pdf",
        watermark: "watermarked.pdf",
      };
      const filename = names[mode] || "output.pdf";
      saveBlob(await response.blob(), filename);
      showFileResult(`已生成 ${filename} 并开始下载`);
    }

    async function runLanguage() {
      const form = new FormData();
      form.append("mode", elements.convertLanguageMode.value);
      form.append("value", elements.convertLanguageInput.value);
      form.append("style", elements.convertLanguageStyle.value);
      const result = await api("/api/convert/language", { method: "POST", body: form });
      showResult(result.text, "转换完成");
    }

    const RUNNERS = {
      text: runText,
      tables: runTables,
      subtitles: runSubtitles,
      documents: runDocuments,
      pdf: runPdf,
      language: runLanguage,
    };

    async function run() {
      const button = elements.convertRun;
      button.disabled = true;
      elements.convertStatus.classList.add("busy");
      elements.convertStatus.textContent = "正在转换…";
      try {
        clearResult();
        elements.convertStatus.classList.add("busy");
        elements.convertStatus.textContent = "正在转换…";
        await RUNNERS[state.group]();
        clearStatus();
      } catch (error) {
        clearStatus();
        showToast(error.message, true);
      } finally {
        button.disabled = false;
      }
    }

    function clearStatus() {
      elements.convertStatus.classList.remove("busy");
      elements.convertStatus.textContent = "";
    }

    function addDownloadButton(filename, text) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button";
      button.textContent = `下载 ${filename}`;
      button.addEventListener("click", () => downloadText(text, filename));
      elements.convertFiles.append(button);
    }

    function downloadText(text, filename) {
      saveBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), filename);
    }

    function saveBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    async function saveResult() {
      const value = elements.convertResultText.value;
      if (!value) {
        showToast("当前没有可保存的文本结果。", true);
        return;
      }
      downloadText(value, "converted.txt");
    }

    async function copyResult() {
      const value = elements.convertResultText.value;
      if (!value) return;
      try {
        await navigator.clipboard.writeText(value);
        showToast("已复制到剪贴板。", false);
      } catch (_) {
        elements.convertResultText.select();
        showToast("浏览器不允许自动复制，已为你选中内容。", true);
      }
    }

    async function readError(response) {
      try {
        const data = await response.json();
        return Array.isArray(data.detail)
          ? data.detail.map((item) => item.msg).join("；")
          : data.detail || `请求失败（HTTP ${response.status}）`;
      } catch (_) {
        return `请求失败（HTTP ${response.status}）`;
      }
    }

    function bind() {
      elements.convertRun.addEventListener("click", run);
      elements.convertSave.addEventListener("click", saveResult);
      elements.convertCopy.addEventListener("click", copyResult);
      elements.convertClear.addEventListener("click", clearResult);
      for (const select of [elements.convertSubtitleMode, elements.convertDocumentMode, elements.convertPdfMode]) {
        select.addEventListener("change", syncSubPanels);
      }
      syncSubPanels();
    }

    function init() {
      fillStaticOptions();
      bind();
      loadCapabilities();
      selectGroup(state.group);
    }

    return { init, selectGroup, loadCapabilities, run, fillStaticOptions };
  }

  global.ConvertFeature = { create: createConvertFeature, GROUPS };
})(window);
