(function (global) {
  "use strict";

  function createImagesFeature({ elements }) {
    function switchTool(tool) {
      elements.imageConvertPngSvg.classList.toggle("active", tool === "png-to-svg");
      elements.imageConvertSvgPng.classList.toggle("active", tool === "svg-to-png");
      elements.imagesFrame.src = tool === "svg-to-png"
        ? "/tools/image-convert/svg-to-png.html"
        : "/tools/image-convert/png-to-svg.html";
    }

    return { switchTool };
  }

  global.ImagesFeature = { create: createImagesFeature };
})(window);
