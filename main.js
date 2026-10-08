import { FFmpeg, FFFSType } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

const $ = (id) => document.getElementById(id);
const video = $("video");
let sourceFile,
  sourceURL,
  crop = null,
  fps = 30,
  last = 0,
  start = 0,
  end = 0,
  ready = false,
  animation;
let timelineZoom = 1,
  fpsDetection;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (id, fallback) =>
  Number.isFinite($(id).valueAsNumber) ? $(id).valueAsNumber : fallback;
const frame = () =>
  clamp(Math.floor(video.currentTime * fps + 0.0001), 0, last);
function status(message = "") {
  $("status").textContent = message;
  $("status").hidden = !message;
}
function bounds() {
  return crop || { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
}
function outputName() {
  const name = $("out")
    .value.trim()
    .replace(/[\\/:*?"<>|]/g, "_");
  return `${name || "output1"}.gif`;
}
// equivalent of the ffmpeg command built by gen-gif.js
function ffmpegArgs(input, output) {
  const c = bounds();
  const filter = [
    `select='between(n,${start},${end})'`,
    `crop=${c.w}:${c.h}:${c.x}:${c.y}`,
  ].join(",");
  return [
    "-i",
    input,
    "-filter_complex",
    filter,
    // stop reading the input once the last selected frame is written
    "-frames:v",
    String(end - start + 1),
    "-loop",
    "0",
    output,
  ];
}
function updateConfig() {
  const args = ffmpegArgs(sourceFile?.name ?? "input.mp4", outputName());
  $("command").value =
    "ffmpeg -y " + args.map((a) => (/[\s'"]/.test(a) ? `"${a}"` : a)).join(" ");
}
function drawCrop() {
  const c = bounds();
  for (const key of ["x", "y", "w", "h"]) $(key).value = c[key];
  $("cropBox").hidden = !crop;
  Object.assign($("cropBox").style, {
    left: `${(c.x / video.videoWidth) * 100}%`,
    top: `${(c.y / video.videoHeight) * 100}%`,
    width: `${(c.w / video.videoWidth) * 100}%`,
    height: `${(c.h / video.videoHeight) * 100}%`,
  });
  updateConfig();
}
for (const [x, y] of [
  [0, 0],
  [50, 0],
  [100, 0],
  [0, 50],
  [100, 50],
  [0, 100],
  [50, 100],
  [100, 100],
]) {
  const h = document.createElement("span");
  h.className = "handle";
  h.style.left = x + "%";
  h.style.top = y + "%";
  $("cropBox").append(h);
}
function fit() {
  if (!ready) return;
  const p = $("preview"),
    css = getComputedStyle(p);
  const width =
    p.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const height =
    p.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
  const scale = Math.min(width / video.videoWidth, height / video.videoHeight);
  $("stage").style.width = `${video.videoWidth * scale}px`;
  $("stage").style.height = `${video.videoHeight * scale}px`;
  drawTicks();
}
function layoutTimeline() {
  if (!ready) return;
  const viewport = $("timelineViewport"),
    oldWidth = $("timeline").clientWidth;
  const position = oldWidth ? viewport.scrollLeft / oldWidth : 0;
  $("timeline").style.width =
    `${Math.max(1, viewport.clientWidth - 24) * timelineZoom}px`;
  viewport.scrollLeft = position * $("timeline").clientWidth;
  drawTicks();
}
function zoomTimeline(factor, clientX, reset = false) {
  const viewport = $("timelineViewport"),
    r = viewport.getBoundingClientRect();
  const anchor =
    clamp(clientX ?? r.left + r.width / 2, r.left, r.right) - r.left;
  const oldWidth = $("timeline").clientWidth;
  const position = (viewport.scrollLeft + anchor - 12) / oldWidth;
  timelineZoom = reset
    ? 1
    : clamp(
        timelineZoom * factor,
        1,
        Math.max(
          1,
          Math.min(
            512,
            ((last + 1) * 12) / Math.max(1, viewport.clientWidth - 24),
          ),
        ),
      );
  $("timeline").style.width =
    `${Math.max(1, viewport.clientWidth - 24) * timelineZoom}px`;
  viewport.scrollLeft = position * $("timeline").clientWidth - anchor + 12;
  drawTicks();
}
function drawTicks() {
  const canvas = $("ticks"),
    viewport = $("timelineViewport"),
    totalWidth = $("timeline").clientWidth;
  const offset = Math.max(0, viewport.scrollLeft - 12),
    width = Math.min(viewport.clientWidth, totalWidth - offset),
    dpr = window.devicePixelRatio || 1;
  canvas.style.left = `${offset}px`;
  canvas.style.width = `${width}px`;
  canvas.width = width * dpr;
  canvas.height = 82 * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.font = "11px system-ui";
  ctx.fillStyle = "#a7b3c9";
  ctx.strokeStyle = "#657089";
  const count = last + 1,
    desired = (100 / totalWidth) * count,
    magnitude = 10 ** Math.floor(Math.log10(Math.max(1, desired)));
  const step = Math.max(
    1,
    [1, 2, 5, 10].find((n) => n * magnitude >= desired) * magnitude,
  );
  const first = Math.ceil(((offset / totalWidth) * count) / step) * step;
  for (
    let f = first;
    f <= Math.min(count, ((offset + width) / totalWidth) * count);
    f += step
  ) {
    const x = (f / count) * totalWidth - offset;
    ctx.textAlign = x < 30 ? "left" : x > width - 30 ? "right" : "center";
    ctx.fillText(`${(f / fps).toFixed(2)}s`, x, 12);
    ctx.beginPath();
    ctx.moveTo(x, 18);
    ctx.lineTo(x, 23);
    ctx.stroke();
  }
}
function drawRange() {
  const count = last + 1;
  $("startFrame").value = start;
  $("endFrame").value = end;
  $("range").style.left = `${(start / count) * 100}%`;
  $("range").style.width = `${((end - start + 1) / count) * 100}%`;
  for (const [id, value, min, max] of [
    ["trimStart", start, 0, end],
    ["trimEnd", end, start, last],
  ]) {
    $(id).setAttribute("aria-valuenow", value);
    $(id).setAttribute("aria-valuemin", min);
    $(id).setAttribute("aria-valuemax", max);
  }
  updateConfig();
}
function drawTime() {
  $("currentFrame").value = frame();
  $("playhead").style.left =
    `${clamp((video.currentTime * fps) / (last + 1), 0, 1) * 100}%`;
  $("time").textContent =
    `${video.currentTime.toFixed(3)} / ${video.duration.toFixed(3)} s`;
}
function seek(f) {
  video.pause();
  video.currentTime = Math.min(
    video.duration,
    (clamp(Math.round(f), 0, last) + 0.01) / fps,
  );
  drawTime();
}
function refreshFrames(previousFPS = fps) {
  const previousLast = last;
  last = Math.max(0, Math.ceil(video.duration * fps - 0.00001) - 1);
  start = clamp(Math.round((start * fps) / previousFPS), 0, last);
  end =
    end === previousLast
      ? last
      : clamp(Math.round(((end + 1) * fps) / previousFPS) - 1, start, last);
  for (const id of ["startFrame", "endFrame", "currentFrame"]) $(id).max = last;
  drawRange();
  drawTime();
  drawTicks();
}
function setFPS(value) {
  const previousFPS = fps;
  fps = clamp(value, 0.001, 1000);
  $("fps").value = fps;
  if (ready) refreshFrames(previousFPS);
}
function detectFPS(url) {
  fpsDetection?.abort();
  const controller = new AbortController();
  fpsDetection = controller;
  const probe = document.createElement("video");
  probe.muted = true;
  probe.playsInline = true;
  probe.preload = "auto";
  probe.playbackRate = 0.25;
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.001;pointer-events:none";
  document.body.append(probe);
  $("fpsStatus").textContent = "FPSを検出中…";
  const samples = [];
  let callback,
    timer,
    finished = false;
  function finish(error) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (callback !== undefined) probe.cancelVideoFrameCallback(callback);
    probe.pause();
    probe.removeAttribute("src");
    probe.load();
    probe.remove();
    if (controller.signal.aborted) return;
    fpsDetection = null;
    if (error || samples.length < 3) {
      $("fpsStatus").textContent =
        "検出できませんでした。FPSを入力してください。";
      return;
    }
    samples.sort((a, b) => a - b);
    const interval = samples[Math.floor(samples.length / 2)];
    let detected = 1 / interval;
    const standard = [
      1,
      5,
      10,
      12,
      15,
      24000 / 1001,
      24,
      25,
      30000 / 1001,
      30,
      48,
      50,
      60000 / 1001,
      60,
      90,
      100,
      120000 / 1001,
      120,
      144,
      240,
    ];
    const nearest = standard.reduce((a, b) =>
      Math.abs(b - detected) < Math.abs(a - detected) ? b : a,
    );
    detected =
      Math.abs(nearest - detected) / detected < 0.0003
        ? nearest
        : Math.round(detected * 1000) / 1000;
    if (!Number.isFinite(detected) || detected < 0.001 || detected > 1000) {
      $("fpsStatus").textContent =
        "検出できませんでした。FPSを入力してください。";
      return;
    }
    setFPS(detected);
    const variable = samples.some(
      (value) => Math.abs(value - interval) / interval > 0.03,
    );
    $("fpsStatus").textContent = variable
      ? "可変FPSの可能性あり（推定値）"
      : "自動検出（推定値）";
  }
  controller.signal.addEventListener("abort", () => finish(), {
    once: true,
  });
  probe.addEventListener("error", () => finish(true), { once: true });
  probe.addEventListener("ended", () => finish(), { once: true });
  timer = setTimeout(() => finish(), 10000);
  probe.addEventListener(
    "loadeddata",
    async () => {
      if (finished) return;
      try {
        if (typeof probe.seekToNextFrame === "function") {
          await probe.seekToNextFrame();
          for (let i = 0; i < 24 && !finished; i++) {
            const previous = probe.currentTime;
            await probe.seekToNextFrame();
            const delta = probe.currentTime - previous;
            if (delta > 0) samples.push(delta);
            else break;
          }
          finish();
        } else if (typeof probe.requestVideoFrameCallback === "function") {
          let previous;
          const sample = (now, meta) => {
            if (finished) return;
            if (previous) {
              const frames = meta.presentedFrames - previous.presentedFrames;
              const delta = meta.mediaTime - previous.mediaTime;
              if (frames > 0 && delta > 0) samples.push(delta / frames);
            }
            previous = meta;
            if (samples.length >= 24) finish();
            else callback = probe.requestVideoFrameCallback(sample);
          };
          callback = probe.requestVideoFrameCallback(sample);
          await probe.play();
        } else finish(true);
      } catch {
        finish(true);
      }
    },
    { once: true },
  );
  probe.src = url;
  probe.load();
}
function load(file) {
  if (!file) return;
  fpsDetection?.abort();
  fpsDetection = null;
  $("fpsStatus").textContent = "";
  video.pause();
  ready = false;
  status();
  $("uploadError").hidden = true;
  if (sourceURL) URL.revokeObjectURL(sourceURL);
  sourceFile = file;
  sourceURL = URL.createObjectURL(file);
  $("fileName").textContent = file.name;
  video.src = sourceURL;
  video.load();
}
video.addEventListener("loadedmetadata", () => {
  if (
    !Number.isFinite(video.duration) ||
    video.duration <= 0 ||
    !video.videoWidth
  ) {
    loadError();
    return;
  }
  ready = true;
  crop = null;
  start = 0;
  last = 0;
  end = 0;
  timelineZoom = 1;
  $("upload").hidden = true;
  $("editor").hidden = false;
  $("dimensions").textContent = `${video.videoWidth} × ${video.videoHeight}`;
  refreshFrames();
  drawCrop();
  layoutTimeline();
  fit();
  detectFPS(sourceURL);
});
function loadError() {
  ready = false;
  video.pause();
  const message =
    "動画を読み込めません。ブラウザで再生できる動画を選択してください。";
  if ($("editor").hidden) {
    $("uploadError").textContent = message;
    $("uploadError").hidden = false;
  } else {
    status(message);
  }
}
video.addEventListener("error", loadError);
$("file").addEventListener("change", (e) => {
  load(e.target.files[0]);
  e.target.value = "";
});
$("replace").onclick = () => $("file").click();
for (const event of ["dragenter", "dragover"])
  $("dropZone").addEventListener(event, (e) => {
    e.preventDefault();
    $("dropZone").classList.add("over");
  });
$("dropZone").addEventListener("dragleave", () =>
  $("dropZone").classList.remove("over"),
);
$("dropZone").addEventListener("drop", (e) => {
  e.preventDefault();
  $("dropZone").classList.remove("over");
  load(e.dataTransfer.files[0]);
});
new ResizeObserver(fit).observe($("preview"));
new ResizeObserver(layoutTimeline).observe($("timelineViewport"));
$("timelineViewport").addEventListener("scroll", () => {
  if (ready) drawTicks();
});
function point(e) {
  const r = $("stage").getBoundingClientRect();
  return {
    x: clamp(
      ((e.clientX - r.left) / r.width) * video.videoWidth,
      0,
      video.videoWidth,
    ),
    y: clamp(
      ((e.clientY - r.top) / r.height) * video.videoHeight,
      0,
      video.videoHeight,
    ),
  };
}
function hit(p) {
  if (!crop) return "new";
  const tolerance = (9 * video.videoWidth) / $("stage").clientWidth,
    c = crop;
  if (
    p.x < c.x - tolerance ||
    p.x > c.x + c.w + tolerance ||
    p.y < c.y - tolerance ||
    p.y > c.y + c.h + tolerance
  )
    return "new";
  let edge = "";
  if (Math.abs(p.y - c.y) <= tolerance) edge += "n";
  else if (Math.abs(p.y - c.y - c.h) <= tolerance) edge += "s";
  if (Math.abs(p.x - c.x) <= tolerance) edge += "w";
  else if (Math.abs(p.x - c.x - c.w) <= tolerance) edge += "e";
  return edge || "move";
}
let cropDrag;
$("overlay").addEventListener("pointerdown", (e) => {
  if (!ready || e.button !== 0 || cropDrag) return;
  e.preventDefault();
  video.pause();
  const p = point(e);
  cropDrag = {
    id: e.pointerId,
    p,
    mode: hit(p),
    original: crop ? { ...crop } : null,
  };
  $("overlay").setPointerCapture(e.pointerId);
});
$("overlay").addEventListener("pointermove", (e) => {
  if (!ready) return;
  const p = point(e);
  if (!cropDrag) {
    const mode = hit(p);
    $("overlay").style.cursor =
      mode === "new"
        ? "crosshair"
        : mode === "move"
          ? "move"
          : `${mode}-resize`;
    return;
  }
  if (e.pointerId !== cropDrag.id) return;
  const { p: a, mode, original: c } = cropDrag,
    W = video.videoWidth,
    H = video.videoHeight;
  if (mode === "move")
    crop = {
      ...c,
      x: clamp(Math.round(c.x + p.x - a.x), 0, W - c.w),
      y: clamp(Math.round(c.y + p.y - a.y), 0, H - c.h),
    };
  else {
    let left, top, right, bottom;
    if (mode === "new") {
      left = Math.min(a.x, p.x);
      right = Math.max(a.x, p.x);
      top = Math.min(a.y, p.y);
      bottom = Math.max(a.y, p.y);
    } else {
      left = c.x;
      right = c.x + c.w;
      top = c.y;
      bottom = c.y + c.h;
      if (mode.includes("w")) left = clamp(c.x + p.x - a.x, 0, right - 1);
      if (mode.includes("e")) right = clamp(c.x + c.w + p.x - a.x, left + 1, W);
      if (mode.includes("n")) top = clamp(c.y + p.y - a.y, 0, bottom - 1);
      if (mode.includes("s")) bottom = clamp(c.y + c.h + p.y - a.y, top + 1, H);
    }
    left = clamp(Math.round(left), 0, W - 1);
    top = clamp(Math.round(top), 0, H - 1);
    crop = {
      x: left,
      y: top,
      w: clamp(Math.round(right) - left, 1, W - left),
      h: clamp(Math.round(bottom) - top, 1, H - top),
    };
  }
  drawCrop();
});
function endCrop(e) {
  if (cropDrag?.id === e.pointerId) cropDrag = null;
}
for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
  $("overlay").addEventListener(event, endCrop);
for (const key of ["x", "y", "w", "h"])
  $(key).addEventListener("change", () => {
    if (!ready) return;
    const c = { ...bounds() },
      value = Math.round(number(key, c[key]));
    if (key === "x") c.x = clamp(value, 0, video.videoWidth - c.w);
    if (key === "y") c.y = clamp(value, 0, video.videoHeight - c.h);
    if (key === "w") c.w = clamp(value, 1, video.videoWidth - c.x);
    if (key === "h") c.h = clamp(value, 1, video.videoHeight - c.y);
    crop = c;
    drawCrop();
  });
$("resetCrop").onclick = () => {
  if (ready) {
    crop = null;
    drawCrop();
  }
};
$("fps").addEventListener("input", () => {
  fpsDetection?.abort();
  fpsDetection = null;
  $("fpsStatus").textContent = "";
});
$("fps").addEventListener("change", () => setFPS(number("fps", fps)));
$("startFrame").addEventListener("change", () => {
  if (ready) {
    start = clamp(Math.round(number("startFrame", start)), 0, end);
    drawRange();
    seek(start);
  }
});
$("endFrame").addEventListener("change", () => {
  if (ready) {
    end = clamp(Math.round(number("endFrame", end)), start, last);
    drawRange();
    seek(end);
  }
});
$("setStart").onclick = () => {
  if (ready) {
    video.pause();
    start = frame();
    end = Math.max(end, start);
    drawRange();
  }
};
$("setEnd").onclick = () => {
  if (ready) {
    video.pause();
    end = frame();
    start = Math.min(start, end);
    drawRange();
  }
};
$("currentFrame").addEventListener("change", () => {
  if (ready) seek(number("currentFrame", frame()));
});
$("out").addEventListener("input", () => {
  if (ready) updateConfig();
});
let ffmpeg,
  ffmpegLoaded,
  exporting = false,
  cancelled = false,
  resultURL,
  logs = [],
  totalFrames = 1;
async function loadFFmpeg() {
  if (ffmpeg) {
    await ffmpegLoaded;
    return ffmpeg;
  }
  const instance = new FFmpeg();
  instance.on("log", ({ message }) => {
    logs.push(message);
    if (logs.length > 30) logs.shift();
    // stats line: "frame=   12 fps=..."
    const match = /frame=\s*(\d+)/.exec(message);
    if (match) {
      const done = Number(match[1]);
      $("progress").value = clamp(done / totalFrames, 0, 1);
      status(`GIFを生成中… ${done} / ${totalFrames} フレーム`);
    }
  });
  ffmpeg = instance;
  ffmpegLoaded = instance.load({ coreURL, wasmURL });
  try {
    await ffmpegLoaded;
  } catch (error) {
    if (ffmpeg === instance) ffmpeg = null;
    throw error;
  }
  return instance;
}
function showResult(blob, name) {
  if (resultURL) URL.revokeObjectURL(resultURL);
  resultURL = URL.createObjectURL(blob);
  $("resultImage").src = resultURL;
  $("download").href = resultURL;
  $("download").download = name;
  $("download").textContent = `${name} をダウンロード`;
  $("resultInfo").textContent =
    blob.size < 1024 * 1024
      ? `${(blob.size / 1024).toFixed(1)} KB`
      : `${(blob.size / 1024 / 1024).toFixed(2)} MB`;
  $("result").hidden = false;
}
function setExporting(value) {
  exporting = value;
  $("export").disabled = value;
  $("cancel").disabled = !value;
  $("progress").hidden = !value;
}
$("export").onclick = async () => {
  if (!ready || exporting) return;
  video.pause();
  const file = sourceFile,
    name = outputName(),
    inputDir = "/input",
    output = "/output.gif";
  totalFrames = end - start + 1;
  logs = [];
  const args = ffmpegArgs(`${inputDir}/${file.name}`, output);
  setExporting(true);
  cancelled = false;
  $("progress").removeAttribute("value"); // indeterminate while loading
  status("FFmpegを読み込み中…");
  let instance,
    mounted = false;
  try {
    instance = await loadFFmpeg();
    status("GIFを生成中…");
    $("progress").value = 0;
    try {
      await instance.createDir(inputDir);
    } catch {
      // already exists
    }
    // WORKERFS reads the File directly instead of copying it into memory
    await instance.mount(FFFSType.WORKERFS, { files: [file] }, inputDir);
    mounted = true;
    const code = await instance.exec(args);
    if (code !== 0)
      throw new Error(`FFmpegがエラー終了しました（code ${code}）`);
    const data = await instance.readFile(output);
    await instance.deleteFile(output);
    showResult(new Blob([data], { type: "image/gif" }), name);
    status();
  } catch (error) {
    if (!cancelled)
      status(`生成に失敗しました: ${error.message}\n\n${logs.join("\n")}`);
  } finally {
    if (mounted && !cancelled) await instance.unmount(inputDir).catch(() => {});
    setExporting(false);
  }
};
$("cancel").onclick = () => {
  if (!exporting) return;
  cancelled = true;
  // terminate() kills the worker; it is reloaded on the next export
  ffmpeg?.terminate();
  ffmpeg = null;
  status("中止しました。");
};
$("prev").onclick = () => {
  if (ready) seek(frame() - 1);
};
$("next").onclick = () => {
  if (ready) seek(frame() + 1);
};
$("play").onclick = async () => {
  if (!ready) return;
  if (video.paused) {
    if (video.ended) video.currentTime = 0;
    try {
      await video.play();
    } catch {
      status("再生できません。別の動画を選択してください。");
    }
  } else video.pause();
};
video.addEventListener("play", () => {
  $("play").textContent = "❚❚";
  $("play").setAttribute("aria-label", "一時停止");
  cancelAnimationFrame(animation);
  const tick = () => {
    drawTime();
    if (!video.paused) animation = requestAnimationFrame(tick);
  };
  tick();
});
video.addEventListener("pause", () => {
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "再生");
  cancelAnimationFrame(animation);
});
video.addEventListener("timeupdate", () => {
  if (ready) drawTime();
});
let timelineDrag;
function timelinePosition(e) {
  const r = $("timeline").getBoundingClientRect();
  return clamp((e.clientX - r.left) / r.width, 0, 1) * (last + 1);
}
$("timeline").addEventListener("pointerdown", (e) => {
  if (!ready || e.button !== 0 || timelineDrag) return;
  e.preventDefault();
  video.pause();
  const mode =
    e.target.id === "trimStart"
      ? "start"
      : e.target.id === "trimEnd"
        ? "end"
        : e.target.id === "range"
          ? "move"
          : "seek";
  timelineDrag = {
    id: e.pointerId,
    mode,
    position: timelinePosition(e),
    start,
    end,
  };
  $("timeline").setPointerCapture(e.pointerId);
  if (mode === "seek") seek(Math.floor(timelinePosition(e)));
});
$("timeline").addEventListener("pointermove", (e) => {
  if (!timelineDrag || e.pointerId !== timelineDrag.id) return;
  const p = timelinePosition(e),
    d = timelineDrag;
  if (d.mode === "seek") seek(Math.floor(p));
  else {
    if (d.mode === "start") {
      start = clamp(Math.round(p), 0, end);
    }
    if (d.mode === "end") {
      end = clamp(Math.round(p) - 1, start, last);
    }
    if (d.mode === "move") {
      const delta = clamp(Math.round(p - d.position), -d.start, last - d.end);
      start = d.start + delta;
      end = d.end + delta;
    }
    drawRange();
  }
});
for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
  $("timeline").addEventListener(event, (e) => {
    if (timelineDrag?.id === e.pointerId) timelineDrag = null;
  });
for (const id of ["trimStart", "trimEnd"])
  $(id).addEventListener("keydown", (e) => {
    if (!ready || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
      return;
    e.preventDefault();
    const current = id === "trimStart" ? start : end,
      value =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? last
            : current +
              (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 10 : 1);
    video.pause();
    if (id === "trimStart") {
      start = clamp(value, 0, end);
    } else {
      end = clamp(value, start, last);
    }
    drawRange();
  });
document.addEventListener(
  "wheel",
  (e) => {
    if (!ready || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (timelineDrag) return;
    const delta =
      e.deltaY *
      (e.deltaMode === 1
        ? 16
        : e.deltaMode === 2
          ? $("timelineViewport").clientWidth
          : 1);
    zoomTimeline(Math.exp(clamp(-delta * 0.003, -1, 1)), e.clientX);
  },
  { passive: false },
);
$("timelineViewport").addEventListener(
  "wheel",
  (e) => {
    if (!ready || e.ctrlKey || e.metaKey || !e.deltaY || e.deltaX) return;
    e.preventDefault();
    $("timelineViewport").scrollLeft +=
      e.deltaY *
      (e.deltaMode === 1
        ? 16
        : e.deltaMode === 2
          ? $("timelineViewport").clientWidth
          : 1);
  },
  { passive: false },
);
document.addEventListener("keydown", (e) => {
  if (!ready) return;
  if ((e.ctrlKey || e.metaKey) && ["+", "=", "-", "0"].includes(e.key)) {
    e.preventDefault();
    if (!timelineDrag)
      zoomTimeline(e.key === "-" ? 1 / 1.25 : 1.25, undefined, e.key === "0");
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) $("play").click();
    return;
  }
  if (
    /INPUT|TEXTAREA|BUTTON/.test(e.target.tagName) ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey
  )
    return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    seek(frame() + (e.key === "ArrowLeft" ? -1 : 1));
  }
});
window.addEventListener("pagehide", () => {
  if (resultURL) URL.revokeObjectURL(resultURL);
  fpsDetection?.abort();
  if (sourceURL) URL.revokeObjectURL(sourceURL);
});
