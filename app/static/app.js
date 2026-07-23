const state = {
  current: null,
  settings: null,
  pollTimer: null,
  saveTimers: new Map(),
  toastTimer: null,
  dragDepth: 0,
  viewMode: "file",
  sourceProgressIndex: null,
  segmentPageMap: null,
  segmentPageMapTask: null,
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  fileInput: $("#fileInput"),
  dropzone: $("#dropzone"),
  autoTranslate: $("#autoTranslate"),
  emptyUpload: $("#emptyUpload"),
  emptyState: $("#emptyState"),
  reviewWorkspace: $("#reviewWorkspace"),
  documentList: $("#documentList"),
  documentTitle: $("#documentTitle"),
  statusBadge: $("#statusBadge"),
  segmentCount: $("#segmentCount"),
  originalPath: $("#originalPath"),
  sourceLanguage: $("#sourceLanguage"),
  targetLanguage: $("#targetLanguage"),
  sourceHeading: $("#sourceHeading"),
  targetHeading: $("#targetHeading"),
  translationCoverage: $("#translationCoverage"),
  translateButton: $("#translateButton"),
  segmentRows: $("#segmentRows"),
  progressWrap: $("#progressWrap"),
  progressBar: $("#progressBar"),
  progressText: $("#progressText"),
  saveState: $("#saveState"),
  configDot: $("#configDot"),
  settingsDialog: $("#settingsDialog"),
  settingsForm: $("#settingsForm"),
  baseUrl: $("#baseUrl"),
  modelName: $("#modelName"),
  batchSize: $("#batchSize"),
  requestCharLimit: $("#requestCharLimit"),
  maxRetries: $("#maxRetries"),
  apiProtocol: $("#apiProtocol"),
  apiKey: $("#apiKey"),
  clearApiKey: $("#clearApiKey"),
  useSystemProxy: $("#useSystemProxy"),
  keyHint: $("#keyHint"),
  reviewBody: $("#reviewBody"),
  originalPreview: $("#originalPreview"),
  translationWorkPane: $("#translationWorkPane"),
  syncScroll: $("#syncScroll"),
  previewPageStatus: $("#previewPageStatus"),
  fileViewButton: $("#fileViewButton"),
  alignedViewButton: $("#alignedViewButton"),
  openOriginalButton: $("#openOriginalButton"),
  downloadTranslationButton: $("#downloadTranslationButton"),
  uploadOverlay: $("#uploadOverlay"),
  toast: $("#toast"),
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  try {
    const [settings] = await Promise.all([loadSettings(), loadDocumentList()]);
    state.settings = settings;
    const fromHash = location.hash.replace(/^#\/?/, "");
    if (/^[a-f0-9]{12}$/.test(fromHash)) await selectDocument(fromHash);
  } catch (error) {
    showToast(error.message, true);
  }
}

function bindEvents() {
  elements.fileInput.addEventListener("change", (event) => {
    uploadFiles([...event.target.files]);
    event.target.value = "";
  });
  elements.emptyUpload.addEventListener("click", () => elements.fileInput.click());
  $("#refreshList").addEventListener("click", loadDocumentList);
  $("#settingsButton").addEventListener("click", openSettings);
  $("#closeSettings").addEventListener("click", () => elements.settingsDialog.close());
  $("#cancelSettings").addEventListener("click", () => elements.settingsDialog.close());
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.translateButton.addEventListener("click", () => startTranslation(false));
  elements.sourceLanguage.addEventListener("change", keepDirectionDistinct);
  elements.targetLanguage.addEventListener("change", keepDirectionDistinct);
  elements.fileViewButton.addEventListener("click", () => setViewMode("file"));
  elements.alignedViewButton.addEventListener("click", () => setViewMode("aligned"));
  elements.downloadTranslationButton.addEventListener("click", downloadTranslation);
  elements.translationWorkPane.addEventListener("scroll", syncTranslationToPreview, { passive: true });
  elements.syncScroll.addEventListener("change", () => {
    if (elements.syncScroll.checked) syncTranslationToPreview();
  });
  window.addEventListener("message", handlePreviewMessage);
  window.addEventListener("resize", scheduleTranslationLayout);

  for (const target of [document.body, elements.dropzone]) {
    target.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
  }
  document.body.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth += 1;
    elements.uploadOverlay.classList.remove("hidden");
  });
  document.body.addEventListener("dragleave", (event) => {
    if (!hasFiles(event)) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (!state.dragDepth) elements.uploadOverlay.classList.add("hidden");
  });
  document.body.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth = 0;
    elements.uploadOverlay.classList.add("hidden");
    uploadFiles([...event.dataTransfer.files]);
  });
  window.addEventListener("beforeunload", saveBeforeClose);
}

function hasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    let detail = `请求失败（HTTP ${response.status}）`;
    try {
      const data = await response.json();
      detail = Array.isArray(data.detail)
        ? data.detail.map((item) => item.msg).join("；")
        : data.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

async function loadSettings() {
  const settings = await api("/api/settings");
  state.settings = settings;
  elements.configDot.classList.toggle("ready", settings.configured);
  return settings;
}

async function openSettings() {
  try {
    const settings = await loadSettings();
    elements.baseUrl.value = settings.base_url;
    elements.modelName.value = settings.model;
    elements.batchSize.value = settings.batch_size || 3;
    elements.requestCharLimit.value = settings.request_char_limit || 6000;
    elements.maxRetries.value = settings.max_retries ?? 5;
    elements.apiProtocol.value = settings.protocol || "openai";
    elements.apiKey.value = "";
    elements.clearApiKey.checked = false;
    elements.useSystemProxy.checked = Boolean(settings.use_system_proxy);
    elements.keyHint.textContent = settings.has_api_key
      ? "本机已有 API Key；留空即可保留。"
      : "未保存 API Key；CCSwitch 本地无鉴权网关可直接使用。";
    elements.settingsDialog.showModal();
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const submit = elements.settingsForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    await api("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_url: elements.baseUrl.value.trim(),
        model: elements.modelName.value.trim(),
        batch_size: Number(elements.batchSize.value),
        request_char_limit: Number(elements.requestCharLimit.value),
        max_retries: Number(elements.maxRetries.value),
        protocol: elements.apiProtocol.value,
        api_key: elements.apiKey.value.trim(),
        clear_key: elements.clearApiKey.checked,
        use_system_proxy: elements.useSystemProxy.checked,
      }),
    });
    await loadSettings();
    elements.settingsDialog.close();
    showToast("模型设置已保存。", false);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    submit.disabled = false;
  }
}

async function uploadFiles(files) {
  const supported = files.filter((file) => /\.(doc|docx|pdf)$/i.test(file.name));
  if (!supported.length) {
    showToast("请选择 DOC、DOCX 或 PDF 文件。", true);
    return;
  }
  for (const file of supported) {
    const form = new FormData();
    form.append("file", file);
    form.append("source_language", "auto");
    form.append("target_language", "auto");
    elements.dropzone.classList.add("dragging");
    elements.dropzone.querySelector("strong").textContent = `正在解析 ${file.name}…`;
    try {
      const documentData = await api("/api/documents", { method: "POST", body: form });
      setCurrentDocument(documentData, true);
      await loadDocumentList();
      showToast(`已导入 ${file.name}，共 ${documentData.segments.length} 段。`, false);
      if (elements.autoTranslate.checked) {
        if (state.settings?.configured) {
          await startTranslation(false);
        } else {
          showToast("文档已解析。配置模型后即可开始翻译。", false);
          await openSettings();
        }
      }
    } catch (error) {
      showToast(`${file.name}：${error.message}`, true);
    } finally {
      elements.dropzone.classList.remove("dragging");
      elements.dropzone.querySelector("strong").textContent = "拖入待翻译文档";
    }
  }
}

async function loadDocumentList() {
  const documents = await api("/api/documents");
  elements.documentList.replaceChildren();
  for (const documentData of documents) {
    const item = document.createElement("div");
    item.className = `document-item-wrap${state.current?.id === documentData.id ? " active" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "document-item";
    const title = document.createElement("strong");
    title.textContent = documentData.name;
    const meta = document.createElement("span");
    meta.textContent = `${languageName(documentData.source_language)} → ${languageName(documentData.target_language)} · ${statusName(documentData.status)}`;
    const track = document.createElement("div");
    track.className = "mini-progress";
    const bar = document.createElement("i");
    bar.style.width = `${documentData.progress || 0}%`;
    track.append(bar);
    button.append(title, meta, track);
    button.addEventListener("click", () => selectDocument(documentData.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "document-delete";
    remove.textContent = "×";
    remove.title = "删除最近文档记录（保留原件和译文）";
    remove.setAttribute("aria-label", `删除 ${documentData.name} 的最近文档记录`);
    remove.addEventListener("click", () => deleteDocumentRecord(documentData));
    item.append(button, remove);
    elements.documentList.append(item);
  }
  return documents;
}

async function deleteDocumentRecord(documentData) {
  const confirmed = window.confirm(
    `要从“最近文档”中删除「${documentData.name}」吗？\n\n原文件和已经生成的译文 DOCX 会继续保留。`
  );
  if (!confirmed) return;
  try {
    if (state.current?.id === documentData.id) {
      for (const timer of state.saveTimers.values()) clearTimeout(timer);
      state.saveTimers.clear();
      await api(`/api/documents/${documentData.id}/autosave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ translations: visibleTranslations() }),
      });
    }
    await api(`/api/documents/${documentData.id}`, { method: "DELETE" });
    if (state.current?.id === documentData.id) {
      stopPoll();
      state.current = null;
      elements.originalPreview.src = "about:blank";
      elements.reviewWorkspace.classList.add("hidden");
      elements.emptyState.classList.remove("hidden");
      history.replaceState(null, "", location.pathname);
    }
    await loadDocumentList();
    showToast("最近文档记录已删除；原件和译文文件均已保留。", false, 6000);
  } catch (error) {
    showToast(`删除记录失败：${error.message}`, true);
  }
}

async function selectDocument(id) {
  try {
    const documentData = await api(`/api/documents/${id}`);
    setCurrentDocument(documentData, true);
    await loadDocumentList();
    if (documentData.status === "translating") schedulePoll();
  } catch (error) {
    showToast(error.message, true);
  }
}

function setCurrentDocument(documentData, fullRender = false) {
  const previous = state.current;
  state.current = documentData;
  ensureSourceProgressIndex();
  history.replaceState(null, "", `#/${documentData.id}`);
  elements.emptyState.classList.add("hidden");
  elements.reviewWorkspace.classList.remove("hidden");
  updateDocumentMeta(documentData);
  if (!previous || previous.id !== documentData.id) {
    state.segmentPageMap = null;
    state.segmentPageMapTask = null;
    elements.previewPageStatus.textContent = "正在载入页码…";
    elements.originalPreview.src = `/api/documents/${documentData.id}/preview`;
    elements.openOriginalButton.href = `/api/documents/${documentData.id}/original`;
    setViewMode("file");
  }

  const mustRender = fullRender || !previous || previous.id !== documentData.id || previous.segments.length !== documentData.segments.length;
  if (mustRender) renderRows(documentData.segments);
  else mergeRows(documentData.segments);

  if (documentData.status === "translating") schedulePoll();
  else stopPoll();
}

function updateDocumentMeta(documentData) {
  elements.documentTitle.textContent = documentData.name;
  elements.sourceLanguage.value = documentData.source_language;
  elements.targetLanguage.value = documentData.target_language;
  elements.sourceHeading.textContent = `${languageName(documentData.source_language)} · 原文`;
  elements.targetHeading.textContent = `${languageName(documentData.target_language)} · 译文`;
  elements.segmentCount.textContent = `${documentData.segments.length} 段`;
  const translatedCount = documentData.segments.filter((segment) => (segment.translation || "").trim()).length;
  elements.translationCoverage.textContent = translatedCount === documentData.segments.length
    ? `已完整显示全部 ${translatedCount} 段译文`
    : `已显示 ${translatedCount} / ${documentData.segments.length} 段译文`;
  elements.originalPath.textContent = `原件：${documentData.original_path}`;
  elements.originalPath.title = "原文件已单独保留，不会被译文覆盖";
  elements.statusBadge.textContent = statusName(documentData.status);
  elements.statusBadge.className = `status-badge ${documentData.status}`;
  elements.statusBadge.title = "";
  elements.progressBar.style.width = `${documentData.progress || 0}%`;
  if (documentData.retry && documentData.status === "translating") {
    const retry = documentData.retry;
    elements.progressText.textContent =
      "模型暂时失败，正在自动重试 "
      + retry.retry_number + "/" + retry.max_retries
      + "（退避 " + retry.delay_seconds + " 秒）";
    elements.progressText.title = retry.reason || "";
    elements.statusBadge.textContent = "等待模型重试";
    elements.statusBadge.title = retry.reason || "";
  } else {
    elements.progressText.textContent = `已完成 ${translatedCount}/${documentData.segments.length}，可边翻译边校对`;
    elements.progressText.title = "";
  }
  elements.progressWrap.classList.toggle("hidden", documentData.status !== "translating");
  elements.translateButton.disabled = documentData.status === "translating";
  elements.translateButton.textContent = documentData.status === "translating" ? "正在翻译…" : "翻译空白段落";
  if (documentData.status === "error" && documentData.error) {
    elements.statusBadge.title = documentData.error;
  }
}

function renderRows(segments) {
  elements.segmentRows.replaceChildren();
  const fragment = document.createDocumentFragment();
  segments.forEach((segment, index) => fragment.append(makeRow(segment, index)));
  elements.segmentRows.append(fragment);
  scheduleTranslationLayout();
}

function setViewMode(mode) {
  state.viewMode = mode;
  const aligned = mode === "aligned";
  elements.reviewBody.classList.toggle("file-view", !aligned);
  elements.reviewBody.classList.toggle("aligned-view", aligned);
  elements.fileViewButton.classList.toggle("active", !aligned);
  elements.alignedViewButton.classList.toggle("active", aligned);
  scheduleTranslationLayout();
  if (!aligned && elements.syncScroll.checked) requestAnimationFrame(syncTranslationToPreview);
}

let translationLayoutFrame = 0;

function scheduleTranslationLayout() {
  cancelAnimationFrame(translationLayoutFrame);
  translationLayoutFrame = requestAnimationFrame(() => {
    const rows = [...elements.segmentRows.children];
    elements.segmentRows.style.height = "auto";
    const contentHeight = rows.reduce((total, row) => total + row.offsetHeight, 0);
    elements.segmentRows.style.height = contentHeight ? (contentHeight + 2) + "px" : "auto";
    elements.translationWorkPane.dataset.scrollable = String(
      elements.translationWorkPane.scrollHeight > elements.translationWorkPane.clientHeight + 1
    );
  });
}

function sourceVisualWeight(text) {
  const value = String(text || "");
  const visible = value.replace(/\s/g, "");
  const cjk = (visible.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const latin = (visible.match(/[A-Za-z0-9]/g) || []).length;
  const other = Math.max(0, visible.length - cjk - latin);
  const explicitLines = Math.max(1, value.split(/\r?\n/).length);
  const estimatedLines = (cjk + latin * 0.52 + other * 0.7) / 42;
  return Math.max(explicitLines, estimatedLines, 1);
}

function ensureSourceProgressIndex() {
  if (!state.current) {
    state.sourceProgressIndex = null;
    return null;
  }
  const segments = state.current.segments || [];
  const signature = state.current.id + ":" + segments.length;
  if (state.sourceProgressIndex?.signature === signature) return state.sourceProgressIndex;

  let total = 0;
  const entries = [];
  const byId = new Map();
  segments.forEach((segment, index) => {
    const weight = sourceVisualWeight(segment.source);
    const entry = { id: segment.id, index, start: total, weight, end: total + weight };
    entries.push(entry);
    byId.set(segment.id, entry);
    total += weight;
  });
  state.sourceProgressIndex = { signature, entries, byId, total: Math.max(total, 1) };
  return state.sourceProgressIndex;
}

function normalizedMatchText(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\u3400-\u4dbf\u4e00-\u9fffa-z0-9]/g, "");
}

function previewPageElements() {
  try {
    const previewDocument = elements.originalPreview.contentDocument;
    if (!previewDocument) return [];
    const pdfPages = [...previewDocument.querySelectorAll(".pdf-page")];
    if (pdfPages.length) return pdfPages;
    return [...previewDocument.querySelectorAll("section.docx")];
  } catch (_) {
    return [];
  }
}

function previewDocumentPosition(message = {}) {
  const previewWindow = elements.originalPreview.contentWindow;
  const pages = previewPageElements();
  if (!previewWindow || !pages.length) {
    return Math.max(0, Math.min(1, Number(message.ratio) || 0));
  }
  const maxScroll = Math.max(0, previewWindow.document.documentElement.scrollHeight - previewWindow.innerHeight);
  if (!maxScroll || previewWindow.scrollY <= 1) return 0;
  if (previewWindow.scrollY >= maxScroll - 1) return 1;
  const pageNumber = Math.max(1, Math.min(pages.length, Number(message.page) || 1));
  const page = pages[pageNumber - 1];
  const pageTop = page.getBoundingClientRect().top + previewWindow.scrollY;
  const marker = previewWindow.scrollY + previewWindow.innerHeight * 0.38;
  const fraction = Math.max(0, Math.min(1, (marker - pageTop) / Math.max(1, page.offsetHeight)));
  return (pageNumber - 1 + fraction) / pages.length;
}

function scrollPreviewToDocumentPosition(position) {
  const previewWindow = elements.originalPreview.contentWindow;
  const pages = previewPageElements();
  if (!previewWindow || !pages.length) return false;
  const ratio = Math.max(0, Math.min(1, Number(position) || 0));
  const maxScroll = Math.max(0, previewWindow.document.documentElement.scrollHeight - previewWindow.innerHeight);
  if (ratio <= 0) {
    previewWindow.scrollTo(0, 0);
    return true;
  }
  if (ratio >= 1) {
    previewWindow.scrollTo(0, maxScroll);
    return true;
  }
  const pagePoint = ratio * pages.length;
  const pageIndex = Math.min(pages.length - 1, Math.floor(pagePoint));
  const pageFraction = pagePoint - pageIndex;
  const page = pages[pageIndex];
  const pageTop = page.getBoundingClientRect().top + previewWindow.scrollY;
  const desired = pageTop + page.offsetHeight * pageFraction - previewWindow.innerHeight * 0.38;
  previewWindow.scrollTo(0, Math.max(0, Math.min(maxScroll, desired)));
  return true;
}

function pagePositionFromTextOffset(offset, pageKeys, totalCharacters) {
  let remaining = Math.max(0, Math.min(totalCharacters, offset));
  for (let pageIndex = 0; pageIndex < pageKeys.length; pageIndex += 1) {
    const pageLength = Math.max(1, pageKeys[pageIndex].length);
    if (remaining <= pageLength || pageIndex === pageKeys.length - 1) {
      return (pageIndex + Math.max(0, Math.min(1, remaining / pageLength))) / pageKeys.length;
    }
    remaining -= pageLength;
  }
  return 1;
}

function createSegmentPageMap(documentData, pageTexts) {
  const segments = documentData.segments || [];
  const pageKeys = pageTexts.map(normalizedMatchText);
  if (!segments.length || !pageKeys.length) return null;
  const segmentKeys = segments.map((segment) => normalizedMatchText(segment.source));
  const totalPageCharacters = pageKeys.reduce((total, key) => total + Math.max(1, key.length), 0);
  const totalSegmentCharacters = segmentKeys.reduce((total, key) => total + Math.max(1, key.length), 0);
  const entries = [];
  const byId = new Map();
  let searchPage = 0;
  let searchOffset = 0;
  let consumedSegmentCharacters = 0;
  let previousPosition = 0;
  let matched = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const key = segmentKeys[index];
    let found = null;
    if (key) {
      const lengths = [...new Set([
        key.length <= 300 ? key.length : 200,
        Math.min(key.length, 128),
        Math.min(key.length, 64),
        Math.min(key.length, 32),
        Math.min(key.length, 16),
        Math.min(key.length, 8),
      ].filter((length) => length > 0))].sort((a, b) => b - a);
      for (const length of lengths) {
        const probe = key.slice(0, length);
        for (let pageIndex = searchPage; pageIndex < pageKeys.length; pageIndex += 1) {
          const from = pageIndex === searchPage ? searchOffset : 0;
          const matchIndex = pageKeys[pageIndex].indexOf(probe, from);
          if (matchIndex >= 0) {
            found = { pageIndex, matchIndex, length };
            break;
          }
        }
        if (found) break;
      }
    }

    let rawPosition;
    if (found) {
      const pageLength = Math.max(1, pageKeys[found.pageIndex].length);
      rawPosition = (found.pageIndex + found.matchIndex / pageLength) / pageKeys.length;
      searchPage = found.pageIndex;
      searchOffset = found.matchIndex + found.length;
      if (searchOffset >= pageLength) {
        searchPage = Math.min(pageKeys.length - 1, searchPage + 1);
        searchOffset = 0;
      }
      matched += 1;
    } else {
      const fallbackOffset = consumedSegmentCharacters / Math.max(1, totalSegmentCharacters) * totalPageCharacters;
      rawPosition = pagePositionFromTextOffset(fallbackOffset, pageKeys, totalPageCharacters);
    }

    const position = Math.max(previousPosition, Math.max(0, Math.min(1, rawPosition)));
    const entry = {
      id: segments[index].id,
      index,
      position,
      page: Math.min(pageKeys.length, Math.floor(position * pageKeys.length) + 1),
    };
    entries.push(entry);
    byId.set(entry.id, entry);
    previousPosition = position;
    consumedSegmentCharacters += Math.max(1, key.length);
  }

  return {
    documentId: documentData.id,
    pages: pageKeys.length,
    entries,
    byId,
    matched,
  };
}

async function extractPdfPageTexts(documentId) {
  if (!window.pdfjsLib) return null;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.js";
  const loadingTask = window.pdfjsLib.getDocument({
    url: "/api/documents/" + documentId + "/preview-pdf",
    cMapUrl: "/vendor/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/vendor/standard_fonts/",
    enableXfa: false,
  });
  const pdf = await loadingTask.promise;
  const pageTexts = new Array(pdf.numPages);
  let nextPage = 1;
  async function worker() {
    while (nextPage <= pdf.numPages) {
      const pageNumber = nextPage;
      nextPage += 1;
      try {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pageTexts[pageNumber - 1] = content.items.map((item) => item.str || "").join(" ");
        page.cleanup();
      } catch (_) {
        pageTexts[pageNumber - 1] = "";
      }
    }
  }
  try {
    const workerCount = Math.max(1, Math.min(3, pdf.numPages));
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return pageTexts;
  } finally {
    await pdf.destroy();
  }
}

async function ensureSegmentPageMap() {
  const documentData = state.current;
  if (!documentData) return null;
  if (state.segmentPageMap?.documentId === documentData.id) return state.segmentPageMap;
  if (state.segmentPageMapTask?.documentId === documentData.id) return state.segmentPageMapTask.promise;

  const task = { documentId: documentData.id, promise: null };
  state.segmentPageMapTask = task;
  task.promise = (async () => {
    try {
      elements.previewPageStatus.title = "正在读取原件每页文字并建立段落定位…";
      const suffix = documentData.name.toLowerCase().split(".").pop();
      let pageTexts = null;
      if (suffix === "docx") {
        const pages = previewPageElements();
        pageTexts = pages.map((page) => page.textContent || "");
      } else if (suffix === "pdf" || suffix === "doc") {
        pageTexts = await extractPdfPageTexts(documentData.id);
      }
      if (!pageTexts?.length || state.current?.id !== documentData.id) return null;
      const mapping = createSegmentPageMap(documentData, pageTexts);
      if (mapping && state.current?.id === documentData.id) {
        state.segmentPageMap = mapping;
        elements.previewPageStatus.title =
          "已按原文段落定位：" + mapping.matched + " / " + mapping.entries.length + " 段直接匹配";
        if (state.viewMode === "file" && elements.syncScroll.checked) {
          requestAnimationFrame(syncTranslationToPreview);
        }
      }
      return mapping;
    } catch (error) {
      if (state.current?.id === documentData.id) {
        elements.previewPageStatus.title = "段落页码定位失败，将使用近似位置：" + error.message;
      }
      return null;
    } finally {
      if (state.segmentPageMapTask === task) state.segmentPageMapTask = null;
    }
  })();
  return task.promise;
}

function nextMappedPosition(mapping, index) {
  const start = mapping.entries[index]?.position ?? 0;
  for (let next = index + 1; next < mapping.entries.length; next += 1) {
    if (mapping.entries[next].position > start + 0.000001) return mapping.entries[next].position;
  }
  return 1;
}

function sourceProgressFromTranslationScroll() {
  const pane = elements.translationWorkPane;
  const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
  if (!maxScroll || pane.scrollTop <= 1) return 0;
  if (pane.scrollTop >= maxScroll - 1) return 1;

  const index = ensureSourceProgressIndex();
  if (!index?.entries.length) return pane.scrollTop / maxScroll;
  const paneRect = pane.getBoundingClientRect();
  const markerY = paneRect.top + pane.clientHeight * 0.38;
  let row = null;
  const hit = document.elementFromPoint(
    paneRect.left + Math.min(Math.max(24, paneRect.width * 0.5), Math.max(24, paneRect.width - 24)),
    markerY
  );
  if (hit?.closest) row = hit.closest(".segment-row");
  if (!row || !elements.segmentRows.contains(row)) {
    for (const candidate of elements.segmentRows.children) {
      const rect = candidate.getBoundingClientRect();
      if (rect.bottom >= markerY) {
        row = candidate;
        break;
      }
    }
  }
  row ||= elements.segmentRows.lastElementChild;
  if (!row) return pane.scrollTop / maxScroll;

  const entry = index.byId.get(row.dataset.segmentId);
  if (!entry) return pane.scrollTop / maxScroll;
  const rect = row.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (markerY - rect.top) / Math.max(1, rect.height)));
  const mapping = state.segmentPageMap?.documentId === state.current?.id ? state.segmentPageMap : null;
  const mappedEntry = mapping?.byId.get(row.dataset.segmentId);
  if (mapping && mappedEntry) {
    const mappedEnd = nextMappedPosition(mapping, mappedEntry.index);
    return Math.max(0, Math.min(1, mappedEntry.position + (mappedEnd - mappedEntry.position) * fraction));
  }
  return Math.max(0, Math.min(1, (entry.start + entry.weight * fraction) / index.total));
}

function scrollTranslationToSourceProgress(progress) {
  const pane = elements.translationWorkPane;
  const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
  const ratio = Math.max(0, Math.min(1, Number(progress) || 0));
  if (!maxScroll || ratio <= 0) {
    pane.scrollTop = 0;
    return;
  }
  if (ratio >= 1) {
    pane.scrollTop = maxScroll;
    return;
  }

  const mapping = state.segmentPageMap?.documentId === state.current?.id ? state.segmentPageMap : null;
  if (mapping?.entries.length) {
    let low = 0;
    let high = mapping.entries.length - 1;
    let found = 0;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (mapping.entries[middle].position <= ratio) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const entry = mapping.entries[found];
    const end = nextMappedPosition(mapping, found);
    const fraction = Math.max(0, Math.min(1, (ratio - entry.position) / Math.max(0.000001, end - entry.position)));
    const row = elements.segmentRows.children[entry.index];
    if (row) {
      const paneRect = pane.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      const rowTop = rowRect.top - paneRect.top + pane.scrollTop;
      const desired = rowTop + row.offsetHeight * fraction - pane.clientHeight * 0.38;
      pane.scrollTop = Math.max(0, Math.min(maxScroll, desired));
      return;
    }
  }

  const index = ensureSourceProgressIndex();
  if (!index?.entries.length) {
    pane.scrollTop = ratio * maxScroll;
    return;
  }
  const target = ratio * index.total;
  let low = 0;
  let high = index.entries.length - 1;
  let found = high;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (index.entries[middle].end >= target) {
      found = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  const entry = index.entries[found];
  const row = elements.segmentRows.children[entry.index];
  if (!row) {
    pane.scrollTop = ratio * maxScroll;
    return;
  }
  const fraction = Math.max(0, Math.min(1, (target - entry.start) / Math.max(entry.weight, 0.001)));
  const paneRect = pane.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  const rowTop = rowRect.top - paneRect.top + pane.scrollTop;
  const desired = rowTop + row.offsetHeight * fraction - pane.clientHeight * 0.38;
  pane.scrollTop = Math.max(0, Math.min(maxScroll, desired));
}

let translationScrollFrame = 0;
let applyingPreviewScroll = false;
let previewScrollReleaseTimer = 0;
let translationScrollAuthorityUntil = 0;

function syncTranslationToPreview() {
  if (state.viewMode !== "file" || !elements.syncScroll.checked || applyingPreviewScroll) return;
  translationScrollAuthorityUntil = performance.now() + 600;
  cancelAnimationFrame(translationScrollFrame);
  translationScrollFrame = requestAnimationFrame(() => {
    const sourceProgress = sourceProgressFromTranslationScroll();
    if (!scrollPreviewToDocumentPosition(sourceProgress)) {
      elements.originalPreview.contentWindow?.postMessage({
        type: "chanslator-sync-scroll",
        ratio: sourceProgress,
        source_progress: sourceProgress,
      }, "*");
    }
  });
}

function handlePreviewMessage(event) {
  if (event.source !== elements.originalPreview.contentWindow || !event.data) return;
  const message = event.data;
  if (message.type === "chanslator-preview-error") {
    elements.previewPageStatus.textContent = message.message || "原件无法分页预览";
    return;
  }
  if (message.type !== "chanslator-preview-scroll" && message.type !== "chanslator-preview-ready") return;
  const pages = Number(message.pages) || 0;
  if (pages > 0) {
    const page = Math.max(1, Math.min(pages, Number(message.page) || 1));
    const mapped = state.segmentPageMap?.documentId === state.current?.id;
    elements.previewPageStatus.textContent =
      (mapped ? "段落对应第 " : "原件约第 ") + page + " / " + pages + " 页";
  }
  if (message.type === "chanslator-preview-ready") ensureSegmentPageMap();
  if (
    message.type === "chanslator-preview-scroll"
    && state.viewMode === "file"
    && elements.syncScroll.checked
    && performance.now() >= translationScrollAuthorityUntil
  ) {
    const pane = elements.translationWorkPane;
    applyingPreviewScroll = true;
    clearTimeout(previewScrollReleaseTimer);
    const mappedPosition = state.segmentPageMap?.documentId === state.current?.id
      ? previewDocumentPosition(message)
      : message.ratio;
    scrollTranslationToSourceProgress(mappedPosition);
    previewScrollReleaseTimer = setTimeout(() => { applyingPreviewScroll = false; }, 140);
  }
}

async function downloadTranslation() {
  if (!state.current) return;
  const button = elements.downloadTranslationButton;
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "正在生成…";
  try {
    const result = await api(`/api/documents/${state.current.id}/prepare-download`, { method: "POST" });
    const lines = ["译文 DOCX 已生成。", `项目文件：${result.output_path}`];
    lines.push("即将打开另存为窗口。");
    showToast(lines.join("\n"), false, 9000);

    const link = document.createElement("a");
    link.href = result.download_url;
    link.download = "";
    document.body.append(link);
    link.click();
    link.remove();
  } catch (error) {
    showToast(`生成译文失败：${error.message}`, true, 9000);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

function saveBeforeClose() {
  if (!state.current) return;
  const payload = new Blob([JSON.stringify({ translations: visibleTranslations() })], { type: "application/json" });
  navigator.sendBeacon(`/api/documents/${state.current.id}/autosave`, payload);
}

function visibleTranslations() {
  const translations = {};
  for (const row of elements.segmentRows.querySelectorAll(".segment-row")) {
    translations[row.dataset.segmentId] = row.querySelector("textarea")?.value || "";
  }
  return translations;
}

function makeRow(segment, index) {
  const row = document.createElement("article");
  row.className = "segment-row";
  row.classList.toggle("has-translation", Boolean((segment.translation || "").trim()));
  row.classList.add(`status-${segment.status || "empty"}`);
  row.dataset.segmentId = segment.id;

  const number = document.createElement("div");
  number.className = "segment-number";
  number.textContent = String(index + 1).padStart(2, "0");

  const source = document.createElement("div");
  source.className = "source-cell";
  source.textContent = segment.source;

  const target = document.createElement("div");
  target.className = "target-cell";
  const sourceReference = document.createElement("div");
  sourceReference.className = "source-reference";
  const sourceReferenceLabel = document.createElement("strong");
  sourceReferenceLabel.textContent = "对应原文";
  const sourceReferenceText = document.createElement("div");
  sourceReferenceText.textContent = segment.source;
  sourceReference.append(sourceReferenceLabel, sourceReferenceText);
  const textarea = document.createElement("textarea");
  textarea.value = segment.translation || "";
  textarea.placeholder = segmentPlaceholder(segment.status);
  textarea.setAttribute("aria-label", `第 ${index + 1} 段译文`);
  const segmentState = document.createElement("span");
  segmentState.className = "segment-state";
  segmentState.textContent = segmentStatusName(segment.status);
  target.append(sourceReference, textarea, segmentState);
  textarea.addEventListener("focus", () => row.classList.add("focused"));
  textarea.addEventListener("blur", () => row.classList.remove("focused"));
  textarea.addEventListener("input", () => {
    autoGrow(textarea);
    scheduleTranslationLayout();
    segmentState.textContent = "未保存";
    queueSegmentSave(segment.id, { translation: textarea.value });
  });

  const actions = document.createElement("div");
  actions.className = "segment-actions";
  const sourceToggle = actionButton("原", "显示或隐藏本段对应原文");
  sourceToggle.dataset.action = "source";
  sourceToggle.addEventListener("click", () => {
    row.classList.toggle("show-source");
    sourceToggle.classList.toggle("active", row.classList.contains("show-source"));
    scheduleTranslationLayout();
  });
  const translate = actionButton("↻", "重新翻译本段");
  translate.dataset.action = "translate";
  translate.addEventListener("click", () => translateSegment(segment.id, translate));
  const lock = actionButton(segment.locked ? "●" : "○", segment.locked ? "解锁本段" : "锁定本段");
  lock.dataset.action = "lock";
  lock.classList.toggle("locked", segment.locked);
  lock.addEventListener("click", () => toggleLock(segment.id, !lock.classList.contains("locked")));
  const review = actionButton("✓", "标记为已审校");
  review.dataset.action = "review";
  review.classList.toggle("reviewed", segment.status === "reviewed");
  review.addEventListener("click", () => toggleReviewed(segment.id, !review.classList.contains("reviewed")));
  actions.append(sourceToggle, translate, lock, review);

  row.append(number, source, target, actions);
  requestAnimationFrame(() => autoGrow(textarea));
  return row;
}

function actionButton(text, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "row-action";
  button.textContent = text;
  button.title = title;
  return button;
}

function mergeRows(segments) {
  for (const segment of segments) {
    const row = elements.segmentRows.querySelector(`[data-segment-id="${segment.id}"]`);
    if (!row) continue;
    const textarea = row.querySelector("textarea");
    if (document.activeElement !== textarea && !state.saveTimers.has(segment.id) && textarea.value !== (segment.translation || "")) {
      textarea.value = segment.translation || "";
      autoGrow(textarea);
    }
    row.querySelector(".segment-state").textContent = segmentStatusName(segment.status);
    row.classList.toggle("has-translation", Boolean((segment.translation || "").trim()));
    for (const name of ["empty", "queued", "translating", "machine", "edited", "reviewed"]) {
      row.classList.toggle(`status-${name}`, segment.status === name);
    }
    textarea.placeholder = segmentPlaceholder(segment.status);
    const lock = row.querySelector('[data-action="lock"]');
    lock.classList.toggle("locked", segment.locked);
    lock.textContent = segment.locked ? "●" : "○";
    lock.title = segment.locked ? "解锁本段" : "锁定本段";
    row.querySelector('[data-action="review"]').classList.toggle("reviewed", segment.status === "reviewed");
  }
  scheduleTranslationLayout();
}

function queueSegmentSave(segmentId, body) {
  clearTimeout(state.saveTimers.get(segmentId));
  elements.saveState.textContent = "有未保存更改";
  const timer = setTimeout(async () => {
    elements.saveState.textContent = "保存中…";
    try {
      const updated = await api(`/api/documents/${state.current.id}/segments/${segmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const local = state.current.segments.find((item) => item.id === segmentId);
      if (local) Object.assign(local, updated);
      const row = elements.segmentRows.querySelector(`[data-segment-id="${segmentId}"]`);
      if (row) row.querySelector(".segment-state").textContent = segmentStatusName(updated.status);
      elements.saveState.textContent = "已保存";
    } catch (error) {
      elements.saveState.textContent = "保存失败";
      showToast(error.message, true);
    } finally {
      state.saveTimers.delete(segmentId);
    }
  }, 650);
  state.saveTimers.set(segmentId, timer);
}

async function toggleLock(segmentId, locked) {
  try {
    const updated = await patchSegment(segmentId, { locked });
    updateLocalSegment(updated);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function toggleReviewed(segmentId, reviewed) {
  try {
    const updated = await patchSegment(segmentId, { reviewed });
    updateLocalSegment(updated);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function patchSegment(segmentId, body) {
  return api(`/api/documents/${state.current.id}/segments/${segmentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function updateLocalSegment(segment) {
  const local = state.current.segments.find((item) => item.id === segment.id);
  if (local) Object.assign(local, segment);
  mergeRows(state.current.segments);
}

async function translateSegment(segmentId, button) {
  button.disabled = true;
  button.classList.add("busy");
  try {
    const updated = await api(`/api/documents/${state.current.id}/segments/${segmentId}/translate`, { method: "POST" });
    updateLocalSegment(updated);
    showToast("本段已重新翻译。", false);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
  }
}

async function startTranslation(overwrite) {
  if (!state.current) return;
  if (!state.settings?.configured) {
    showToast("请先配置翻译模型。", true);
    await openSettings();
    return;
  }
  const source = elements.sourceLanguage.value;
  const target = elements.targetLanguage.value;
  if (source === target) {
    showToast("源语言和目标语言不能相同。", true);
    return;
  }
  elements.translateButton.disabled = true;
  try {
    await api(`/api/documents/${state.current.id}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_language: source, target_language: target, overwrite }),
    });
    state.current.status = "translating";
    state.current.source_language = source;
    state.current.target_language = target;
    updateDocumentMeta(state.current);
    schedulePoll();
  } catch (error) {
    elements.translateButton.disabled = false;
    showToast(error.message, true);
  }
}

function schedulePoll() {
  if (state.pollTimer) return;
  state.pollTimer = setInterval(pollCurrent, 450);
  pollCurrent();
}

function stopPoll() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function pollCurrent() {
  if (!state.current) return;
  const id = state.current.id;
  const oldStatus = state.current.status;
  const oldTranslatedCount = state.current.segments.filter((segment) => (segment.translation || "").trim()).length;
  try {
    const documentData = await api(`/api/documents/${id}`);
    if (state.current?.id !== id) return;
    setCurrentDocument(documentData, false);
    const newTranslatedCount = documentData.segments.filter((segment) => (segment.translation || "").trim()).length;
    if (oldTranslatedCount === 0 && newTranslatedCount > 0 && documentData.status === "translating") {
      showToast("首段译文已返回，可以立即开始校对；后续译文会继续逐批显示。", false, 6000);
    }
    if (oldStatus === "translating" && documentData.status === "completed") {
      showToast("全文翻译完成，正式译文 DOCX 已自动保存。", false);
      await loadDocumentList();
    } else if (oldStatus === "translating" && documentData.status === "error") {
      showToast(documentData.error || "翻译失败。", true);
      await loadDocumentList();
    }
  } catch (error) {
    stopPoll();
    showToast(error.message, true);
  }
}

function keepDirectionDistinct(event) {
  if (elements.sourceLanguage.value === elements.targetLanguage.value) {
    if (event.target === elements.sourceLanguage) {
      elements.targetLanguage.value = event.target.value === "zh" ? "en" : "zh";
    } else {
      elements.sourceLanguage.value = event.target.value === "zh" ? "en" : "zh";
    }
  }
  elements.sourceHeading.textContent = `${languageName(elements.sourceLanguage.value)} · 原文`;
  elements.targetHeading.textContent = `${languageName(elements.targetLanguage.value)} · 译文`;
}

function autoGrow(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(89, textarea.scrollHeight)}px`;
}

function languageName(code) {
  return code === "zh" ? "中文" : "English";
}

function statusName(status) {
  return ({ ready: "待翻译", translating: "翻译中", completed: "已完成", error: "出错" })[status] || status;
}

function segmentStatusName(status) {
  return ({ empty: "", queued: "等待翻译", translating: "正在翻译…", machine: "机器译文", edited: "已编辑", reviewed: "已审校" })[status] || "";
}

function segmentPlaceholder(status) {
  if (status === "queued") return "已加入翻译队列…";
  if (status === "translating") return "模型正在翻译本段…";
  return "等待翻译，或在此输入译文…";
}

function showToast(message, isError, duration) {
  clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", Boolean(isError));
  elements.toast.classList.remove("hidden");
  state.toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), duration || (isError ? 7000 : 3500));
}
