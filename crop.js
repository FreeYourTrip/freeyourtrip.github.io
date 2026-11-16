/**
 * 本机裁图：圆形（自定义分类图标）和矩形（行程背景预览）共用。
 * 所有处理都在设备上完成，不发到网络。
 * 圈外 50% 黑遮罩；可拖动、双指缩放；顶栏返回取消。
 */
(function (root) {
  "use strict";

  var COPY = {
    circleHint: "拖动、双指缩放，把要的部分放进圈里",
    rectHint: "拖动、双指缩放，把要的部分放进框里",
    retake: "重选",
    use: "用这张"
  };

  function $(id) {
    return document.getElementById(id);
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error("bad-image")); };
      img.src = src;
    });
  }

  /**
   * 打开裁剪层。
   * opts: { src, shape: "circle"|"rect", aspect, onConfirm(result), onCancel(), onRetake() }
   * result: { dataUrl, crop: { scale, x, y, srcW, srcH }, mime }
   */
  function open(opts) {
    opts = opts || {};
    var host = $("crop-sheet");
    if (!host) {
      host = document.createElement("div");
      host.id = "crop-sheet";
      host.className = "crop-sheet";
      host.hidden = true;
      document.body.appendChild(host);
    }
    var shape = opts.shape === "rect" ? "rect" : "circle";
    host.innerHTML =
      '<div class="crop-top">' +
      '<button type="button" class="crop-back" id="crop-back" aria-label="取消">‹</button>' +
      '<p class="crop-hint">' + (shape === "circle" ? COPY.circleHint : COPY.rectHint) + "</p>" +
      "</div>" +
      '<div class="crop-stage" id="crop-stage">' +
      '<canvas class="crop-canvas" id="crop-canvas"></canvas>' +
      '<div class="crop-mask" id="crop-mask" aria-hidden="true"></div>' +
      "</div>" +
      '<div class="crop-actions">' +
      '<button type="button" class="secondary-btn" id="crop-retake">' + COPY.retake + "</button>" +
      '<button type="button" class="primary-btn" id="crop-use">' + COPY.use + "</button>" +
      "</div>";
    host.hidden = false;

    var canvas = $("crop-canvas");
    var stage = $("crop-stage");
    var ctx = canvas.getContext("2d");
    var img = null;
    var scale = 1;
    var minScale = 1;
    var x = 0;
    var y = 0;
    var viewW = 0;
    var viewH = 0;
    var hole = 0;
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    var pointers = {};
    var pinchStart = 0;
    var pinchScale = 1;
    var closed = false;

    function holeRect() {
      var size = hole;
      var left = (viewW - size) / 2;
      var top = (viewH - size) / 2;
      if (shape === "rect" && opts.aspect) {
        var aspect = opts.aspect;
        var w = size;
        var h = w / aspect;
        if (h > viewH * 0.7) {
          h = viewH * 0.7;
          w = h * aspect;
        }
        return { left: (viewW - w) / 2, top: (viewH - h) / 2, w: w, h: h };
      }
      return { left: left, top: top, w: size, h: size };
    }

    function draw() {
      if (!img) return;
      ctx.clearRect(0, 0, viewW, viewH);
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, viewW, viewH);
      ctx.drawImage(img, x, y, img.naturalWidth * scale, img.naturalHeight * scale);
      var r = holeRect();
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.beginPath();
      ctx.rect(0, 0, viewW, viewH);
      if (shape === "circle") {
        ctx.moveTo(r.left + r.w, r.top + r.h / 2);
        ctx.arc(r.left + r.w / 2, r.top + r.h / 2, r.w / 2, 0, Math.PI * 2, true);
      } else {
        ctx.rect(r.left + r.w, r.top, -r.w, r.h);
      }
      ctx.closePath();
      ctx.fill("evenodd");
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      if (shape === "circle") {
        ctx.beginPath();
        ctx.arc(r.left + r.w / 2, r.top + r.h / 2, r.w / 2, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(r.left, r.top, r.w, r.h);
      }
    }

    function layout() {
      viewW = stage.clientWidth || window.innerWidth;
      viewH = stage.clientHeight || Math.round(window.innerHeight * 0.7);
      canvas.width = viewW;
      canvas.height = viewH;
      hole = Math.min(viewW, viewH) * 0.72;
      if (img) {
        minScale = Math.max(hole / img.naturalWidth, hole / img.naturalHeight);
        if (scale < minScale) scale = minScale;
        constrain();
      }
      draw();
    }

    function constrain() {
      if (!img) return;
      var r = holeRect();
      var dw = img.naturalWidth * scale;
      var dh = img.naturalHeight * scale;
      x = clamp(x, r.left + r.w - dw, r.left);
      y = clamp(y, r.top + r.h - dh, r.top);
    }

    function close() {
      if (closed) return;
      closed = true;
      host.hidden = true;
      host.innerHTML = "";
    }

    function exportCrop() {
      var r = holeRect();
      var out = document.createElement("canvas");
      var size = Math.round(Math.max(r.w, r.h));
      out.width = size;
      out.height = shape === "circle" ? size : Math.round(size * (r.h / r.w));
      var octx = out.getContext("2d");
      if (shape === "circle") {
        octx.beginPath();
        octx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        octx.closePath();
        octx.clip();
      }
      var sx = (r.left - x) / scale;
      var sy = (r.top - y) / scale;
      var sw = r.w / scale;
      var sh = r.h / scale;
      octx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
      var dataUrl = out.toDataURL("image/jpeg", 0.9);
      return {
        dataUrl: dataUrl,
        mime: "image/jpeg",
        crop: {
          scale: scale,
          x: x,
          y: y,
          srcW: img.naturalWidth,
          srcH: img.naturalHeight,
          hole: r
        }
      };
    }

    function onPointerDown(ev) {
      ev.preventDefault();
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        pinchScale = scale;
      } else {
        dragging = true;
        lastX = ev.clientX;
        lastY = ev.clientY;
      }
      try { ev.target.setPointerCapture(ev.pointerId); } catch (err) {}
    }
    function onPointerMove(ev) {
      if (!pointers[ev.pointerId]) return;
      pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(pointers);
      if (ids.length >= 2) {
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart) {
          var midX = (a.x + b.x) / 2;
          var midY = (a.y + b.y) / 2;
          var ns = clamp(pinchScale * (dist / pinchStart), minScale, minScale * 8);
          var cx = midX;
          var cy = midY;
          var k = ns / scale;
          x = cx - (cx - x) * k;
          y = cy - (cy - y) * k;
          scale = ns;
          constrain();
          draw();
        }
        return;
      }
      if (!dragging) return;
      x += ev.clientX - lastX;
      y += ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      constrain();
      draw();
    }
    function onPointerUp(ev) {
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinchStart = 0;
      if (!Object.keys(pointers).length) dragging = false;
    }

    $("crop-back").addEventListener("click", function () {
      close();
      if (opts.onCancel) opts.onCancel();
    });
    $("crop-retake").addEventListener("click", function () {
      close();
      if (opts.onRetake) opts.onRetake();
    });
    $("crop-use").addEventListener("click", function () {
      var result = exportCrop();
      close();
      if (opts.onConfirm) opts.onConfirm(result);
    });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      var ns = clamp(scale * (ev.deltaY > 0 ? 0.92 : 1.08), minScale, minScale * 8);
      var k = ns / scale;
      x = ev.offsetX - (ev.offsetX - x) * k;
      y = ev.offsetY - (ev.offsetY - y) * k;
      scale = ns;
      constrain();
      draw();
    }, { passive: false });

    loadImage(opts.src).then(function (image) {
      img = image;
      layout();
      minScale = Math.max(hole / img.naturalWidth, hole / img.naturalHeight);
      scale = minScale;
      var r = holeRect();
      x = r.left + r.w / 2 - (img.naturalWidth * scale) / 2;
      y = r.top + r.h / 2 - (img.naturalHeight * scale) / 2;
      constrain();
      draw();
    }, function () {
      close();
      if (opts.onCancel) opts.onCancel();
    });
    window.addEventListener("resize", layout);
    return { close: close };
  }

  var api = { open: open, COPY: COPY, loadImage: loadImage };
  root.Cropper = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
