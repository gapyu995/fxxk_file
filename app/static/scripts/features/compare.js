(function (global) {
  "use strict";

  function createCompareFeature({ state, elements, api, showToast, applyFunctionTheme }) {
    state.compareZoom = 1;
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
      applyFunctionTheme("compare");
      elements.reviewWorkspace.classList.add("hidden");
      elements.compareWorkspace.classList.remove("hidden");
      elements.compareLeftTitle.textContent = pair[0].name;
      elements.compareRightTitle.textContent = pair[1].name;
      elements.compareStatus.textContent = "正在载入…";
      setCompareProgress(0, `正在准备 ${pair.length} 份文件…`);
      try {
        for (let i = 0; i < pair.length; i++) {
          setCompareProgress(Math.round(i / pair.length * 100), `正在读取第 ${i + 1}/${pair.length} 份文件…`);
          await renderCompareFile(pair[i], i === 0 ? elements.compareLeft : elements.compareRight);
          setCompareProgress(Math.round((i + 1) / pair.length * 100), `已读取第 ${i + 1}/${pair.length} 份文件`);
        }
        elements.compareStatus.textContent = "已载入，可同步滚动对比";
        setTimeout(() => elements.compareUploadProgress.classList.add("hidden"), 500);
        bindCompareScroll();
        bindCompareCanvasInteractions();
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
        return;
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


    return {
      start: startFileCompare,
      runFiles: runFileCompare,
      setZoom: setCompareZoom,
    };
  }

  global.CompareFeature = { create: createCompareFeature };
})(window);
