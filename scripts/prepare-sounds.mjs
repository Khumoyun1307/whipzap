#!/usr/bin/env node
// Prepares the shipped whip-crack samples from the raw CC0 downloads in assets/sounds/_incoming/.
// Pure Node, no ffmpeg: reads PCM WAV (16/24/32-bit int, mono or stereo), downmixes to mono,
// trims to the transient (starts 10 ms before the first sample above -30 dBFS), caps length at
// 800 ms with a 30 ms fade-out, peak-normalises to -1 dBFS, and writes 16-bit mono WAV at the
// source sample rate as assets/sounds/crack-N.wav.
//
// Usage: node scripts/prepare-sounds.mjs [incomingDir] [outDir]

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const incoming = process.argv[2] ?? 'assets/sounds/_incoming';
const outDir = process.argv[3] ?? 'assets/sounds';
const MAX_MS = 800;
const PRE_MS = 10;
const FADE_MS = 30;
const THRESHOLD_DB = -30;
const TARGET_PEAK_DB = -1;

function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length));
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('missing fmt or data chunk');
  if (fmt.format !== 1 && fmt.format !== 0xfffe) throw new Error(`unsupported WAV format tag ${fmt.format}`);
  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const mono = new Float32Array(frames);
  const scale = 2 ** (fmt.bits - 1);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const off = (i * fmt.channels + c) * bytes;
      let v;
      if (bytes === 2) v = data.readInt16LE(off);
      else if (bytes === 3) v = (data[off] | (data[off + 1] << 8) | (data[off + 2] << 16)) << 8 >> 8;
      else if (bytes === 4) v = data.readInt32LE(off);
      else throw new Error(`unsupported bit depth ${fmt.bits}`);
      sum += v / scale;
    }
    mono[i] = sum / fmt.channels;
  }
  return { sampleRate: fmt.sampleRate, samples: mono };
}

function process1(samples, sampleRate) {
  const threshold = 10 ** (THRESHOLD_DB / 20);
  let onset = samples.findIndex((s) => Math.abs(s) >= threshold);
  if (onset < 0) onset = 0;
  const start = Math.max(0, onset - Math.round((PRE_MS / 1000) * sampleRate));
  const end = Math.min(samples.length, start + Math.round((MAX_MS / 1000) * sampleRate));
  const out = samples.slice(start, end);
  const fade = Math.min(out.length, Math.round((FADE_MS / 1000) * sampleRate));
  for (let i = 0; i < fade; i++) out[out.length - 1 - i] *= i / fade;
  let peak = 0;
  for (const s of out) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 ? 10 ** (TARGET_PEAK_DB / 20) / peak : 1;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

function writeWav16(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

mkdirSync(outDir, { recursive: true });
const files = readdirSync(incoming).filter((f) => f.toLowerCase().endsWith('.wav')).sort();
if (!files.length) {
  console.error(`no .wav files in ${incoming}`);
  process.exit(1);
}
files.forEach((file, i) => {
  const { sampleRate, samples } = readWav(readFileSync(path.join(incoming, file)));
  const out = process1(samples, sampleRate);
  const name = `crack-${i + 1}.wav`;
  writeFileSync(path.join(outDir, name), writeWav16(out, sampleRate));
  console.log(`${file} -> ${name}: ${(out.length / sampleRate).toFixed(3)} s, ${sampleRate} Hz, ${out.length * 2 + 44} bytes`);
});
