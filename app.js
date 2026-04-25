"use strict";

const audioCtor = window.AudioContext || window.webkitAudioContext;

const els = {
  fileInput: document.querySelector("#fileInput"),
  waveform: document.querySelector("#waveform"),
  playOriginal: document.querySelector("#playOriginal"),
  playProcessed: document.querySelector("#playProcessed"),
  stopPlayback: document.querySelector("#stopPlayback"),
  fileName: document.querySelector("#fileName"),
  durationText: document.querySelector("#durationText"),
  clipStart: document.querySelector("#clipStart"),
  clipLength: document.querySelector("#clipLength"),
  clipStartOut: document.querySelector("#clipStartOut"),
  clipLengthOut: document.querySelector("#clipLengthOut"),
  monoToggle: document.querySelector("#monoToggle"),
  smartAudioToggle: document.querySelector("#smartAudioToggle"),
  highPassHz: document.querySelector("#highPassHz"),
  bassMixDb: document.querySelector("#bassMixDb"),
  presenceDb: document.querySelector("#presenceDb"),
  targetLufs: document.querySelector("#targetLufs"),
  ceilingDb: document.querySelector("#ceilingDb"),
  highPassHzOut: document.querySelector("#highPassHzOut"),
  bassMixDbOut: document.querySelector("#bassMixDbOut"),
  presenceDbOut: document.querySelector("#presenceDbOut"),
  targetLufsOut: document.querySelector("#targetLufsOut"),
  ceilingDbOut: document.querySelector("#ceilingDbOut"),
  processButton: document.querySelector("#processButton"),
  originalStats: document.querySelector("#originalStats"),
  processedStats: document.querySelector("#processedStats"),
  downloadWav: document.querySelector("#downloadWav"),
  downloadMp3: document.querySelector("#downloadMp3"),
  presetButtons: Array.from(document.querySelectorAll("[data-preset]")),
};

const presets = {
  balanced: {
    highPassHz: 130,
    bassMixDb: -12,
    presenceDb: 2,
    targetLufs: -14,
    ceilingDb: -1.2,
    mono: false,
    smart: true,
    stereoWidth: 0.55,
    mudCutDb: -2.5,
    compressorThreshold: -23,
    compressorRatio: 2.8,
    bassDrive: 2.8,
  },
  tiny: {
    highPassHz: 160,
    bassMixDb: -9,
    presenceDb: 2.7,
    targetLufs: -13,
    ceilingDb: -1.5,
    mono: true,
    smart: true,
    stereoWidth: 0,
    mudCutDb: -3.8,
    compressorThreshold: -26,
    compressorRatio: 3.4,
    bassDrive: 3.4,
  },
  bass: {
    highPassHz: 140,
    bassMixDb: -7.5,
    presenceDb: 1.5,
    targetLufs: -14,
    ceilingDb: -1.3,
    mono: false,
    smart: true,
    stereoWidth: 0.35,
    mudCutDb: -3.2,
    compressorThreshold: -25,
    compressorRatio: 3.2,
    bassDrive: 4,
  },
  voice: {
    highPassHz: 110,
    bassMixDb: -18,
    presenceDb: 3.4,
    targetLufs: -15,
    ceilingDb: -1.2,
    mono: true,
    smart: true,
    stereoWidth: 0,
    mudCutDb: -2,
    compressorThreshold: -24,
    compressorRatio: 3,
    bassDrive: 2,
  },
};

const state = {
  audioContext: null,
  originalBuffer: null,
  processedBuffer: null,
  currentSource: null,
  downloadUrls: {
    wav: null,
    mp3: null,
  },
  playbackFrame: null,
  playbackStartedAt: 0,
  playbackBuffer: null,
  selectionDrag: null,
  fileName: "",
  activePreset: "balanced",
};

function getAudioContext() {
  if (!audioCtor) throw new Error("This browser does not support Web Audio.");
  state.audioContext ||= new audioCtor();
  return state.audioContext;
}

function secondsToClock(seconds) {
  const safe = Math.max(0, seconds || 0);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60).toString().padStart(2, "0");
  return `${minutes}:${wholeSeconds}`;
}

function dbToGain(db) {
  return 10 ** (db / 20);
}

function gainToDb(gain) {
  return 20 * Math.log10(Math.max(gain, 1e-9));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function unlerp(value, min, max) {
  return clamp((value - min) / (max - min), 0, 1);
}

function getSupportedMp3Mime() {
  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return [
    "audio/mpeg",
    "audio/mp3",
    "audio/mpeg;codecs=mp3",
  ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) || "";
}

function updateMp3Availability() {
  const hasProcessedAudio = Boolean(state.processedBuffer);
  const mp3Mime = getSupportedMp3Mime();
  const canExport = hasProcessedAudio && Boolean(mp3Mime);
  els.downloadMp3.disabled = !canExport;
  els.downloadMp3.classList.toggle("disabled", !canExport);
  els.downloadMp3.title = mp3Mime
    ? "Record MP3 from the processed clip"
    : "This browser does not expose native MP3 recording. Use WAV or add a JS MP3 encoder library.";
}

function getSettings() {
  const preset = presets[state.activePreset];
  return {
    ...preset,
    highPassHz: Number(els.highPassHz.value),
    bassMixDb: Number(els.bassMixDb.value),
    presenceDb: Number(els.presenceDb.value),
    targetLufs: Number(els.targetLufs.value),
    ceilingDb: Number(els.ceilingDb.value),
    mono: els.monoToggle.checked,
    smart: els.smartAudioToggle.checked,
  };
}

function applyPreset(name) {
  const preset = presets[name];
  state.activePreset = name;
  els.highPassHz.value = preset.highPassHz;
  els.bassMixDb.value = preset.bassMixDb;
  els.presenceDb.value = preset.presenceDb;
  els.targetLufs.value = preset.targetLufs;
  els.ceilingDb.value = preset.ceilingDb;
  els.monoToggle.checked = preset.mono;
  els.smartAudioToggle.checked = preset.smart;
  els.presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === name);
  });
  updateControlOutputs();
  invalidateProcessedRender();
}

function updateControlOutputs() {
  els.highPassHzOut.value = `${Math.round(Number(els.highPassHz.value))} Hz`;
  els.bassMixDbOut.value = `${Number(els.bassMixDb.value).toFixed(1).replace(".0", "")} dB`;
  els.presenceDbOut.value = `${Number(els.presenceDb.value).toFixed(1)} dB`;
  els.targetLufsOut.value = `${Number(els.targetLufs.value).toFixed(1).replace(".0", "")} LUFS`;
  els.ceilingDbOut.value = `${Number(els.ceilingDb.value).toFixed(1)} dB`;
  els.clipStartOut.value = secondsToClock(Number(els.clipStart.value));
  els.clipLengthOut.value = secondsToClock(Number(els.clipLength.value));
}

function createEmptyStats() {
  return { peakDb: -Infinity, loudness: -Infinity, rmsDb: -Infinity };
}

function analyzeChannels(channels) {
  if (!channels.length || !channels[0].length) return createEmptyStats();
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i += 1) {
      const sample = channel[i];
      const abs = Math.abs(sample);
      if (abs > peak) peak = abs;
      sum += sample * sample;
      count += 1;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, count));
  return {
    peakDb: gainToDb(peak),
    rmsDb: gainToDb(rms),
    loudness: gainToDb(rms) - 0.7,
  };
}

function formatStats(stats) {
  if (!Number.isFinite(stats.peakDb)) return "Peak -- / Loudness --";
  return `Peak ${stats.peakDb.toFixed(1)} dB / Loudness ${stats.loudness.toFixed(1)} LUFS-ish`;
}

function bufferToChannels(buffer, startSecond = 0, lengthSecond = buffer.duration) {
  const startFrame = Math.floor(startSecond * buffer.sampleRate);
  const frameCount = Math.max(1, Math.min(buffer.length - startFrame, Math.floor(lengthSecond * buffer.sampleRate)));
  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const sourceLeft = buffer.getChannelData(0);
  const sourceRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : sourceLeft;
  left.set(sourceLeft.subarray(startFrame, startFrame + frameCount));
  right.set(sourceRight.subarray(startFrame, startFrame + frameCount));
  return [left, right];
}

function channelsToAudioBuffer(ctx, channels, sampleRate) {
  const buffer = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  return buffer;
}

function makeBiquad(type, sampleRate, freq, q = 0.707, gainDb = 0) {
  const omega = (2 * Math.PI * freq) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const a = 10 ** (gainDb / 40);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;

  if (type === "highpass") {
    b0 = (1 + cos) / 2;
    b1 = -(1 + cos);
    b2 = (1 + cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === "lowpass") {
    b0 = (1 - cos) / 2;
    b1 = 1 - cos;
    b2 = (1 - cos) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
  } else if (type === "peaking") {
    b0 = 1 + alpha * a;
    b1 = -2 * cos;
    b2 = 1 - alpha * a;
    a0 = 1 + alpha / a;
    a1 = -2 * cos;
    a2 = 1 - alpha / a;
  } else {
    throw new Error(`Unsupported biquad type: ${type}`);
  }

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
    process(sample) {
      const output = this.b0 * sample + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = sample;
      this.y2 = this.y1;
      this.y1 = output;
      return output;
    },
  };
}

function applyFilter(channel, filter) {
  const out = new Float32Array(channel.length);
  for (let i = 0; i < channel.length; i += 1) out[i] = filter.process(channel[i]);
  return out;
}

function softClip(sample, drive) {
  return Math.tanh(sample * drive) / Math.tanh(drive);
}

function buildVirtualBass(left, right, sampleRate, settings) {
  const length = left.length;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) mono[i] = (left[i] + right[i]) * 0.5;

  let bass = applyFilter(mono, makeBiquad("highpass", sampleRate, 55, 0.707));
  bass = applyFilter(bass, makeBiquad("lowpass", sampleRate, 185, 0.707));

  const harmonic = new Float32Array(length);
  let dcBlock = 0;
  let previousRectified = 0;
  for (let i = 0; i < length; i += 1) {
    const rectified = Math.abs(softClip(bass[i], settings.bassDrive));
    dcBlock = rectified - previousRectified + 0.995 * dcBlock;
    previousRectified = rectified;
    harmonic[i] = dcBlock;
  }

  let shaped = applyFilter(harmonic, makeBiquad("highpass", sampleRate, 145, 0.707));
  shaped = applyFilter(shaped, makeBiquad("lowpass", sampleRate, 560, 0.707));
  return shaped;
}

function applyTone(channel, sampleRate, settings) {
  let out = applyFilter(channel, makeBiquad("highpass", sampleRate, settings.highPassHz, 0.707));
  out = applyFilter(out, makeBiquad("peaking", sampleRate, 285, 0.9, settings.mudCutDb));
  out = applyFilter(out, makeBiquad("peaking", sampleRate, 2600, 1.05, settings.presenceDb));
  return out;
}

function applyWidth(left, right, width, monoOutput) {
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  const safeWidth = monoOutput ? 0 : clamp(width, 0, 1);
  for (let i = 0; i < left.length; i += 1) {
    const mid = (left[i] + right[i]) * 0.5;
    const side = (left[i] - right[i]) * 0.5 * safeWidth;
    outL[i] = mid + side;
    outR[i] = mid - side;
  }
  return [outL, outR];
}

function compressChannels(left, right, sampleRate, settings) {
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  const threshold = dbToGain(settings.compressorThreshold);
  const ratio = settings.compressorRatio;
  const attackCoef = Math.exp(-1 / (sampleRate * 0.006));
  const releaseCoef = Math.exp(-1 / (sampleRate * 0.12));
  let envelope = 0;

  for (let i = 0; i < left.length; i += 1) {
    const detector = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    const coef = detector > envelope ? attackCoef : releaseCoef;
    envelope = coef * envelope + (1 - coef) * detector;

    let gain = 1;
    if (envelope > threshold) {
      const overDb = gainToDb(envelope / threshold);
      const reductionDb = overDb - overDb / ratio;
      gain = dbToGain(-reductionDb);
    }

    outL[i] = left[i] * gain;
    outR[i] = right[i] * gain;
  }

  return [outL, outR];
}

function normalizeToTarget(left, right, targetLufs, ceilingDb) {
  const stats = analyzeChannels([left, right]);
  const desiredGain = dbToGain(targetLufs - stats.loudness);
  const peakLimitGain = dbToGain(ceilingDb - stats.peakDb);
  const gain = Math.min(desiredGain, peakLimitGain);
  for (let i = 0; i < left.length; i += 1) {
    left[i] *= gain;
    right[i] *= gain;
  }
}

function limitChannels(left, right, ceilingDb) {
  const ceiling = dbToGain(ceilingDb);
  for (let i = 0; i < left.length; i += 1) {
    if (Math.abs(left[i]) > ceiling) left[i] = Math.sign(left[i]) * ceiling;
    if (Math.abs(right[i]) > ceiling) right[i] = Math.sign(right[i]) * ceiling;
  }
}

function buildPhoneRemixCore(inputChannels, sampleRate, settings) {
  let [left, right] = applyWidth(inputChannels[0], inputChannels[1], settings.stereoWidth, settings.mono);
  const virtualBass = buildVirtualBass(left, right, sampleRate, settings);
  left = applyTone(left, sampleRate, settings);
  right = applyTone(right, sampleRate, settings);

  const bassGain = dbToGain(settings.bassMixDb);
  for (let i = 0; i < left.length; i += 1) {
    const bass = virtualBass[i] * bassGain;
    left[i] += bass;
    right[i] += bass;
  }

  [left, right] = compressChannels(left, right, sampleRate, settings);
  return [left, right];
}

function createSmartRemixEnvelope(inputChannels, sampleRate) {
  const [left, right] = inputChannels;
  const length = left.length;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) mono[i] = (left[i] + right[i]) * 0.5;

  let low = applyFilter(mono, makeBiquad("highpass", sampleRate, 45, 0.707));
  low = applyFilter(low, makeBiquad("lowpass", sampleRate, 190, 0.707));

  let mud = applyFilter(mono, makeBiquad("highpass", sampleRate, 180, 0.707));
  mud = applyFilter(mud, makeBiquad("lowpass", sampleRate, 430, 0.707));

  const frameSize = 2048;
  const hopSize = 512;
  const rawEnvelope = new Float32Array(length);

  for (let frameStart = 0; frameStart < length; frameStart += hopSize) {
    const frameEnd = Math.min(length, frameStart + frameSize);
    let fullPower = 0;
    let lowPower = 0;
    let mudPower = 0;
    let peak = 0;

    for (let i = frameStart; i < frameEnd; i += 1) {
      const full = mono[i];
      const abs = Math.abs(full);
      if (abs > peak) peak = abs;
      fullPower += full * full;
      lowPower += low[i] * low[i];
      mudPower += mud[i] * mud[i];
    }

    const frameLength = Math.max(1, frameEnd - frameStart);
    const fullRms = Math.sqrt(fullPower / frameLength);
    const lowRms = Math.sqrt(lowPower / frameLength);
    const mudRms = Math.sqrt(mudPower / frameLength);
    const lowRatio = lowRms / Math.max(fullRms, 1e-6);
    const mudRatio = mudRms / Math.max(fullRms, 1e-6);

    const lowDominance = unlerp(lowRatio, 0.32, 0.68);
    const lowPressure = unlerp(gainToDb(lowRms), -29, -13);
    const mudPressure = unlerp(mudRatio, 0.22, 0.48) * 0.65;
    const peakPressure = unlerp(peak, 0.72, 0.98) * 0.55;
    const score = clamp(Math.max(lowDominance, lowPressure, mudPressure, peakPressure), 0, 1);

    for (let i = frameStart; i < Math.min(length, frameStart + hopSize); i += 1) {
      rawEnvelope[i] = score;
    }
  }

  const envelope = new Float32Array(length);
  const attack = Math.exp(-1 / (sampleRate * 0.018));
  const release = Math.exp(-1 / (sampleRate * 0.32));
  let smoothed = 0;

  for (let i = 0; i < length; i += 1) {
    const target = rawEnvelope[i];
    const coef = target > smoothed ? attack : release;
    smoothed = coef * smoothed + (1 - coef) * target;
    envelope[i] = 0.08 + smoothed * 0.92;
  }

  return envelope;
}

function blendSmartRemix(inputChannels, processedChannels, sampleRate, settings) {
  if (!settings.smart) return processedChannels;
  const envelope = createSmartRemixEnvelope(inputChannels, sampleRate);
  const left = new Float32Array(inputChannels[0].length);
  const right = new Float32Array(inputChannels[1].length);

  for (let i = 0; i < left.length; i += 1) {
    const wet = envelope[i];
    const dry = 1 - wet;
    left[i] = inputChannels[0][i] * dry + processedChannels[0][i] * wet;
    right[i] = inputChannels[1][i] * dry + processedChannels[1][i] * wet;
  }

  return [left, right];
}

function processChannels(inputChannels, sampleRate, settings) {
  const processed = buildPhoneRemixCore(inputChannels, sampleRate, settings);
  const [left, right] = blendSmartRemix(inputChannels, processed, sampleRate, settings);
  normalizeToTarget(left, right, settings.targetLufs, settings.ceilingDb - 0.5);
  limitChannels(left, right, settings.ceilingDb);
  return [left, right];
}

function drawBufferWave(ctx, buffer, color, width, height, startSecond, durationSecond, alpha = 1, xOffset = 0, drawWidth = width) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const startFrame = Math.max(0, Math.floor(startSecond * sampleRate));
  const endFrame = Math.min(buffer.length, Math.ceil((startSecond + durationSecond) * sampleRate));
  const frameCount = Math.max(1, endFrame - startFrame);
  const step = Math.max(1, Math.floor(frameCount / drawWidth));
  const amp = height * 0.42;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < drawWidth; x += 1) {
    let min = 1;
    let max = -1;
    const sampleStart = startFrame + Math.floor(x * step);
    for (let i = 0; i < step; i += 1) {
      const sample = data[sampleStart + i] || 0;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    ctx.moveTo(xOffset + x, height / 2 + min * amp);
    ctx.lineTo(xOffset + x, height / 2 + max * amp);
  }
  ctx.stroke();
  ctx.restore();
}

function getTimelineStep(visibleDuration) {
  const targetTicks = 8;
  const rawStep = visibleDuration / targetTicks;
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((step) => step >= rawStep) || 600;
}

function drawTimeline(ctx, width, height, viewportStart, visibleDuration) {
  const step = getTimelineStep(visibleDuration);
  const firstTick = Math.ceil(viewportStart / step) * step;
  ctx.save();
  ctx.fillStyle = "rgb(168 170 165 / 0.9)";
  ctx.strokeStyle = "rgb(55 59 64 / 0.72)";
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textBaseline = "top";

  for (let time = firstTick; time <= viewportStart + visibleDuration + 0.001; time += step) {
    const x = ((time - viewportStart) / visibleDuration) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.fillText(secondsToClock(time), Math.min(width - 38, x + 4), 8);
  }

  ctx.restore();
}

function drawWaveform(buffer, processedBuffer = null, playbackSecond = null) {
  const canvas = els.waveform;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const width = rect.width;
  const height = rect.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101114";
  ctx.fillRect(0, 0, width, height);

  if (!buffer) {
    ctx.strokeStyle = "#373b40";
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    return;
  }

  const isPlayback = Number.isFinite(playbackSecond);
  const visibleDuration = isPlayback ? Math.min(buffer.duration, 16) : buffer.duration;
  const viewportStart = isPlayback
    ? clamp(playbackSecond - visibleDuration * 0.45, 0, Math.max(0, buffer.duration - visibleDuration))
    : 0;
  const playheadX = isPlayback ? ((playbackSecond - viewportStart) / visibleDuration) * width : null;

  drawTimeline(ctx, width, height, viewportStart, visibleDuration);
  drawBufferWave(ctx, buffer, "#42d38b", width, height, viewportStart, visibleDuration);

  if (processedBuffer) {
    if (isPlayback) {
      const processedDuration = Math.min(processedBuffer.duration, visibleDuration);
      drawBufferWave(ctx, processedBuffer, "#f0b64c", width, height, viewportStart, processedDuration, 0.75);
    } else {
      const selectionStart = Number(els.clipStart.value);
      const selectionLength = Number(els.clipLength.value);
      const x = (selectionStart / visibleDuration) * width;
      const w = (selectionLength / visibleDuration) * width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, 0, w, height);
      ctx.clip();
      drawBufferWave(ctx, processedBuffer, "#f0b64c", width, height, 0, processedBuffer.duration, 0.85, x, Math.max(1, w));
      ctx.restore();
    }
  }

  if (isPlayback) {
    ctx.fillStyle = "rgb(242 240 232 / 0.88)";
    ctx.fillRect(playheadX - 1, 0, 2, height);
    ctx.fillStyle = "rgb(242 240 232 / 0.16)";
    ctx.fillRect(0, 0, playheadX, height);
  } else {
    const start = Number(els.clipStart.value);
    const length = Number(els.clipLength.value);
    const x = (start / buffer.duration) * width;
    const w = (length / buffer.duration) * width;
    ctx.fillStyle = "rgb(242 240 232 / 0.08)";
    ctx.fillRect(x, 0, w, height);
    ctx.strokeStyle = "rgb(242 240 232 / 0.36)";
    ctx.strokeRect(x, 0.5, w, height - 1);
    ctx.fillStyle = "rgb(242 240 232 / 0.78)";
    ctx.fillRect(x - 2, 0, 4, height);
    ctx.fillRect(x + w - 2, 0, 4, height);
  }
}

function drawIdleWaveform() {
  drawWaveform(state.originalBuffer, state.processedBuffer);
}

function setClipSelection(startSecond, endSecond, shouldInvalidate = true) {
  const buffer = state.originalBuffer;
  if (!buffer) return;
  const minimumLength = 0.25;
  const maximumLength = Math.min(90, buffer.duration);
  let start = clamp(Math.min(startSecond, endSecond), 0, buffer.duration);
  let end = clamp(Math.max(startSecond, endSecond), 0, buffer.duration);

  if (end - start < minimumLength) {
    end = Math.min(buffer.duration, start + minimumLength);
    start = Math.max(0, end - minimumLength);
  }

  if (end - start > maximumLength) {
    if (endSecond < startSecond) {
      start = Math.max(0, end - maximumLength);
    } else {
      end = Math.min(buffer.duration, start + maximumLength);
    }
  }

  els.clipStart.value = start.toString();
  els.clipLength.value = (end - start).toString();
  updateClipBounds();
  if (shouldInvalidate) invalidateProcessedRender();
  drawIdleWaveform();
}

function canvasEventToSecond(event) {
  const buffer = state.originalBuffer;
  if (!buffer) return 0;
  const rect = els.waveform.getBoundingClientRect();
  const x = clamp(event.clientX - rect.left, 0, rect.width);
  return (x / rect.width) * buffer.duration;
}

function getSelectionHandle(event) {
  const buffer = state.originalBuffer;
  if (!buffer) return "range";
  const rect = els.waveform.getBoundingClientRect();
  const start = Number(els.clipStart.value);
  const end = start + Number(els.clipLength.value);
  const startX = (start / buffer.duration) * rect.width;
  const endX = (end / buffer.duration) * rect.width;
  const pointerX = clamp(event.clientX - rect.left, 0, rect.width);
  const handleDistance = 12;
  if (Math.abs(pointerX - startX) <= handleDistance) return "start";
  if (Math.abs(pointerX - endX) <= handleDistance) return "end";
  return "range";
}

function updateClipBounds() {
  const buffer = state.originalBuffer;
  if (!buffer) return;
  const duration = buffer.duration;
  const currentLength = Math.min(Number(els.clipLength.value), duration);
  els.clipLength.max = Math.max(1, Math.min(90, duration)).toString();
  els.clipLength.value = currentLength.toString();
  els.clipStart.max = Math.max(0, duration - currentLength).toString();
  if (Number(els.clipStart.value) > Number(els.clipStart.max)) {
    els.clipStart.value = els.clipStart.max;
  }
  updateControlOutputs();
}

function revokeDownloadUrls() {
  for (const key of Object.keys(state.downloadUrls)) {
    if (state.downloadUrls[key]) URL.revokeObjectURL(state.downloadUrls[key]);
    state.downloadUrls[key] = null;
  }
  els.downloadWav.removeAttribute("href");
  els.downloadWav.classList.add("disabled");
  els.downloadMp3.classList.add("disabled");
  els.downloadMp3.disabled = true;
}

function invalidateProcessedRender() {
  if (!state.processedBuffer) return;
  stopPlayback();
  state.processedBuffer = null;
  revokeDownloadUrls();
  els.playProcessed.disabled = true;
  updateMp3Availability();
  els.processedStats.textContent = "Peak -- / Loudness --";
  drawIdleWaveform();
}

function loadDecodedBuffer(decoded, fileName, clipStart = 0, clipLength = Math.min(30, Math.max(1, decoded.duration))) {
  stopPlayback();
  revokeDownloadUrls();
  state.processedBuffer = null;
  state.fileName = fileName;
  state.originalBuffer = decoded;
  els.fileName.textContent = fileName;
  els.durationText.textContent = secondsToClock(decoded.duration);
  els.clipStart.value = clamp(clipStart, 0, Math.max(0, decoded.duration - 0.25)).toString();
  els.clipLength.value = Math.min(clipLength, Math.max(0.25, decoded.duration - Number(els.clipStart.value))).toString();
  updateClipBounds();
  const originalStats = analyzeChannels(bufferToChannels(decoded));
  els.originalStats.textContent = formatStats(originalStats);
  els.processedStats.textContent = "Peak -- / Loudness --";
  els.processButton.disabled = false;
  els.playOriginal.disabled = false;
  els.playProcessed.disabled = true;
  updateMp3Availability();
  drawWaveform(decoded);
}

async function handleUpload(file) {
  if (!file) return;
  const ctx = getAudioContext();
  stopPlayback();
  revokeDownloadUrls();
  state.processedBuffer = null;
  state.fileName = file.name;
  els.fileName.textContent = "Decoding...";
  const arrayBuffer = await file.arrayBuffer();
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  loadDecodedBuffer(decoded, file.name);
}

function stopPlayback() {
  if (state.playbackFrame) {
    cancelAnimationFrame(state.playbackFrame);
    state.playbackFrame = null;
  }
  if (state.currentSource) {
    try {
      state.currentSource.stop();
    } catch {
      // Source may already be stopped.
    }
    state.currentSource.disconnect();
    state.currentSource = null;
  }
  state.playbackBuffer = null;
  els.stopPlayback.disabled = true;
  drawIdleWaveform();
}

function animatePlayback() {
  if (!state.currentSource || !state.playbackBuffer) return;
  const ctx = getAudioContext();
  const elapsed = ctx.currentTime - state.playbackStartedAt;
  if (elapsed >= state.playbackBuffer.duration) {
    stopPlayback();
    return;
  }
  drawWaveform(state.playbackBuffer, null, elapsed);
  state.playbackFrame = requestAnimationFrame(animatePlayback);
}

async function playBuffer(buffer) {
  if (!buffer) return;
  const ctx = getAudioContext();
  await ctx.resume();
  stopPlayback();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.onended = () => {
    if (state.currentSource === source) {
      if (state.playbackFrame) {
        cancelAnimationFrame(state.playbackFrame);
        state.playbackFrame = null;
      }
      state.currentSource = null;
      state.playbackBuffer = null;
      els.stopPlayback.disabled = true;
      drawIdleWaveform();
    }
  };
  source.start();
  state.currentSource = source;
  state.playbackBuffer = buffer;
  state.playbackStartedAt = ctx.currentTime;
  els.stopPlayback.disabled = false;
  animatePlayback();
}

function renderSelectedOriginalBuffer() {
  const ctx = getAudioContext();
  const start = Number(els.clipStart.value);
  const length = Number(els.clipLength.value);
  const channels = bufferToChannels(state.originalBuffer, start, length);
  return channelsToAudioBuffer(ctx, channels, state.originalBuffer.sampleRate);
}

function encodeWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataLength = buffer.length * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(arrayBuffer);
  let offset = 0;

  function writeString(value) {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
    offset += value.length;
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataLength, true); offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, numChannels, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString("data");
  view.setUint32(offset, dataLength, true); offset += 4;

  const channelData = Array.from({ length: numChannels }, (_, channel) => buffer.getChannelData(channel));
  for (let i = 0; i < buffer.length; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const sample = clamp(channelData[channel][i], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

function recordBufferAsMime(buffer, mimeType) {
  return new Promise(async (resolve, reject) => {
    const ctx = new audioCtor();
    const destination = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    const chunks = [];
    let recorder;

    try {
      source.buffer = buffer;
      source.connect(destination);
      recorder = new MediaRecorder(destination.stream, {
        mimeType,
        audioBitsPerSecond: 192000,
      });
    } catch (error) {
      await ctx.close().catch(() => {});
      reject(error);
      return;
    }

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });

    recorder.addEventListener("stop", async () => {
      await ctx.close().catch(() => {});
      resolve(new Blob(chunks, { type: mimeType }));
    });

    recorder.addEventListener("error", async (event) => {
      await ctx.close().catch(() => {});
      reject(event.error || new Error("MediaRecorder failed."));
    });

    source.addEventListener("ended", () => {
      window.setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 120);
    });

    await ctx.resume();
    recorder.start();
    source.start();
  });
}

async function downloadProcessedMp3() {
  if (!state.processedBuffer) return;
  const mimeType = getSupportedMp3Mime();
  if (!mimeType) {
    updateMp3Availability();
    return;
  }

  els.downloadMp3.disabled = true;
  els.downloadMp3.textContent = "Encoding...";

  try {
    if (state.downloadUrls.mp3) URL.revokeObjectURL(state.downloadUrls.mp3);
    const blob = await recordBufferAsMime(state.processedBuffer, mimeType);
    state.downloadUrls.mp3 = URL.createObjectURL(blob);
    const safeName = state.fileName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "clip";
    const anchor = document.createElement("a");
    anchor.href = state.downloadUrls.mp3;
    anchor.download = `${safeName}-phone-speaker-remix.mp3`;
    anchor.style.display = "none";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    els.downloadMp3.textContent = "Download MP3";
    updateMp3Availability();
  }
}

async function processCurrentClip() {
  if (!state.originalBuffer) return;
  stopPlayback();
  revokeDownloadUrls();
  els.processButton.disabled = true;
  els.processButton.textContent = "Processing...";

  await new Promise((resolve) => setTimeout(resolve, 20));

  const settings = getSettings();
  const start = Number(els.clipStart.value);
  const length = Number(els.clipLength.value);
  const inputChannels = bufferToChannels(state.originalBuffer, start, length);
  const outputChannels = processChannels(inputChannels, state.originalBuffer.sampleRate, settings);
  state.processedBuffer = channelsToAudioBuffer(getAudioContext(), outputChannels, state.originalBuffer.sampleRate);

  const stats = analyzeChannels(outputChannels);
  els.processedStats.textContent = formatStats(stats);

  const wavBlob = encodeWav(state.processedBuffer);
  state.downloadUrls.wav = URL.createObjectURL(wavBlob);
  els.downloadWav.href = state.downloadUrls.wav;
  const safeName = state.fileName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-") || "clip";
  els.downloadWav.download = `${safeName}-phone-speaker-remix.wav`;
  els.downloadWav.classList.remove("disabled");
  els.playProcessed.disabled = false;
  updateMp3Availability();
  els.processButton.disabled = false;
  els.processButton.textContent = "Remix clip";
  drawIdleWaveform();
}

els.fileInput.addEventListener("change", (event) => {
  handleUpload(event.target.files[0]).catch((error) => {
    console.error(error);
    els.fileName.textContent = error.message || "Decode failed";
    els.processButton.disabled = true;
  });
});

els.presetButtons.forEach((button) => {
  button.addEventListener("click", () => applyPreset(button.dataset.preset));
});

[els.highPassHz, els.bassMixDb, els.presenceDb, els.targetLufs, els.ceilingDb].forEach((input) => {
  input.addEventListener("input", () => {
    updateControlOutputs();
    invalidateProcessedRender();
  });
});

[els.clipStart, els.clipLength].forEach((input) => {
  input.addEventListener("input", () => {
    invalidateProcessedRender();
    updateClipBounds();
    drawWaveform(state.originalBuffer);
  });
});

els.monoToggle.addEventListener("change", invalidateProcessedRender);
els.smartAudioToggle.addEventListener("change", invalidateProcessedRender);

els.processButton.addEventListener("click", () => {
  processCurrentClip().catch((error) => {
    console.error(error);
    els.processButton.disabled = false;
    els.processButton.textContent = "Remix clip";
    els.processedStats.textContent = error.message || "Processing failed";
  });
});

els.downloadMp3.addEventListener("click", () => {
  downloadProcessedMp3().catch((error) => {
    console.error(error);
    els.downloadMp3.textContent = "Download MP3";
    updateMp3Availability();
    els.processedStats.textContent = error.message || "MP3 export failed";
  });
});

els.playOriginal.addEventListener("click", () => {
  playBuffer(renderSelectedOriginalBuffer()).catch(console.error);
});

els.playProcessed.addEventListener("click", () => {
  playBuffer(state.processedBuffer).catch(console.error);
});

els.stopPlayback.addEventListener("click", stopPlayback);
window.addEventListener("resize", drawIdleWaveform);

els.waveform.addEventListener("pointerdown", (event) => {
  if (!state.originalBuffer) return;
  if (state.currentSource) stopPlayback();

  const handle = getSelectionHandle(event);
  const time = canvasEventToSecond(event);
  const start = Number(els.clipStart.value);
  const end = start + Number(els.clipLength.value);
  const anchor = handle === "start" ? end : start;

  state.selectionDrag = {
    handle,
    anchor: handle === "range" ? time : anchor,
  };

  els.waveform.setPointerCapture(event.pointerId);

  if (handle === "range") {
    setClipSelection(time, time + 0.25);
  } else {
    setClipSelection(anchor, time);
  }
});

els.waveform.addEventListener("pointermove", (event) => {
  if (!state.originalBuffer) return;

  if (!state.selectionDrag) {
    const handle = getSelectionHandle(event);
    els.waveform.style.cursor = handle === "range" ? "crosshair" : "ew-resize";
    return;
  }

  const time = canvasEventToSecond(event);
  setClipSelection(state.selectionDrag.anchor, time);
});

els.waveform.addEventListener("pointerup", (event) => {
  if (els.waveform.hasPointerCapture(event.pointerId)) {
    els.waveform.releasePointerCapture(event.pointerId);
  }
  state.selectionDrag = null;
});

els.waveform.addEventListener("pointercancel", () => {
  state.selectionDrag = null;
});

applyPreset("balanced");
updateMp3Availability();
drawWaveform(null);
