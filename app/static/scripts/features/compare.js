(function (global) {
  "use strict";

  function createCompareFeature({ state, elements, api, showToast, applyFunctionTheme, diffOptions }) {
    state.compareZoom = 1;
    state.compareDiffDocuments = [];

    function diffEnabled() {
      return Boolean(diffOptions?.().enabled);
    }

    async function startFileCompare() {
      const files=[...elements.compareFilesInput.files].slice(0, 2);
      if(!files[0]||!files[1]) return;
      await runFileCompare(files);
    }

    async function runFileCompare(files) {
      const pair = files.slice(0, 2);
      if (!pair[0] || !pair[1]) { showToast("请一次提供两份文件进行对比。", true); return; }
      const imageA = pair[0].type.startsWith("image/");
      const imageB = pair[1].type.startsWith("image/");
      if (imageA !== imageB) { showToast("双文件对比只支持文档与文档，或图片与图片，不能混合选择。", true); return; }
      if (!imageA && pair.some((file) => !/\.(doc|docx|pdf)$/i.test(file.name))) {
        showToast("双文件对比的文档仅支持 DOC、DOCX 或 PDF。", true);
        return;
      }
      if (elements.compareDialog.open) elements.compareDialog.close();
      elements.functionSelect.value = "compare";
      elements.functionSelect.dispatchEvent(new Event("change"));
      elements.compareLeftTitle.textContent = pair[0].name;
      elements.compareRightTitle.textContent = pair[1].name;
      elements.compareStatus.textContent = "正在载入…";
      setCompareProgress(0, `正在准备 ${pair.length} 份文件…`);
      state.compareDiffDocuments = [];
      hideCompareDiff();
      try {
        for (let i = 0; i < pair.length; i++) {
          setCompareProgress(Math.round(i / pair.length * 100), `正在读取第 ${i + 1}/${pair.length} 份文件…`);
          const documentData = await renderCompareFile(pair[i], i === 0 ? elements.compareLeft : elements.compareRight);
          state.compareDiffDocuments[i] = documentData || null;
          setCompareProgress(Math.round((i + 1) / pair.length * 100), `已读取第 ${i + 1}/${pair.length} 份文件`);
        }
        elements.compareStatus.textContent = "已载入，可同步滚动对比";
        setTimeout(() => elements.compareUploadProgress.classList.add("hidden"), 500);
        bindCompareScroll();
        bindCompareCanvasInteractions();
        if (diffEnabled()) await renderCompareDiff();
      } catch (error) {
        elements.compareStatus.textContent = "载入失败";
        elements.compareUploadProgress.classList.add("hidden");
        showToast(`对比文件载入失败：${error.message}`, true);
      }
    }
    function setCompareProgress(percent, status) {
      elements.compareUploadProgress.classList.remove("hidden");
      elements.compareUploadBar.style.width = `${percent}%`;
      elements.compareUploadPercent.textContent = `${percent}%`;
      elements.compareUploadStatus.textContent = status;
    }

    async function renderCompareFile(file, target) {
      target.replaceChildren();
      target.dataset.kind = "";
      if (file.type.startsWith("image/")) {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        img.className = "compare-image";
        target.append(img);
        target.dataset.kind = "image";
        return null;
      }
      const form = new FormData();
      form.append("file", file);
      form.append("source_language", "auto");
      form.append("target_language", "auto");
      const doc = await api("/api/documents", { method: "POST", body: form });
      const frame = document.createElement("iframe");
      frame.src = `/api/documents/${doc.id}/preview`;
      frame.className = "compare-frame";
      target.append(frame);
      target.dataset.kind = "document";
      return doc;
    }

    function setCompareZoom(value) {
      state.compareZoom = Math.max(0.5, Math.min(3, Math.round(value * 10) / 10));
      elements.compareZoomValue.textContent = `${Math.round(state.compareZoom * 100)}%`;
      document.querySelectorAll(".compare-image,.compare-frame").forEach((element) => {
        element.style.zoom = state.compareZoom;
      });
    }
    function bindCompareScroll(){
      const a=elements.compareLeft,b=elements.compareRight; let syncing=false;
      [a,b].forEach(src=>src.onscroll=()=>{
        if(!elements.compareSync.checked || syncing)return;
        const dst=src===a?b:a; syncing=true;
        const maxX=Math.max(0,src.scrollWidth-src.clientWidth), maxY=Math.max(0,src.scrollHeight-src.clientHeight);
        const dstMaxX=Math.max(0,dst.scrollWidth-dst.clientWidth), dstMaxY=Math.max(0,dst.scrollHeight-dst.clientHeight);
        dst.scrollLeft=(maxX?src.scrollLeft/maxX:0)*dstMaxX;
        dst.scrollTop=(maxY?src.scrollTop/maxY:0)*dstMaxY;
        requestAnimationFrame(()=>{syncing=false;});
      });
    }

    function bindCompareCanvasInteractions() {
      [elements.compareLeft, elements.compareRight].forEach((canvas) => {
        let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
        canvas.addEventListener("contextmenu", (event) => event.preventDefault());
        canvas.addEventListener("mousedown", (event) => {
          if (event.button !== 2 || canvas.dataset.kind !== "image") return;
          dragging = true; startX = event.clientX; startY = event.clientY;
          startLeft = canvas.scrollLeft; startTop = canvas.scrollTop;
          canvas.classList.add("panning"); event.preventDefault();
        });
        window.addEventListener("mousemove", (event) => {
          if (!dragging) return;
          canvas.scrollLeft = startLeft - (event.clientX - startX);
          canvas.scrollTop = startTop - (event.clientY - startY);
        });
        window.addEventListener("mouseup", () => { dragging = false; canvas.classList.remove("panning"); });
        canvas.addEventListener("wheel", (event) => {
          if (canvas.dataset.kind !== "image") return;
          event.preventDefault();
          setCompareZoom(state.compareZoom + (event.deltaY < 0 ? 0.1 : -0.1));
        }, { passive: false });
      });
    }

    // --- Text diff panel (jsdiff / kpdecker/jsdiff) -------------------------
    // Uploads happen through /api/documents so both sides reuse the same
    // server-side extraction (DOCX paragraphs, PDF layout text) that feeds
    // translation. The diff itself runs entirely in the browser.

    function hideCompareDiff() {
      elements.compareDiffPanel?.classList.add("hidden");
      if (elements.compareDiffSummary) elements.compareDiffSummary.textContent = "";
      elements.compareDiffBody?.replaceChildren();
    }

    async function refreshDiff() {
      if (!diffEnabled()) { hideCompareDiff(); return; }
      await renderCompareDiff();
    }

    async function renderCompareDiff() {
      const [left, right] = state.compareDiffDocuments || [];
      if (!left || !right || !elements.compareDiffPanel) return;
      const [leftDocument, rightDocument] = await Promise.all([
        api(`/api/documents/${left.id}`),
        api(`/api/documents/${right.id}`),
      ]);
      const leftLines = extractDiffLines(leftDocument);
      const rightLines = extractDiffLines(rightDocument);
      if (!leftLines.length && !rightLines.length) {
        showToast("两份文件都没有可比较的文本。", true);
        return;
      }
      const differences = global.Diff.diffLines(leftLines.join("\n"), rightLines.join("\n"));
      const parts = [];
      let added = 0;
      let removed = 0;
      for (const change of differences) {
        const text = change.added || change.removed
          ? String(change.value || "").replace(/\n+$/, "")
          : String(change.value || "").replace(/\n$/, "");
        if (!text) continue;
        const kind = change.added ? "added" : change.removed ? "removed" : "equal";
        if (change.added) added += text.split("\n").length;
        if (change.removed) removed += text.split("\n").length;
        parts.push(renderDiffBlock(text, kind));
      }
      elements.compareDiffBody.replaceChildren(...parts);
      elements.compareDiffPanel.classList.remove("hidden");
      elements.compareDiffSummary.textContent = added || removed
        ? `新增 ${added} 行 · 删除 ${removed} 行 · 共 ${leftLines.length} / ${rightLines.length} 行`
        : `两份文件的抽取文本完全一致（各 ${leftLines.length} 行）`;
    }

    function extractDiffLines(documentData) {
      return (documentData.segments || [])
        .map((segment) => (segment.source || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
    }

    function renderDiffBlock(text, kind) {
      const block = document.createElement("div");
      block.className = `compare-diff-block ${kind}`;
      const marker = document.createElement("span");
      marker.className = "compare-diff-marker";
      marker.textContent = kind === "added" ? "+" : kind === "removed" ? "−" : " ";
      const body = document.createElement("pre");
      body.className = "compare-diff-text";
      body.textContent = text;
      block.append(marker, body);
      return block;
    }

    return {
      start: startFileCompare,
      runFiles: runFileCompare,
      setZoom: setCompareZoom,
      refreshDiff,
    };
  }

  global.CompareFeature = { create: createCompareFeature };
})(window);
