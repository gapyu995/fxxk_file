const state = {
  current: null,
  settings: null,
  pollTimer: null,
  saveTimers: new Map(),
  saveInFlight: new Map(),
  dirtyTranslations: new Map(),
  toastTimer: null,
  dragDepth: 0,
  viewMode: "file",
  sourceProgressIndex: null,
  segmentPageMap: null,
  segmentPageMapTask: null,
  selectionVersion: 0,
  previewZoom: 1,
  translationFontSize: 16,
  sourcePanePercent: 50,
  pendingTranslateAfterSettings: false,
  markdownFontScale: 1,
  markdownTocWidth: 196,
  markdownTocVisible: true,
  markdownTableFit: true,
  markdownObjectUrl: null,
  markdownSource: "",
  markdownFileName: "untitled.md",
  markdownFileSize: 0,
  markdownEditMode: false,
  markdownEditTimer: 0,
  markdownTocItems: [],
  markdownScrollSyncing: false,
  searchQuery: "",
  searchMatches: [],
  searchIndex: -1,
  segmentFilter: "all",
  sidebarCollapsed: false,
  theme: "light",
  imageTool: "png-to-svg",
};

/* Two navigation levels.
 *
 * A workspace is what the sidebar switches; a page is what the topbar
 * switches inside it. Every page names the workspace element it reveals, so
 * the switcher never hardcodes a list of ids in two places.
 */
const WORKSPACES = [
  { key: "translate", label: "文档翻译", icon: "译",
    pages: [
      { key: "file", label: "原件版面对照", run: () => setViewMode("file") },
      { key: "aligned", label: "逐段精确对照", run: () => setViewMode("aligned") },
      { key: "convert-script", label: "繁简转换", run: () => convertChineseScript() },
      { key: "download", label: "下载译文", run: () => downloadTranslation() },
    ] },
  { key: "compare", label: "双文件对比", icon: "⇄",
    pages: [
      { key: "compare-open", label: "选择文件", run: () => elements.compareDialog.showModal() },
      { key: "compare-diff", label: "文本差异", run: () => toggleCompareDiff() },
    ] },
  { key: "convert", label: "文件转换", icon: "⇢", pages: [] },
  { key: "images", label: "图片转换", icon: "▣",
    pages: [
      { key: "png-to-svg", label: "PNG → SVG", run: () => switchImageTool("png-to-svg") },
      { key: "svg-to-png", label: "SVG → PNG", run: () => switchImageTool("svg-to-png") },
    ] },
  { key: "markdown", label: "Markdown 查看", icon: "M↓",
    pages: [
      { key: "markdown-open", label: "打开文件", run: () => elements.markdownFileInput.click() },
      { key: "markdown-edit", label: "编辑", run: () => markdownFeature.toggleEdit() },
      { key: "markdown-fullscreen", label: "全屏", run: () => markdownFeature.toggleFullscreen() },
    ] },
];

const FILTER_DEFINITIONS = [
  { value: "all", label: "全部" },
  { value: "untranslated", label: "待翻译" },
  { value: "machine", label: "机器译文" },
  { value: "edited", label: "已编辑" },
  { value: "reviewed", label: "已审校" },
  { value: "locked", label: "已锁定" },
];

const DISPLAY_PREFERENCES_KEY = "fxxk_file-display-preferences-v1";

const $ = (selector) => document.querySelector(selector);
const elements = {
  fileInput: $("#fileInput"),
  dropzone: $("#dropzone"),
  autoTranslate: $("#autoTranslate"),
  autoOcr: $("#autoOcr"), autoOcrLabel: $("#autoOcrLabel"),
  zhScriptMode: $("#zhScriptMode"), zhScriptLabel: $("#zhScriptLabel"),
  compareDiff: $("#compareDiff"), compareDiffLabel: $("#compareDiffLabel"),
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
  stopButton: $("#stopButton"),
  retranslateButton: $("#retranslateButton"),
  zhScriptButton: $("#zhScriptButton"),
  segmentRows: $("#segmentRows"),
  progressWrap: $("#progressWrap"),
  progressBar: $("#progressBar"),
  progressText: $("#progressText"),
  saveState: $("#saveState"),
  shortcutButton: $("#shortcutButton"), shortcutDialog: $("#shortcutDialog"), closeShortcuts: $("#closeShortcuts"),
  segmentFilter: $("#segmentFilter"), segmentFilterCount: $("#segmentFilterCount"),
  segmentRowsEmpty: $("#segmentRowsEmpty"), segmentRowsEmptyText: $("#segmentRowsEmptyText"), segmentRowsEmptyReset: $("#segmentRowsEmptyReset"),
  bulkLock: $("#bulkLock"), bulkUnlock: $("#bulkUnlock"), bulkReview: $("#bulkReview"), bulkUnreview: $("#bulkUnreview"), bulkClear: $("#bulkClear"),
  bulkMenu: $("#bulkMenu"), bulkOptions: $("#bulkOptions"), reviewBulk: $("#reviewBulk"),
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
  previewZoomOut: $("#previewZoomOut"),
  previewZoomReset: $("#previewZoomReset"),
  previewZoomIn: $("#previewZoomIn"),
  previewZoomValue: $("#previewZoomValue"),
  translationFontDown: $("#translationFontDown"),
  translationFontReset: $("#translationFontReset"),
  translationFontUp: $("#translationFontUp"),
  translationFontValue: $("#translationFontValue"),
  workspaceSplitter: $("#workspaceSplitter"),
  fileViewButton: $("#fileViewButton"),
  alignedViewButton: $("#alignedViewButton"),
  openOriginalButton: $("#openOriginalButton"),
  downloadTranslationButton: $("#downloadTranslationButton"),
  uploadOverlay: $("#uploadOverlay"),
  toast: $("#toast"),
  functionSelect: $("#functionSelect"),
  functionNav: $("#functionNav"), pageTabs: $("#pageTabs"),
  sidebarToggle: $("#sidebarToggle"), themeToggle: $("#themeToggle"),
  themeToggleSidebar: $("#themeToggleSidebar"), settingsButtonSidebar: $("#settingsButtonSidebar"),
  compareFilesInput: $("#compareFilesInput"),
  documentSearch: $("#documentSearch"), documentSearchInput: $("#documentSearchInput"), documentSearchCount: $("#documentSearchCount"), documentSearchPrev: $("#documentSearchPrev"), documentSearchNext: $("#documentSearchNext"),
  compareDialog: $("#compareDialog"), closeCompare: $("#closeCompare"), cancelCompare: $("#cancelCompare"), startCompare: $("#startCompare"), compareWorkspace: $("#compareWorkspace"), compareLeft: $("#compareLeft"), compareRight: $("#compareRight"), compareLeftTitle: $("#compareLeftTitle"), compareRightTitle: $("#compareRightTitle"), compareStatus: $("#compareStatus"), compareSync: $("#compareSync"), compareZoomOut: $("#compareZoomOut"), compareZoomIn: $("#compareZoomIn"), compareZoomReset: $("#compareZoomReset"), compareZoomValue: $("#compareZoomValue"), closeCompareWorkspace: $("#closeCompareWorkspace"),
  compareUploadProgress: $("#compareUploadProgress"), compareUploadStatus: $("#compareUploadStatus"), compareUploadPercent: $("#compareUploadPercent"), compareUploadBar: $("#compareUploadBar"),
  compareDiffPanel: $("#compareDiffPanel"), compareDiffBody: $("#compareDiffBody"), compareDiffSummary: $("#compareDiffSummary"), compareDiffClose: $("#compareDiffClose"),
  imagesWorkspace: $("#imagesWorkspace"), imagesFrame: $("#imagesFrame"), openImagesTool: $("#openImagesTool"), closeImagesWorkspace: $("#closeImagesWorkspace"), imageConvertPngSvg: $("#imageConvertPngSvg"), imageConvertSvgPng: $("#imageConvertSvgPng"),
  convertWorkspace: $("#convertWorkspace"), convertGroups: $("#convertGroups"), convertPanels: $("#convertPanels"), closeConvertWorkspace: $("#closeConvertWorkspace"),
  convertRun: $("#convertRun"), convertStatus: $("#convertStatus"), convertResult: $("#convertResult"), convertResultText: $("#convertResultText"), convertTitle: $("#convertTitle"), convertStats: $("#convertStats"), convertFiles: $("#convertFiles"), convertCopy: $("#convertCopy"), convertSave: $("#convertSave"), convertClear: $("#convertClear"),
  convertTextMode: $("#convertTextMode"), convertTextFile: $("#convertTextFile"), convertTextInput: $("#convertTextInput"),
  convertTableSource: $("#convertTableSource"), convertTableTarget: $("#convertTableTarget"), convertTableInput: $("#convertTableInput"),
  convertSubtitleMode: $("#convertSubtitleMode"), convertSubtitleTarget: $("#convertSubtitleTarget"), convertSubtitleTargetField: $("#convertSubtitleTargetField"), convertSubtitleSingle: $("#convertSubtitleSingle"), convertSubtitlePair: $("#convertSubtitlePair"),
  convertDocumentMode: $("#convertDocumentMode"), convertDocumentFile: $("#convertDocumentFile"), convertDocumentFileField: $("#convertDocumentFileField"), convertDocumentInput: $("#convertDocumentInput"),
  convertPdfMode: $("#convertPdfMode"), convertPdfFiles: $("#convertPdfFiles"), convertPdfPages: $("#convertPdfPages"), convertPdfPagesField: $("#convertPdfPagesField"), convertPdfDegrees: $("#convertPdfDegrees"), convertPdfDegreesField: $("#convertPdfDegreesField"), convertPdfText: $("#convertPdfText"), convertPdfTextField: $("#convertPdfTextField"),
  convertLanguageMode: $("#convertLanguageMode"), convertLanguageStyle: $("#convertLanguageStyle"), convertLanguageInput: $("#convertLanguageInput"),
  markdownWorkspace: $("#markdownWorkspace"), markdownFileInput: $("#markdownFileInput"), markdownFileMeta: $("#markdownFileMeta"), markdownContent: $("#markdownContent"), markdownEmpty: $("#markdownEmpty"), markdownEditor: $("#markdownEditor"), markdownRendered: $("#markdownRendered"), markdownTocList: $("#markdownTocList"), markdownToc: $("#markdownToc"), markdownTocCurrent: $("#markdownTocCurrent"), markdownTocProgress: $("#markdownTocProgress"), markdownTocToggle: $("#markdownTocToggle"), markdownTocSplitter: $("#markdownTocSplitter"), markdownBodyWrap: $(".markdown-body-wrap"), markdownStatus: $("#markdownStatus"), markdownFullscreen: $("#markdownFullscreen"), markdownEditToggle: $("#markdownEditToggle"), markdownDownload: $("#markdownDownload"), markdownFontDown: $("#markdownFontDown"), markdownFontReset: $("#markdownFontReset"), markdownFontUp: $("#markdownFontUp"), markdownFontValue: $("#markdownFontValue"), markdownTableFit: $("#markdownTableFit"),
};

const markdownFeature = window.MarkdownFeature.create({
  state,
  elements,
  showToast,
  applyFunctionTheme,
  onContentChange: () => refreshDocumentSearch(),
});
const compareFeature = window.CompareFeature.create({
  state,
  elements,
  api,
  showToast,
  applyFunctionTheme,
  diffOptions: () => ({ enabled: Boolean(elements.compareDiff?.checked) }),
});
const imagesFeature = window.ImagesFeature.create({ elements });
const convertFeature = window.ConvertFeature.create({ elements, api, showToast });

document.addEventListener("DOMContentLoaded", init);

async function init() {
  restoreDisplayPreferences();
  applyFunctionTheme("translate");
  bindEvents();
  try {
    const [settings] = await Promise.all([loadSettings(), loadDocumentList()]);
    state.settings = settings;
    const fromHash = location.hash.replace(/^#\/?/, "");
    if (fromHash === "markdown") {
      elements.functionSelect.value = "markdown";
      applyFunctionTheme("markdown");
      elements.reviewWorkspace.classList.add("hidden");
      elements.compareWorkspace.classList.add("hidden");
      elements.imagesWorkspace.classList.add("hidden");
      elements.markdownWorkspace.classList.remove("hidden");
    } else if (/^[a-f0-9]{12}$/.test(fromHash)) await selectDocument(fromHash);
  } catch (error) {
    showToast(error.message, true);
  }
  renderFunctionNav();
  renderPageTabs();
}

function bindEvents() {
  elements.fileInput.addEventListener("change", (event) => {
    uploadFiles([...event.target.files]);
    event.target.value = "";
  });
  elements.shortcutButton.addEventListener("click", () => {
    renderShortcutList();
    elements.shortcutDialog.showModal();
  });
  elements.closeShortcuts.addEventListener("click", () => elements.shortcutDialog.close());
  renderShortcutList();
  elements.markdownFileInput.addEventListener("change", (event) => {
    markdownFeature.openFiles([...event.target.files]);
    event.target.value = "";
  });
  elements.emptyUpload.addEventListener("click", () => elements.fileInput.click());
  $("#refreshList").addEventListener("click", loadDocumentList);
  $("#settingsButton").addEventListener("click", openSettings);
  $("#closeSettings").addEventListener("click", () => elements.settingsDialog.close());
  $("#cancelSettings").addEventListener("click", () => elements.settingsDialog.close());
  elements.settingsForm.addEventListener("submit", saveSettings);
  elements.functionSelect.addEventListener("change", () => {
    const value = elements.functionSelect.value;
    elements.compareWorkspace.classList.add("hidden");
    elements.imagesWorkspace.classList.add("hidden");
    elements.convertWorkspace.classList.add("hidden");
    elements.markdownWorkspace.classList.add("hidden");
    if (value === "compare") {
      elements.reviewWorkspace.classList.add("hidden");
      elements.compareWorkspace.classList.remove("hidden");
      if (!state.compareDiffDocuments?.length) elements.compareDialog.showModal();
    } else if (value === "images") {
      elements.reviewWorkspace.classList.add("hidden");
      elements.imagesWorkspace.classList.remove("hidden");
    } else if (value === "convert") {
      elements.reviewWorkspace.classList.add("hidden");
      elements.convertWorkspace.classList.remove("hidden");
    } else if (value === "markdown") {
      elements.reviewWorkspace.classList.add("hidden");
      elements.markdownWorkspace.classList.remove("hidden");
      markdownFeature.updateLayout();
    } else {
      elements.reviewWorkspace.classList.remove("hidden");
    }
    applyFunctionTheme(value);
    refreshDocumentSearch();
  });
  elements.closeCompare.addEventListener("click", () => elements.compareDialog.close());
  elements.cancelCompare.addEventListener("click", () => elements.compareDialog.close());
  elements.startCompare.addEventListener("click", (e) => { e.preventDefault(); compareFeature.start(); });
  elements.closeCompareWorkspace.addEventListener("click", () => selectWorkspace("translate"));
  elements.compareDiffClose.addEventListener("click", () => elements.compareDiffPanel.classList.add("hidden"));
  elements.closeImagesWorkspace.addEventListener("click", () => selectWorkspace("translate"));
  elements.closeConvertWorkspace.addEventListener("click", () => selectWorkspace("translate"));
  elements.sidebarToggle.addEventListener("click", () => setSidebarCollapsed(!state.sidebarCollapsed));
  elements.themeToggle.addEventListener("click", toggleTheme);
  elements.themeToggleSidebar.addEventListener("click", toggleTheme);
  elements.settingsButtonSidebar.addEventListener("click", openSettings);
  convertFeature.init();
  elements.markdownFullscreen.addEventListener("click", markdownFeature.toggleFullscreen);
  elements.markdownEditToggle.addEventListener("click", markdownFeature.toggleEdit);
  elements.markdownDownload.addEventListener("click", markdownFeature.downloadSource);
  elements.markdownEditor.addEventListener("input", markdownFeature.handleEditorInput);
  elements.markdownEditor.addEventListener("scroll", markdownFeature.syncEditorScroll, { passive: true });
  elements.markdownRendered.addEventListener("scroll", () => {
    markdownFeature.updateStickyHeading();
    markdownFeature.syncPreviewScroll();
  }, { passive: true });
  elements.markdownFontDown.addEventListener("click", () => markdownFeature.setFontScale(state.markdownFontScale - 0.1));
  elements.markdownFontUp.addEventListener("click", () => markdownFeature.setFontScale(state.markdownFontScale + 0.1));
  elements.markdownFontReset.addEventListener("click", () => markdownFeature.setFontScale(1));
  elements.markdownTableFit.addEventListener("click", markdownFeature.toggleTableFit);
  elements.markdownContent.addEventListener("scroll", markdownFeature.updateStickyHeading, { passive: true });
  elements.imageConvertPngSvg.addEventListener("click", () => imagesFeature.switchTool("png-to-svg"));
  elements.imageConvertSvgPng.addEventListener("click", () => imagesFeature.switchTool("svg-to-png"));
  elements.openImagesTool.addEventListener("click", () => window.open(elements.imagesFrame.src, "_blank"));
  for (const b of [elements.compareZoomOut,elements.compareZoomIn,elements.compareZoomReset]) b.addEventListener("click",()=>compareFeature.setZoom(b===elements.compareZoomOut?state.compareZoom-.1:b===elements.compareZoomIn?state.compareZoom+.1:1));
  elements.translateButton.addEventListener("click", () => startTranslation(false));
  elements.stopButton.addEventListener("click", stopTranslation);
  elements.retranslateButton.addEventListener("click", confirmRetranslateAll);
  elements.zhScriptButton.addEventListener("click", convertChineseScript);
  elements.bulkMenu.addEventListener("click", () => {
    const open = elements.bulkOptions.classList.toggle("hidden");
    elements.bulkMenu.setAttribute("aria-expanded", String(!open));
  });
  document.addEventListener("click", (event) => {
    if (elements.reviewBulk?.contains(event.target)) return;
    elements.bulkOptions?.classList.add("hidden");
    elements.bulkMenu?.setAttribute("aria-expanded", "false");
  });
  for (const [id, action] of [["bulkLock", "lock"], ["bulkUnlock", "unlock"], ["bulkReview", "review"], ["bulkUnreview", "unreview"], ["bulkClear", "clear"]]) {
    elements[id].addEventListener("click", () => {
      elements.bulkOptions.classList.add("hidden");
      elements.bulkMenu.setAttribute("aria-expanded", "false");
      runBulkAction(action);
    });
  }
  elements.segmentRowsEmptyReset.addEventListener("click", () => setSegmentFilter("all"));
  elements.zhScriptMode.addEventListener("change", () => {
    if (state.current) {
      state.current.zh_script_mode = elements.zhScriptMode.value;
      updateDocumentMeta(state.current);
    }
  });
  elements.compareDiff.addEventListener("change", () => compareFeature.refreshDiff());
  elements.sourceLanguage.addEventListener("change", keepDirectionDistinct);
  elements.targetLanguage.addEventListener("change", keepDirectionDistinct);
  elements.fileViewButton.addEventListener("click", () => setViewMode("file"));
  elements.alignedViewButton.addEventListener("click", () => setViewMode("aligned"));
  elements.downloadTranslationButton.addEventListener("click", downloadTranslation);
  elements.translationWorkPane.addEventListener("scroll", syncTranslationToPreview, { passive: true });
  elements.syncScroll.addEventListener("change", () => {
    if (elements.syncScroll.checked) syncTranslationToPreview();
  });
  elements.previewZoomOut.addEventListener("click", () => setPreviewZoom(state.previewZoom - 0.1));
  elements.previewZoomIn.addEventListener("click", () => setPreviewZoom(state.previewZoom + 0.1));
  elements.previewZoomReset.addEventListener("click", () => setPreviewZoom(1));
  elements.translationFontDown.addEventListener("click", () => setTranslationFontSize(state.translationFontSize - 1));
  elements.translationFontUp.addEventListener("click", () => setTranslationFontSize(state.translationFontSize + 1));
  elements.translationFontReset.addEventListener("click", () => setTranslationFontSize(16));
  elements.documentSearchInput.addEventListener("input", () => refreshDocumentSearch());
  elements.documentSearchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      navigateDocumentSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      elements.documentSearchInput.value = "";
      refreshDocumentSearch();
      elements.documentSearchInput.blur();
    }
  });
  elements.documentSearchPrev.addEventListener("click", () => navigateDocumentSearch(-1));
  elements.documentSearchNext.addEventListener("click", () => navigateDocumentSearch(1));
  bindWorkspaceSplitter();
  bindMarkdownTocSplitter();
  window.addEventListener("message", handlePreviewMessage);
  document.addEventListener("load", (event) => {
    if (event.target?.matches?.("iframe.compare-frame")) refreshDocumentSearch();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f") return;
    if (getComputedStyle(elements.documentSearch).display === "none") return;
    event.preventDefault();
    elements.documentSearchInput.focus();
    elements.documentSearchInput.select();
  });
  elements.originalPreview.addEventListener("load", () => setPreviewZoom(state.previewZoom, true));
  document.addEventListener("keydown", handleGlobalShortcuts);
  window.addEventListener("resize", () => {
    fitSourcePaneToViewport();
    scheduleTranslationLayout();
    markdownFeature.updateLayout();
    markdownFeature.updateStickyHeading();
  });

  for (const target of [document.body, elements.dropzone]) {
    target.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });
  }
  document.body.addEventListener("dragenter", (event) => {
    if (!hasFiles(event)) return;
    if (elements.functionSelect.value === "images") return;
    event.preventDefault();
    state.dragDepth += 1;
    elements.uploadOverlay.querySelector("strong").textContent =
      elements.functionSelect.value === "compare" ? "松开即可开始对比" : elements.functionSelect.value === "markdown" ? "松开即可打开 Markdown" : "松开即可导入并翻译";
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
    if (elements.functionSelect.value === "images") return;
    state.dragDepth = 0;
    elements.uploadOverlay.classList.add("hidden");
    const files = [...event.dataTransfer.files];
    if (elements.functionSelect.value === "compare") {
      compareFeature.runFiles(files);
    } else if (elements.functionSelect.value === "markdown") {
      markdownFeature.openFiles(files);
    } else {
      uploadFiles(files);
    }
  });
  window.addEventListener("beforeunload", saveBeforeClose);
}

function applyFunctionTheme(value) {
  document.body.classList.toggle("compare-theme", value === "compare");
  document.body.classList.toggle("images-theme", value === "images");
  document.body.classList.toggle("convert-theme", value === "convert");
  document.body.classList.toggle("markdown-theme", value === "markdown");
  document.body.classList.toggle("translate-theme", !["compare", "images", "convert", "markdown"].includes(value));
  if (elements.documentSearch) elements.documentSearch.setAttribute("aria-hidden", String(value === "images"));
  renderFunctionNav();
  renderPageTabs();
}

/* ---- Navigation rendering ------------------------------------------------ */

function currentWorkspace() {
  const value = elements.functionSelect?.value || "translate";
  return WORKSPACES.find((item) => item.key === value) || WORKSPACES[0];
}

function renderFunctionNav() {
  const nav = elements.functionNav;
  if (!nav) return;
  const active = currentWorkspace().key;
  nav.replaceChildren();
  for (const workspace of WORKSPACES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "function-nav-item";
    button.dataset.value = workspace.key;
    button.setAttribute("aria-current", String(workspace.key === active));
    button.title = workspace.label;
    const icon = document.createElement("span");
    icon.className = "function-nav-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = workspace.icon;
    const text = document.createElement("span");
    text.className = "function-nav-text";
    text.textContent = workspace.label;
    button.append(icon, text);
    button.addEventListener("click", () => selectWorkspace(workspace.key));
    nav.append(button);
  }
  // The last item is the global settings entry, which lives in the footer.
}

function renderPageTabs() {
  const tabs = elements.pageTabs;
  if (!tabs) return;
  const workspace = currentWorkspace();
  tabs.replaceChildren();
  tabs.hidden = workspace.pages.length === 0;
  for (const page of workspace.pages) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "page-tab";
    button.dataset.value = page.key;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(activePageKey(workspace) === page.key));
    button.textContent = page.label;
    if (page.disabled?.()) button.disabled = true;
    button.addEventListener("click", () => page.run());
    tabs.append(button);
  }
}

// Which tab reads as current is derived from live state, not from the click,
// so a page entered by shortcut or by the document toolbar still highlights.
function activePageKey(workspace) {
  if (workspace.key === "translate") {
    if (state.viewMode === "aligned") return "aligned";
    return "file";
  }
  if (workspace.key === "images") return state.imageTool;
  if (workspace.key === "markdown") return state.markdownEditMode ? "markdown-edit" : "";
  return "";
}

function selectWorkspace(value) {
  if (elements.functionSelect.value === value) return;
  elements.functionSelect.value = value;
  elements.functionSelect.dispatchEvent(new Event("change"));
}

function switchImageTool(tool) {
  state.imageTool = tool;
  imagesFeature.switchTool(tool);
  renderPageTabs();
}

function toggleCompareDiff() {
  if (!elements.compareDiff) return;
  elements.compareDiff.checked = !elements.compareDiff.checked;
  compareFeature.refreshDiff();
}

function setSidebarCollapsed(collapsed, persist = true) {
  state.sidebarCollapsed = Boolean(collapsed);
  document.documentElement.classList.remove("boot-sidebar-collapsed");
  document.body.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  elements.sidebarToggle?.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  elements.sidebarToggle?.setAttribute(
    "aria-label",
    state.sidebarCollapsed ? "展开侧栏" : "折叠侧栏",
  );
  const label = document.querySelector("#themeToggleSidebar .sidebar-action-text");
  if (label) label.textContent = state.theme === "dark" ? "浅色模式" : "深色模式";
  scheduleTranslationLayout();
  if (persist) saveDisplayPreferences();
}

// `data-theme` drives the tokens; the inline script in index.html applies the
// stored value before first paint so the shell never flashes the wrong theme.
function applyTheme(theme, persist = true) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  elements.themeToggle?.setAttribute("aria-pressed", String(state.theme === "dark"));
  if (elements.themeToggle) elements.themeToggle.textContent = state.theme === "dark" ? "☀" : "☾";
  const label = document.querySelector("#themeToggleSidebar .sidebar-action-text");
  if (label) label.textContent = state.theme === "dark" ? "浅色模式" : "深色模式";
  const icon = document.querySelector("#themeToggleSidebar .sidebar-action-icon");
  if (icon) icon.textContent = state.theme === "dark" ? "☀" : "☾";
  if (persist) saveDisplayPreferences();
}

function toggleTheme() {
  applyTheme(state.theme === "dark" ? "light" : "dark");
}

const DOCUMENT_SEARCH_BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th,.docx-paragraph,.docx-list-paragraph";

function documentSearchContext() {
  const value = elements.functionSelect?.value;
  if (value === "images" || value === "convert") return "none";
  if (value === "markdown" || value === "compare") return value;
  return "translate";
}

function searchText(value) {
  return String(value || "").toLocaleLowerCase();
}

function clearDocumentSearchHighlights() {
  for (const match of state.searchMatches || []) {
    match.element?.classList?.remove("document-search-match", "document-search-current");
  }
  document.querySelectorAll(".document-search-match,.document-search-current").forEach((element) => {
    element.classList.remove("document-search-match", "document-search-current");
  });
  document.querySelectorAll("iframe.compare-frame").forEach((frame) => {
    try {
      frame.contentDocument?.querySelectorAll(".document-search-match,.document-search-current").forEach((element) => {
        element.classList.remove("document-search-match", "document-search-current");
      });
    } catch (_) {}
  });
}

function ensureDocumentSearchStyles(doc) {
  if (!doc || doc.getElementById("document-search-style")) return;
  const style = doc.createElement("style");
  style.id = "document-search-style";
  style.textContent = ".document-search-match{outline:2px solid #8a5a00;outline-offset:2px;background:#fdf3e0!important}.document-search-current{outline:2px solid #2b6cb0!important;outline-offset:3px;background:#e8f0f9!important}";
  (doc.head || doc.documentElement).append(style);
}

function collectDocumentSearchMatches(query) {
  const context = documentSearchContext();
  const needle = searchText(query);
  if (!needle) return [];
  if (context === "none") return [];
  const matches = [];
  const addElement = (element, kind = context, ownerWindow = window, text = "") => {
    if (!element || !searchText(text || element.textContent).includes(needle)) return;
    matches.push({ element, kind, ownerWindow });
  };

  if (context === "translate") {
    if (!state.current) return matches;
    for (const row of elements.segmentRows?.querySelectorAll(".segment-row") || []) {
      const source = row.querySelector(".source-cell")?.textContent
        || row.querySelector(".source-reference > div")?.textContent
        || "";
      const target = row.querySelector("textarea")?.value || "";
      if (searchText(source).includes(needle) || searchText(target).includes(needle)) {
        matches.push({ element: row, kind: "translate", ownerWindow: window });
      }
    }
    return matches;
  }

  if (context === "markdown") {
    if (state.markdownEditMode && elements.markdownEditor && !elements.markdownEditor.classList.contains("hidden")) {
      const value = elements.markdownEditor.value || "";
      const haystack = searchText(value);
      let from = 0;
      while (from < haystack.length) {
        const index = haystack.indexOf(needle, from);
        if (index < 0) break;
        matches.push({ element: elements.markdownEditor, kind: "markdown-editor", start: index, end: index + needle.length, ownerWindow: window });
        from = index + Math.max(needle.length, 1);
      }
      return matches;
    }
    for (const element of elements.markdownRendered?.querySelectorAll(DOCUMENT_SEARCH_BLOCKS) || []) {
      addElement(element, "markdown", window);
    }
    return matches;
  }

  for (const frame of document.querySelectorAll("iframe.compare-frame")) {
    try {
      const doc = frame.contentDocument;
      if (!doc?.body) continue;
      ensureDocumentSearchStyles(doc);
      const candidates = [...doc.querySelectorAll(DOCUMENT_SEARCH_BLOCKS)];
      // PDF previews are canvas-only and have no searchable text layer.
      if (!candidates.length) continue;
      for (const element of candidates) addElement(element, "compare", frame.contentWindow || window, element.textContent || "");
    } catch (_) {
      // A preview may still be loading or may not be same-origin.
    }
  }
  return matches;
}

function renderDocumentSearchState() {
  const total = state.searchMatches.length;
  const active = total && state.searchIndex >= 0 ? state.searchIndex + 1 : 0;
  elements.documentSearchCount.textContent = `${active}/${total}`;
  elements.documentSearchCount.title = total ? `${total} 处匹配` : "没有匹配字段";
  elements.documentSearchPrev.disabled = !total;
  elements.documentSearchNext.disabled = !total;
  elements.documentSearchInput.setAttribute("aria-description", total ? `${active}/${total} 处匹配` : "没有匹配字段");
}

function scrollToDocumentSearchMatch(match) {
  if (!match) return;
  if (match.kind === "markdown-editor") {
    const editor = match.element;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(match.start, match.end);
    const before = editor.value.slice(0, match.start);
    const line = before.split("\n").length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 22;
    editor.scrollTop = Math.max(0, line * lineHeight - editor.clientHeight * 0.35);
    return;
  }
  if (match.ownerWindow && match.ownerWindow !== window) {
    try { match.ownerWindow.frameElement?.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch (_) {}
  }
  match.element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  if (match.kind === "translate") {
    match.element.querySelector("textarea")?.focus({ preventScroll: true });
  }
}

function activateDocumentSearchMatch(index, scroll = true) {
  const total = state.searchMatches.length;
  if (!total) {
    state.searchIndex = -1;
    renderDocumentSearchState();
    return;
  }
  state.searchIndex = (index + total) % total;
  const activeElement = state.searchMatches[state.searchIndex].element;
  const uniqueElements = new Set(state.searchMatches.map((match) => match.element));
  uniqueElements.forEach((element) => {
    element.classList.toggle("document-search-match", element !== activeElement);
    element.classList.toggle("document-search-current", element === activeElement);
  });
  renderDocumentSearchState();
  if (scroll) scrollToDocumentSearchMatch(state.searchMatches[state.searchIndex]);
}

function refreshDocumentSearch({ scroll = true } = {}) {
  if (!elements.documentSearchInput) return;
  const query = elements.documentSearchInput.value.trim();
  const previousQuery = state.searchQuery;
  const previousIndex = state.searchIndex;
  clearDocumentSearchHighlights();
  state.searchQuery = query;
  state.searchMatches = collectDocumentSearchMatches(query);
  if (!query || !state.searchMatches.length) state.searchIndex = -1;
  else if (query === previousQuery && previousIndex >= 0) state.searchIndex = Math.min(previousIndex, state.searchMatches.length - 1);
  else state.searchIndex = 0;
  if (state.searchMatches.length) activateDocumentSearchMatch(state.searchIndex, scroll && (query !== previousQuery || previousIndex < 0));
  else renderDocumentSearchState();
}

function navigateDocumentSearch(direction) {
  if (!elements.documentSearchInput.value.trim()) {
    elements.documentSearchInput.focus();
    return;
  }
  if (!state.searchMatches.length) {
    refreshDocumentSearch();
    return;
  }
  activateDocumentSearchMatch(state.searchIndex + direction, true);
}

function setPreviewZoom(value, force = false) {
  const zoom = Math.max(0.6, Math.min(2, Math.round(value * 10) / 10));
  if (!force && zoom === state.previewZoom) return;
  state.previewZoom = zoom;
  elements.previewZoomValue.textContent = `${Math.round(zoom * 100)}%`;
  elements.previewZoomOut.disabled = zoom <= 0.6;
  elements.previewZoomIn.disabled = zoom >= 2;
  elements.originalPreview.contentWindow?.postMessage({
    type: "fxxk_file-preview-zoom",
    zoom,
  }, "*");
  if (!force) saveDisplayPreferences();
}

function setTranslationFontSize(value, persist = true) {
  const size = Math.max(14, Math.min(22, Math.round(Number(value) || 16)));
  state.translationFontSize = size;
  document.documentElement.style.setProperty("--translation-font-size", `${size}px`);
  elements.translationFontValue.textContent = String(size);
  elements.translationFontDown.disabled = size <= 14;
  elements.translationFontUp.disabled = size >= 22;
  fitVisibleRows();
  scheduleTranslationLayout();
  if (persist) saveDisplayPreferences();
}

function setSourcePanePercent(value, persist = true) {
  const percent = Math.max(30, Math.min(70, Math.round(Number(value) * 10) / 10));
  state.sourcePanePercent = percent;
  document.documentElement.style.setProperty("--source-pane-width", `${percent}%`);
  elements.workspaceSplitter.setAttribute("aria-valuenow", String(Math.round(percent)));
  scheduleTranslationLayout();
  if (persist) saveDisplayPreferences();
}

function bindWorkspaceSplitter() {
  let dragging = false;

  const resizeFromPointer = (clientX, persist = false) => {
    const bounds = elements.reviewBody.getBoundingClientRect();
    if (!bounds.width) return;
    const compact = window.matchMedia("(max-width: 980px)").matches;
    const sourceMinimum = compact ? 280 : 320;
    const translationMinimum = compact ? 340 : 360;
    const minPercent = Math.max(30, sourceMinimum / bounds.width * 100);
    const maxPercent = Math.min(70, (bounds.width - translationMinimum - 7) / bounds.width * 100);
    const next = Math.max(minPercent, Math.min(maxPercent, (clientX - bounds.left) / bounds.width * 100));
    setSourcePanePercent(next, persist);
  };

  elements.workspaceSplitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || state.viewMode !== "file") return;
    dragging = true;
    elements.workspaceSplitter.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-workspace");
    resizeFromPointer(event.clientX);
  });
  elements.workspaceSplitter.addEventListener("pointermove", (event) => {
    if (dragging) resizeFromPointer(event.clientX);
  });
  elements.workspaceSplitter.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing-workspace");
    if (elements.workspaceSplitter.hasPointerCapture(event.pointerId)) {
      elements.workspaceSplitter.releasePointerCapture(event.pointerId);
    }
    resizeFromPointer(event.clientX, true);
  });
  elements.workspaceSplitter.addEventListener("pointercancel", () => {
    dragging = false;
    document.body.classList.remove("resizing-workspace");
  });
  elements.workspaceSplitter.addEventListener("dblclick", () => setSourcePanePercent(50));
  elements.workspaceSplitter.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setSourcePanePercent(state.sourcePanePercent + direction * (event.shiftKey ? 5 : 2));
  });
}

// ---- Markdown outline: width and visibility are separate concerns ---------
//
// Two controls, one job each — never both on the same handle:
//   #markdownTocToggle (toolbar button, Ctrl+\)  show / hide   (binary)
//   #markdownTocSplitter (6px rail in the body)  resize width  (continuous)
// Dragging the rail therefore never hides the outline; only the button does.
// This mirrors #workspaceSplitter, whose double-click resets the split rather
// than toggling a pane.

const MARKDOWN_TOC_MIN = 140;
const MARKDOWN_TOC_MAX = 420;
const MARKDOWN_TOC_DEFAULT = 196;

function setMarkdownTocWidth(value, persist = true) {
  const width = Math.max(MARKDOWN_TOC_MIN, Math.min(MARKDOWN_TOC_MAX, Math.round(Number(value) || 0)));
  state.markdownTocWidth = width;
  elements.markdownToc.style.width = `${width}px`;
  elements.markdownTocSplitter.setAttribute("aria-valuenow", String(width));
  elements.markdownTocSplitter.title = "拖动调整目录宽度，双击恢复默认";
  markdownFeature.updateLayout();
  if (persist) saveDisplayPreferences();
}

function setMarkdownTocVisible(visible, persist = true) {
  const shown = Boolean(visible);
  state.markdownTocVisible = shown;
  elements.markdownBodyWrap.classList.toggle("toc-collapsed", !shown);
  elements.markdownTocSplitter.setAttribute("aria-valuenow", shown ? String(state.markdownTocWidth) : "0");
  elements.markdownTocSplitter.title = shown
    ? "拖动调整目录宽度，双击恢复默认"
    : "";
  // The outline's own scroll position must be re-read once it is shown again,
  // because the heading scan measured a hidden (zero-height) element.
  if (shown) requestAnimationFrame(() => markdownFeature.updateStickyHeading());
  const toggle = elements.markdownTocToggle;
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(shown));
    toggle.textContent = shown ? "隐藏目录" : "显示目录";
    const hint = shown ? "隐藏左侧目录（Ctrl+\\）" : "显示左侧目录（Ctrl+\\）";
    toggle.title = hint;
  }
  markdownFeature.updateLayout();
  if (persist) saveDisplayPreferences();
}

function toggleMarkdownToc() {
  setMarkdownTocVisible(!state.markdownTocVisible);
}

function bindMarkdownTocSplitter() {
  let dragging = false;
  let moved = false;

  const resizeFromPointer = (clientX, persist = false) => {
    const bounds = elements.markdownBodyWrap.getBoundingClientRect();
    if (!bounds.width) return;
    setMarkdownTocWidth(clientX - bounds.left, persist);
  };

  elements.markdownTocSplitter.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || !state.markdownTocVisible) return;
    dragging = true;
    moved = false;
    elements.markdownTocSplitter.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-toc");
  });
  elements.markdownTocSplitter.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    // A press that never moves must not be read as a width change.
    if (Math.abs(event.movementX) > 0) moved = true;
    resizeFromPointer(event.clientX);
  });
  elements.markdownTocSplitter.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing-toc");
    if (elements.markdownTocSplitter.hasPointerCapture(event.pointerId)) {
      elements.markdownTocSplitter.releasePointerCapture(event.pointerId);
    }
    if (moved) resizeFromPointer(event.clientX, true);
  });
  elements.markdownTocSplitter.addEventListener("pointercancel", () => {
    dragging = false;
    document.body.classList.remove("resizing-toc");
  });
  // Double-click resets the width, exactly like the translation splitter.
  elements.markdownTocSplitter.addEventListener("dblclick", () => {
    if (state.markdownTocVisible) setMarkdownTocWidth(MARKDOWN_TOC_DEFAULT);
  });
  elements.markdownTocSplitter.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      // The rail is a separator, not a switch: Enter returns it to default.
      event.preventDefault();
      if (state.markdownTocVisible) setMarkdownTocWidth(MARKDOWN_TOC_DEFAULT);
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // An arrow key is a width gesture, so it implies the outline should be
    // visible; reaching for width while it is hidden would otherwise do nothing.
    if (!state.markdownTocVisible) setMarkdownTocVisible(true);
    const step = event.shiftKey ? 24 : 8;
    setMarkdownTocWidth(state.markdownTocWidth + (event.key === "ArrowRight" ? step : -step));
  });
  // The toolbar button is the only visibility control.
  elements.markdownTocToggle?.addEventListener("click", toggleMarkdownToc);
}

function fitSourcePaneToViewport() {  if (state.viewMode !== "file") return;
  const width = elements.reviewBody.getBoundingClientRect().width;
  if (!width) return;
  const compact = window.matchMedia("(max-width: 980px)").matches;
  const sourceMinimum = compact ? 280 : 320;
  const translationMinimum = compact ? 340 : 360;
  const minimum = Math.max(30, sourceMinimum / width * 100);
  const maximum = Math.min(70, (width - translationMinimum - 7) / width * 100);
  if (maximum >= minimum) setSourcePanePercent(Math.max(minimum, Math.min(maximum, state.sourcePanePercent)), false);
}

function restoreDisplayPreferences() {
  let preferences = {};
  try {
    preferences = JSON.parse(localStorage.getItem(DISPLAY_PREFERENCES_KEY) || "{}");
  } catch (_) {}
  state.previewZoom = Math.max(0.6, Math.min(2, Number(preferences.previewZoom) || 1));
  state.viewMode = preferences.viewMode === "aligned" ? "aligned" : "file";
  setTranslationFontSize(preferences.translationFontSize || 16, false);
  setSourcePanePercent(preferences.sourcePanePercent || 50, false);
  setMarkdownTocWidth(preferences.markdownTocWidth ?? MARKDOWN_TOC_DEFAULT, false);
  setMarkdownTocVisible(preferences.markdownTocVisible !== false, false);
  applyTheme(preferences.theme === "dark" ? "dark" : "light", false);
  setSidebarCollapsed(Boolean(preferences.sidebarCollapsed), false);
  elements.previewZoomValue.textContent = `${Math.round(state.previewZoom * 100)}%`;
  elements.previewZoomOut.disabled = state.previewZoom <= 0.6;
  elements.previewZoomIn.disabled = state.previewZoom >= 2;
}

function saveDisplayPreferences() {
  try {
    localStorage.setItem(DISPLAY_PREFERENCES_KEY, JSON.stringify({
      previewZoom: state.previewZoom,
      translationFontSize: state.translationFontSize,
      sourcePanePercent: state.sourcePanePercent,
      markdownTocWidth: state.markdownTocWidth,
      markdownTocVisible: state.markdownTocVisible,
      sidebarCollapsed: state.sidebarCollapsed,
      theme: state.theme,
      viewMode: state.viewMode,
    }));
  } catch (_) {}
}

function hasFiles(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}

function setSaveState(text, status = "") {
  elements.saveState.textContent = text;
  if (status) elements.saveState.dataset.state = status;
  else delete elements.saveState.dataset.state;
}

/* ---- Keyboard shortcuts -------------------------------------------------
 * One place lists the bindings so the help panel and the handlers cannot drift.
 * `when` decides whether the row is relevant to what the user is looking at.
 */
const SHORTCUTS = [
  { keys: ["Ctrl", "F"], label: "在当前工作区搜索", when: () => true },
  { keys: ["Ctrl", "B"], label: "折叠或展开侧栏", when: () => true },
  { keys: ["Ctrl", "O"], label: "打开待翻译文档", when: () => elements.functionSelect.value === "translate" },
  { keys: ["Ctrl", "S"], label: "保存 Markdown", when: () => state.markdownEditMode },
  { keys: ["Ctrl", "\\"], label: "显示或隐藏 Markdown 目录", when: () => elements.functionSelect.value === "markdown" },
  { keys: ["Ctrl", "Enter"], label: "标记本段已审校", when: () => Boolean(state.current) },
  { keys: ["Alt", "↑"], label: "跳到上一段", when: () => Boolean(state.current) },
  { keys: ["Alt", "↓"], label: "跳到下一段", when: () => Boolean(state.current) },
  { keys: ["Ctrl", "1"], label: "原件版面对照", when: () => Boolean(state.current) },
  { keys: ["Ctrl", "2"], label: "逐段精确对照", when: () => Boolean(state.current) },
  { keys: ["Ctrl", "D"], label: "下载译文 DOCX", when: () => Boolean(state.current) },
  { keys: ["?"], label: "显示这个快捷键面板", when: () => true },
  { keys: ["Esc"], label: "关闭面板或退出全屏", when: () => true },
];

function renderShortcutList() {
  const list = $("#shortcutList");
  if (!list) return;
  list.replaceChildren();
  for (const shortcut of SHORTCUTS) {
    // Hide bindings that cannot fire in the current workspace so the panel
    // stays a short, honest list instead of a wall of keys.
    let relevant = true;
    try { relevant = shortcut.when(); } catch (_) { relevant = false; }
    if (!relevant) continue;
    const row = document.createElement("div");
    row.className = "shortcut-row";
    const keys = document.createElement("span");
    keys.className = "shortcut-keys";
    for (const key of shortcut.keys) {
      const cap = document.createElement("kbd");
      cap.textContent = key;
      keys.append(cap);
    }
    const label = document.createElement("span");
    label.className = "shortcut-label";
    label.textContent = shortcut.label;
    row.append(keys, label);
    list.append(row);
  }
}

function isTypingTarget(target) {
  const tag = target?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable;
}

function handleGlobalShortcuts(event) {
  if (event.key === "?") {
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    renderShortcutList();
    elements.shortcutDialog?.showModal();
    return;
  }
  if (event.key === "Escape" && elements.shortcutDialog?.open) {
    elements.shortcutDialog.close();
    return;
  }
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.key === "o") {
    // Opening the picker is safe from anywhere: it never edits the open document.
    event.preventDefault();
    elements.fileInput.click();
    return;
  }
  if (event.key.toLowerCase() === "b") {
    // Layout, not content: safe even while typing.
    event.preventDefault();
    setSidebarCollapsed(!state.sidebarCollapsed);
    return;
  }
  if (isTypingTarget(event.target) && event.key !== "s") return;
  if (event.key === "\\" && elements.functionSelect.value === "markdown") {
    event.preventDefault();
    toggleMarkdownToc();
  } else if (event.key === "1" && state.current) {
    event.preventDefault();
    setViewMode("file");
  } else if (event.key === "2" && state.current) {
    event.preventDefault();
    setViewMode("aligned");
  } else if (event.key.toLowerCase() === "d" && state.current) {
    event.preventDefault();
    downloadTranslation();
  }
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
    elements.zhScriptMode.value = settings.zh_script_mode || "auto";
    elements.zhScriptMode.disabled = settings.zh_script_available === false;
    elements.zhScriptLabel.title = settings.zh_script_available === false
      ? "未安装 zhconv，无法自动转换繁简；请执行 pip install -r requirements.txt"
      : "翻译完成后自动把中文译文转换为所选字形";
    elements.autoOcr.disabled = settings.ocr_available === false;
    elements.autoOcrLabel.title = settings.ocr_available === false
      ? "未安装离线 OCR 组件；可执行 pip install -r requirements-ocr.txt 后启用"
      : "扫描版 PDF 在本机离线识别后再翻译";
    if (settings.ocr_available === false) elements.autoOcr.checked = false;
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
        zh_script_mode: elements.zhScriptMode.value,
      }),
    });
    await loadSettings();
    elements.settingsDialog.close();
    showToast("模型设置已保存。", false);
    const shouldTranslate = state.pendingTranslateAfterSettings;
    state.pendingTranslateAfterSettings = false;
    if (
      shouldTranslate
      && elements.autoTranslate.checked
      && state.current
      && state.current.status !== "translating"
    ) {
      await startTranslation(false);
    }
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
  state.selectionVersion += 1;
  if (state.current) {
    try {
      await flushCurrentDocument();
    } catch (error) {
      setSaveState("保存失败", "error");
      showToast(`当前文档保存失败，已停止导入：${error.message}`, true);
      return;
    }
  }
  for (const file of supported) {
    const form = new FormData();
    form.append("file", file);
    form.append("source_language", "auto");
    form.append("target_language", "auto");
    form.append("auto_ocr", elements.autoOcr?.checked ? "true" : "false");
    elements.dropzone.classList.add("dragging");
    elements.dropzone.querySelector("strong").textContent = `正在解析 ${file.name}…`;
    try {
      const documentData = await api("/api/documents", { method: "POST", body: form });
      setCurrentDocument(documentData, true);
      await loadDocumentList();
      showToast(
        documentData.ocr
          ? `已离线 OCR 并导入 ${file.name}，共 ${documentData.segments.length} 段。`
          : `已导入 ${file.name}，共 ${documentData.segments.length} 段。`,
        false,
      );
      if (elements.autoTranslate.checked) {
        if (state.settings?.configured) {
          await startTranslation(false);
        } else {
          showToast("文档已解析。配置模型后即可开始翻译。", false);
          state.pendingTranslateAfterSettings = true;
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
  if (!documents.length) {
    const empty = document.createElement("p");
    empty.className = "document-list-empty";
    empty.textContent = "暂无最近文档。拖入文件后，任务会显示在这里。";
    elements.documentList.append(empty);
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
      await flushCurrentDocument();
    }
    await api(`/api/documents/${documentData.id}`, { method: "DELETE" });
    if (state.current?.id === documentData.id) {
      stopPoll();
      state.selectionVersion += 1;
      state.current = null;
      refreshDocumentSearch({ scroll: false });
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
  if (state.current?.id === id) return;
  const selectionVersion = ++state.selectionVersion;
  try {
    if (state.current?.id && state.current.id !== id) await flushCurrentDocument();
    const documentData = await api(`/api/documents/${id}`);
    if (selectionVersion !== state.selectionVersion) return;
    setCurrentDocument(documentData, true);
    await loadDocumentList();
    if (documentData.status === "translating") schedulePoll();
  } catch (error) {
    showToast(error.message, true);
  }
}

function segmentSaveKey(documentId, segmentId) {
  return `${documentId}:${segmentId}`;
}

function dirtyTranslationsForDocument(documentId) {
  const prefix = `${documentId}:`;
  const translations = {};
  for (const [key, value] of state.dirtyTranslations) {
    if (!key.startsWith(prefix)) continue;
    translations[key.slice(prefix.length)] = value;
  }
  return translations;
}

function clearSavedDirtyTranslations(documentId, translations) {
  for (const [segmentId, value] of Object.entries(translations)) {
    const key = segmentSaveKey(documentId, segmentId);
    if (state.dirtyTranslations.get(key) === value) state.dirtyTranslations.delete(key);
  }
}

function hasPendingSegmentSave(documentId, segmentId) {
  return state.saveTimers.has(segmentSaveKey(documentId, segmentId));
}

function hasPendingDocumentSaves(documentId) {
  const prefix = `${documentId}:`;
  return [...state.saveTimers.keys(), ...state.saveInFlight.keys()].some((key) => key.startsWith(prefix));
}

function clearDocumentSaveTimers(documentId) {
  const prefix = `${documentId}:`;
  for (const [key, record] of state.saveTimers) {
    if (!key.startsWith(prefix)) continue;
    clearTimeout(record.timer);
    state.saveTimers.delete(key);
  }
}

async function flushCurrentDocument() {
  if (!state.current) return;
  const documentId = state.current.id;
  setSaveState("保存中…", "saving");
  clearDocumentSaveTimers(documentId);
  const prefix = `${documentId}:`;
  const inFlight = [...state.saveInFlight.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, request]) => request);
  if (inFlight.length) await Promise.allSettled(inFlight);
  const translations = dirtyTranslationsForDocument(documentId);
  if (Object.keys(translations).length) {
    await api(`/api/documents/${documentId}/autosave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ translations }),
    });
    clearSavedDirtyTranslations(documentId, translations);
  }
  if (state.current?.id === documentId) setSaveState("已保存", "saved");
}

function setCurrentDocument(documentData, fullRender = false) {
  const previous = state.current;
  state.current = documentData;
  ensureSourceProgressIndex();
  history.replaceState(null, "", `#/${documentData.id}`);
  elements.emptyState.classList.add("hidden");
  elements.reviewWorkspace.classList.remove("hidden");
  requestAnimationFrame(fitSourcePaneToViewport);
  updateDocumentMeta(documentData);
  if (!previous || previous.id !== documentData.id) {
    state.segmentPageMap = null;
    state.segmentPageMapTask = null;
    elements.previewPageStatus.textContent = "正在载入页码…";
    elements.originalPreview.src = `/api/documents/${documentData.id}/preview`;
    elements.openOriginalButton.href = `/api/documents/${documentData.id}/original`;
    setViewMode(state.viewMode, false);
  }

  const mustRender = fullRender || !previous || previous.id !== documentData.id || previous.segments.length !== documentData.segments.length;
  if (mustRender) {
    renderFilterChips();
    renderRows(documentData.segments);
  } else {
    updateFilterCounts();
    mergeRows(documentData.segments);
  }
  refreshDocumentSearch({ scroll: !previous || previous.id !== documentData.id });

  if (documentData.status === "translating") schedulePoll();
  else stopPoll();
}

/* ---- Paragraph filter ---------------------------------------------------
 * Selection state lives in JS and mirrors to the backend, which owns the real
 * selection for bulk actions: the browser may only have part of a long
 * document rendered, so the server must not depend on what is on screen.
 */
function matchesFilter(segment, mode) {
  const translation = (segment.translation || "").trim();
  const status = segment.status || "empty";
  if (mode === "all") return true;
  if (mode === "locked") return Boolean(segment.locked);
  if (mode === "untranslated") return !translation || status === "queued";
  return status === mode;
}

function filteredSegments() {
  const segments = state.current?.segments || [];
  if (state.segmentFilter === "all") return segments;
  return segments.filter((segment) => matchesFilter(segment, state.segmentFilter));
}

function filterCounts() {
  const segments = state.current?.segments || [];
  const counts = { all: segments.length };
  for (const definition of FILTER_DEFINITIONS) {
    if (definition.value === "all") continue;
    counts[definition.value] = segments.filter((segment) => matchesFilter(segment, definition.value)).length;
  }
  return counts;
}

function renderFilterChips() {  const counts = filterCounts();
  elements.segmentFilter.replaceChildren();
  for (const definition of FILTER_DEFINITIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "review-filter-chip";
    button.dataset.filter = definition.value;
    button.setAttribute("aria-pressed", String(state.segmentFilter === definition.value));
    const label = document.createElement("span");
    label.textContent = definition.label;
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(counts[definition.value] ?? 0);
    button.append(label, count);
    button.addEventListener("click", () => setSegmentFilter(definition.value));
    elements.segmentFilter.append(button);
  }
  updateFilterCounts();
}

function updateFilterCounts() {
  const counts = filterCounts();
  for (const button of elements.segmentFilter.querySelectorAll(".review-filter-chip")) {
    const value = button.dataset.filter;
    const count = button.querySelector(".count");
    if (count) count.textContent = String(counts[value] ?? 0);
    button.setAttribute("aria-pressed", String(state.segmentFilter === value));
  }
  const shown = state.segmentFilter === "all" ? counts.all : counts[state.segmentFilter] ?? 0;
  elements.segmentFilterCount.textContent = state.segmentFilter === "all"
    ? `共 ${counts.all} 段`
    : `筛选出 ${shown} / ${counts.all} 段`;
  const disabled = shown === 0 || state.current?.status === "translating";
  elements.bulkMenu.disabled = disabled;
  for (const button of elements.bulkOptions.querySelectorAll("button")) button.disabled = disabled;
}

function setSegmentFilter(value) {
  if (state.segmentFilter === value) return;
  state.segmentFilter = value;
  renderRows(state.current?.segments || []);
}

// One bulk action against the server, then a local re-render from the response
// so the visible rows and the chip counts never drift from persisted state.
async function runBulkAction(action) {
  const documentId = state.current?.id;
  if (!documentId) return;
  const filter = state.segmentFilter;
  const button = { lock: elements.bulkLock, unlock: elements.bulkUnlock, review: elements.bulkReview, unreview: elements.bulkUnreview, clear: elements.bulkClear }[action];
  const confirmations = {
    clear: `清空「${filterLabel(filter)}」段落中的译文？原文会保留，已锁定的段落不受影响。`,
  };
  if (confirmations[action] && !window.confirm(confirmations[action])) return;
  if (button) button.disabled = true;
  try {
    const result = await api(`/api/documents/${documentId}/segments/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filter, action }),
    });
    if (state.current?.id === documentId) setCurrentDocument(result.document, true);
    showToast(bulkResultMessage(result), false);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

function filterLabel(value) {
  return FILTER_DEFINITIONS.find((definition) => definition.value === value)?.label || value;
}

function bulkResultMessage(result) {
  const label = filterLabel(result.filter);
  if (!result.changed) return `「${label}」中没有需要改动的段落（匹配 ${result.matched} 段）。`;
  const verbs = { lock: "锁定", unlock: "解锁", review: "标记为已审校", unreview: "撤销审校", clear: "清空译文" };
  return `已把 ${result.changed} 段（${label}）${verbs[result.action] || result.action}。`;
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
  elements.retranslateButton.disabled = documentData.status === "translating";
  elements.stopButton.disabled = documentData.status !== "translating";
  elements.zhScriptButton.disabled = documentData.status === "translating"
    || !documentData.segments.some((segment) => /[\u3400-\u9fff]/.test(segment.translation || ""));
  if (documentData.status === "error" && documentData.error) {
    elements.statusBadge.title = documentData.error;
  }
}

function renderRows(segments) {
  const visible = state.segmentFilter === "all"
    ? segments
    : segments.filter((segment) => matchesFilter(segment, state.segmentFilter));
  elements.segmentRows.replaceChildren();
  const fragment = document.createDocumentFragment();
  visible.forEach((segment) => fragment.append(makeRow(segment, segments.indexOf(segment))));
  elements.segmentRows.append(fragment);
  const empty = !visible.length;
  elements.segmentRows.classList.toggle("hidden", empty);
  elements.segmentRowsEmpty.classList.toggle("hidden", !empty);
  if (empty) {
    elements.segmentRowsEmptyText.textContent = `「${filterLabel(state.segmentFilter)}」中暂时没有段落。`;
  }
  fitVisibleRows();
  scheduleTranslationLayout();
  updateFilterCounts();
  refreshDocumentSearch({ scroll: false });
}

// Only the rows around the viewport are measured. Everything else keeps the
// CSS default height until it scrolls into range, which is what keeps a 1500+
// segment document responsive.
function fitVisibleRows() {
  const textareas = [...elements.segmentRows.querySelectorAll("textarea")];
  if (textareas.length <= AUTO_GROW_ALL_THRESHOLD) {
    fitTextareaHeights(textareas);
    return;
  }
  const pane = elements.translationWorkPane;
  const paneRect = pane.getBoundingClientRect();
  const top = paneRect.top - AUTO_GROW_VIEWPORT_MARGIN;
  const bottom = paneRect.bottom + AUTO_GROW_VIEWPORT_MARGIN;
  const visible = textareas.filter((textarea) => {
    const rect = textarea.getBoundingClientRect();
    return rect.bottom >= top && rect.top <= bottom;
  });
  fitTextareaHeights(visible);
}

function setViewMode(mode, persist = true) {
  state.viewMode = mode;
  const aligned = mode === "aligned";
  elements.reviewBody.classList.toggle("file-view", !aligned);
  elements.reviewBody.classList.toggle("aligned-view", aligned);
  elements.fileViewButton.classList.toggle("active", !aligned);
  elements.alignedViewButton.classList.toggle("active", aligned);
  renderPageTabs();
  scheduleTranslationLayout();
  if (!aligned) {
    requestAnimationFrame(fitSourcePaneToViewport);
    if (elements.syncScroll.checked) requestAnimationFrame(syncTranslationToPreview);
  }
  if (persist) saveDisplayPreferences();
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
        type: "fxxk_file-sync-scroll",
        ratio: sourceProgress,
        source_progress: sourceProgress,
      }, "*");
    }
  });
}

function handlePreviewMessage(event) {
  if (event.data?.type === "fxxk_file-preview-ready" && event.source?.frameElement?.classList?.contains("compare-frame")) {
    refreshDocumentSearch();
    return;
  }
  if (event.source !== elements.originalPreview.contentWindow || !event.data) return;
  const message = event.data;
  if (message.type === "fxxk_file-preview-error") {
    elements.previewPageStatus.textContent = message.message || "原件无法分页预览";
    return;
  }
  if (message.type !== "fxxk_file-preview-scroll" && message.type !== "fxxk_file-preview-ready") return;
  const pages = Number(message.pages) || 0;
  if (pages > 0) {
    const page = Math.max(1, Math.min(pages, Number(message.page) || 1));
    const mapped = state.segmentPageMap?.documentId === state.current?.id;
    elements.previewPageStatus.textContent =
      (mapped ? "段落对应第 " : "原件约第 ") + page + " / " + pages + " 页";
  }
  if (message.type === "fxxk_file-preview-ready") ensureSegmentPageMap();
  if (
    message.type === "fxxk_file-preview-scroll"
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
  const documentIds = new Set([...state.dirtyTranslations.keys()].map((key) => key.split(":", 1)[0]));
  for (const documentId of documentIds) {
    const translations = dirtyTranslationsForDocument(documentId);
    if (!Object.keys(translations).length) continue;
    const payload = new Blob([JSON.stringify({ translations })], { type: "application/json" });
    navigator.sendBeacon(`/api/documents/${documentId}/autosave`, payload);
  }
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
    refreshDocumentSearch({ scroll: false });
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
  const review = actionButton("✓", "标记为已审校（Ctrl+Enter）");
  review.dataset.action = "review";
  review.classList.toggle("reviewed", segment.status === "reviewed");
  review.addEventListener("click", () => toggleReviewed(segment.id, !review.classList.contains("reviewed")));
  textarea.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown Control+Enter");
  textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      review.click();
      return;
    }
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    focusAdjacentTranslation(row, event.key === "ArrowUp" ? -1 : 1);
  });
  actions.append(sourceToggle, translate, lock, review);

  row.append(number, source, target, actions);
  return row;
}

// Height fitting is the most expensive thing the row list does. Writing
// `height:auto` and reading `scrollHeight` forces a synchronous layout, so
// doing it once per row on a long document costs seconds of frozen UI
// (measured: ~2.1 s for 1570 rows). Growing only the rows near the viewport
// keeps the cost proportional to what the user can actually see, and a
// two-pass "reset everything, then write everything" variant is used whenever
// the whole list must be refitted (font size change).

let pendingAutoGrowRows = null;
let autoGrowFrame = 0;

function requestAutoGrow(row) {
  if (pendingAutoGrowRows) pendingAutoGrowRows.add(row);
  else pendingAutoGrowRows = new Set([row]);
  if (autoGrowFrame) return;
  autoGrowFrame = requestAnimationFrame(() => {
    autoGrowFrame = 0;
    const rows = pendingAutoGrowRows;
    pendingAutoGrowRows = null;
    if (!rows?.size) return;
    if (rows.size > AUTO_GROW_ALL_THRESHOLD) {
      autoGrowAll();
      return;
    }
    for (const target of rows) {
      if (target.isConnected) autoGrow(target.querySelector("textarea"));
    }
    scheduleTranslationLayout();
  });
}

function autoGrowAll() {
  const textareas = [...elements.segmentRows.querySelectorAll("textarea")];
  fitTextareaHeights(textareas);
  scheduleTranslationLayout();
}

function fitTextareaHeights(textareas) {
  // Pass 1: let every textarea fall back to its natural height. Only the write
  // happens here, so the browser can batch the style recalculation.
  for (const textarea of textareas) textarea.style.height = "auto";
  // Pass 2: read all scroll heights while the layout is clean...
  const heights = textareas.map((textarea) => Math.max(89, textarea.scrollHeight));
  // ...then write them back in one go.
  for (let index = 0; index < textareas.length; index += 1) {
    textareas[index].style.height = `${heights[index]}px`;
  }
}

const AUTO_GROW_ALL_THRESHOLD = 400;
const AUTO_GROW_VIEWPORT_MARGIN = 1200;

function autoGrow(textarea) {
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(89, textarea.scrollHeight)}px`;
}

function focusAdjacentTranslation(row, direction) {
  const rows = [...elements.segmentRows.querySelectorAll(".segment-row")];
  const next = rows[rows.indexOf(row) + direction];
  const textarea = next?.querySelector("textarea");
  if (!textarea) return;
  textarea.focus({ preventScroll: true });
  next.scrollIntoView({ block: "center", behavior: "smooth" });
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
    if (document.activeElement !== textarea && !hasPendingSegmentSave(state.current.id, segment.id) && textarea.value !== (segment.translation || "")) {
      textarea.value = segment.translation || "";
      requestAutoGrow(row);
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
  // A poll can move a paragraph in or out of the active filter, so the row set
  // is rebuilt whenever the current filter's membership changed.
  if (state.segmentFilter !== "all"
    && segments.some((segment) => matchesFilter(segment, state.segmentFilter) !== Boolean(elements.segmentRows.querySelector(`[data-segment-id="${segment.id}"]`)))) {
    renderRows(segments);
    return;
  }
  scheduleTranslationLayout();
  updateFilterCounts();
  refreshDocumentSearch({ scroll: false });
}

function queueSegmentSave(segmentId, body) {
  const documentId = state.current?.id;
  if (!documentId) return;
  const key = segmentSaveKey(documentId, segmentId);
  if (Object.hasOwn(body, "translation")) state.dirtyTranslations.set(key, body.translation);
  const previous = state.saveTimers.get(key);
  if (previous) clearTimeout(previous.timer);
  setSaveState("有未保存更改", "dirty");
  const token = Symbol(key);
  const record = { timer: null, token };
  record.timer = setTimeout(async () => {
    let succeeded = false;
    if (state.current?.id === documentId) setSaveState("保存中…", "saving");
    const previousRequest = state.saveInFlight.get(key) || Promise.resolve();
    const request = previousRequest.catch(() => {}).then(() => api(`/api/documents/${documentId}/segments/${segmentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }));
    state.saveInFlight.set(key, request);
    try {
      const updated = await request;
      if (state.current?.id === documentId) {
        const local = state.current.segments.find((item) => item.id === segmentId);
        if (local) Object.assign(local, updated);
        const row = elements.segmentRows.querySelector(`[data-segment-id="${segmentId}"]`);
        if (row) row.querySelector(".segment-state").textContent = segmentStatusName(updated.status);
      }
      if (Object.hasOwn(body, "translation") && state.dirtyTranslations.get(key) === body.translation) {
        state.dirtyTranslations.delete(key);
      }
      succeeded = true;
    } catch (error) {
      if (state.current?.id === documentId) setSaveState("保存失败", "error");
      showToast(error.message, true);
    } finally {
      if (state.saveTimers.get(key)?.token === token) state.saveTimers.delete(key);
      if (state.saveInFlight.get(key) === request) state.saveInFlight.delete(key);
      if (succeeded && state.current?.id === documentId && !hasPendingDocumentSaves(documentId)) {
        setSaveState("已保存", "saved");
      }
    }
  }, 650);
  state.saveTimers.set(key, record);
}

async function toggleLock(segmentId, locked) {
  const documentId = state.current?.id;
  if (!documentId) return;
  const button = elements.segmentRows.querySelector(`[data-segment-id="${segmentId}"] [data-action="lock"]`);
  if (button) button.disabled = true;
  try {
    const updated = await patchSegment(documentId, segmentId, { locked });
    if (state.current?.id === documentId) updateLocalSegment(updated);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

async function toggleReviewed(segmentId, reviewed) {
  const documentId = state.current?.id;
  if (!documentId) return;
  const row = elements.segmentRows.querySelector(`[data-segment-id="${segmentId}"]`);
  const button = row?.querySelector('[data-action="review"]');
  if (button) button.disabled = true;
  const translation = row?.querySelector("textarea")?.value || "";
  try {
    const key = segmentSaveKey(documentId, segmentId);
    const pending = state.saveTimers.get(key);
    if (pending) clearTimeout(pending.timer);
    state.saveTimers.delete(key);
    const inFlight = state.saveInFlight.get(key);
    if (inFlight) await inFlight.catch(() => {});
    const updated = await patchSegment(documentId, segmentId, { translation, reviewed });
    if (state.dirtyTranslations.get(key) === translation) state.dirtyTranslations.delete(key);
    if (state.current?.id === documentId) {
      updateLocalSegment(updated);
      if (!hasPendingDocumentSaves(documentId)) setSaveState("已保存", "saved");
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
}

async function patchSegment(documentId, segmentId, body) {
  return api(`/api/documents/${documentId}/segments/${segmentId}`, {
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
  const documentId = state.current?.id;
  if (!documentId) return;
  button.disabled = true;
  button.classList.add("busy");
  try {
    const updated = await api(`/api/documents/${documentId}/segments/${segmentId}/translate`, { method: "POST" });
    if (state.current?.id === documentId) updateLocalSegment(updated);
    if (state.current?.id === documentId) showToast("本段已重新翻译。", false);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.classList.remove("busy");
  }
}

async function convertChineseScript() {
  const documentData = state.current;
  if (!documentData) return;
  const mode = elements.zhScriptMode.value;
  const hasChinese = documentData.segments.some((segment) => /[\u3400-\u9fff]/.test(segment.translation || ""));
  if (!hasChinese) {
    showToast("当前文档没有中文译文，无需转换。", true);
    return;
  }
  if (mode === "off") {
    showToast("已在「译文中文」中选择「不做转换」，请先选择简体或繁體。", true);
    return;
  }
  const label = mode === "traditional" ? "繁體中文" : "简体中文";
  const hasReviewed = documentData.segments.some((segment) => segment.status === "reviewed");
  if (!window.confirm(
    hasReviewed
      ? `把全部中文译文转换为${label}？\n\n已审校段落也会被改写，之后需要重新确认。是否继续？`
      : `把全部中文译文转换为${label}？此操作在本机完成，不会消耗模型额度。`,
  )) return;
  elements.zhScriptButton.disabled = true;
  try {
    const result = await api(`/api/documents/${documentData.id}/convert-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (state.current?.id === documentData.id) setCurrentDocument(result.document, true);
    showToast(result.changed ? `已转换 ${result.changed} 段中文译文（${label}）。` : "译文已经是目标字形，无需修改。", false);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    elements.zhScriptButton.disabled = false;
  }
}

async function confirmRetranslateAll() {
  if (!state.current) return;
  const documentData = state.current;
  const hasTranslated = documentData.segments.some((segment) => (segment.translation || "").trim());
  const message = hasTranslated
    ? "将重新翻译所有机器译文和空白段落。\n\n已编辑、已审校和已锁定的段落会保留，不会被覆盖。是否继续？"
    : "当前没有需要重译的内容，将翻译全部空白段落。";
  if (hasTranslated && !window.confirm(message)) return;
  await startTranslation(true);
}

async function startTranslation(overwrite) {
  if (!state.current) return;
  const documentId = state.current.id;
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
  state.current.zh_script_mode = elements.zhScriptMode.value;
  elements.translateButton.disabled = true;
  try {
    await api(`/api/documents/${documentId}/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_language: source, target_language: target, overwrite, zh_script_mode: state.current.zh_script_mode }),
    });
    if (state.current?.id === documentId) {
      state.current.status = "translating";
      state.current.source_language = source;
      state.current.target_language = target;
      updateDocumentMeta(state.current);
      schedulePoll();
    }
  } catch (error) {
    if (state.current?.id === documentId) elements.translateButton.disabled = false;
    showToast(error.message, true);
  }
}

// The user's escape hatch for a long run. The backend keeps every finished
// batch, so stopping loses nothing that was already translated.
async function stopTranslation() {
  const documentId = state.current?.id;
  if (!documentId || state.current?.status !== "translating") return;
  const button = elements.stopButton;
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "正在停止…";
  try {
    const result = await api(`/api/documents/${documentId}/cancel`, { method: "POST" });
    if (state.current?.id === documentId && result.document) {
      setCurrentDocument(result.document, true);
    }
    stopPoll();
    await loadDocumentList();
    showToast(result.message || "已停止翻译，已完成的段落会保留。", false);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = oldText;
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

// Errors name what failed and, when there is one, the action that fixes it.
// A toast the user can act on beats a toast that only reports a status code.
const ERROR_ACTIONS = [
  { match: /尚未配置翻译模型|401|403|API Key|鉴权/i, label: "打开模型设置", run: () => openSettings() },
  { match: /系统代理/i, label: "打开模型设置", run: () => openSettings() },
  { match: /超时|timeout|无法连接|连接网关/i, label: "重试翻译", run: () => startTranslation(false) },
];

function showToast(message, isError, duration, action) {
  clearTimeout(state.toastTimer);
  const resolved = action || (isError ? ERROR_ACTIONS.find((entry) => entry.match.test(String(message))) : null);
  elements.toast.replaceChildren();
  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;
  elements.toast.append(text);
  if (resolved) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = resolved.label;
    button.addEventListener("click", () => {
      elements.toast.classList.add("hidden");
      resolved.run();
    });
    elements.toast.append(button);
  }
  elements.toast.classList.toggle("error", Boolean(isError));
  elements.toast.classList.remove("hidden");
  state.toastTimer = setTimeout(() => elements.toast.classList.add("hidden"), duration || (isError ? 8000 : 3500));
}
