/**
 * Generates the voice-over with Gemini TTS, one clip per scene.
 *
 * The API returns raw 24 kHz mono PCM rather than a container, so each response
 * is wrapped in a WAV header here. Every clip's duration is then measured and
 * reported, because the edit derives scene lengths from these numbers.
 *
 * The same style directive prefixes every scene: a consistent tone across cuts
 * matters more than optimising any single line, and a pitch that changes voice
 * between scenes sounds assembled rather than written.
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error('GEMINI_API_KEY is not set');

import { fileURLToPath } from 'node:url';
/** Working directory for renders. Override with WORKDIR to keep them out of the tree. */
const ROOT = (process.env.WORKDIR ?? fileURLToPath(new URL('.', import.meta.url))).replace(/\/$/, '');
const TTS_DIR = `${ROOT}/tts`;
mkdirSync(TTS_DIR, { recursive: true });

const MODEL = process.env.TTS_MODEL ?? 'gemini-2.5-pro-preview-tts';
const FALLBACK = 'gemini-2.5-flash-preview-tts';
const VOICE = process.env.TTS_VOICE ?? 'Charon';
const STYLE =
  'Narrate this as a calm, confident product film for a technical audience. ' +
  'Warm and measured, natural pacing, clear articulation, light emphasis on the numbers. ' +
  'Do not read these instructions aloud and do not add or change any words:\n\n';

const cfg = JSON.parse(readFileSync(`${ROOT}/script.json`, 'utf8'));

/** Minimal RIFF/WAVE writer for the 16-bit mono PCM the API returns. */
function wav(pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bits) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bits) / 8, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function synth(model, text) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'x-goog-api-key': KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: STYLE + text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
      }),
    },
  );
  const body = await res.json();
  if (body.error) throw new Error(`${res.status}: ${JSON.stringify(body.error).slice(0, 300)}`);
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    throw new Error(`no audio in response: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return Buffer.from(part.inlineData.data, 'base64');
}

/**
 * TTS on the free tier is rate limited, so a 429 is expected rather than fatal.
 * Backs off and retries, which is why a partial run can simply be re-run: each
 * scene already on disk is skipped.
 */
async function synthWithRetry(model, text, attempts = 8) {
  let wait = 15;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await synth(model, text);
    } catch (err) {
      const quota = /429|quota|RESOURCE_EXHAUSTED/i.test(err.message);
      if (!quota || i === attempts) throw err;
      console.log(`   rate limited, waiting ${wait}s (attempt ${i}/${attempts})`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      wait = Math.min(Math.round(wait * 1.5), 90);
    }
  }
  throw new Error('unreachable');
}

const results = [];
let model = MODEL;
for (const scene of cfg.scenes) {
  const file = `${TTS_DIR}/${scene.id}.wav`;
  if (existsSync(file) && process.env.FORCE !== '1') {
    const d = Number(
      execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
        encoding: 'utf8',
      }).trim(),
    );
    console.log(`${scene.id}  cached  ${d.toFixed(2)}s`);
    results.push({ id: scene.id, duration: d });
    continue;
  }

  let pcm;
  try {
    pcm = await synthWithRetry(model, scene.narration, 4);
  } catch (err) {
    if (model !== FALLBACK) {
      console.log(`   ${model} unavailable (${err.message.slice(0, 90)}) — using ${FALLBACK}`);
      model = FALLBACK;
      pcm = await synthWithRetry(model, scene.narration);
    } else {
      throw err;
    }
  }

  writeFileSync(file, wav(pcm));
  const d = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], {
      encoding: 'utf8',
    }).trim(),
  );
  const expected = scene.narration.trim().split(/\s+/).length / 2.5;
  console.log(
    `${scene.id}  ${d.toFixed(2)}s  (est ${expected.toFixed(1)}s, ${pcm.length} bytes pcm, model ${model})`,
  );
  results.push({ id: scene.id, duration: d });
  await new Promise((r) => setTimeout(r, 6000));
}

const total = results.reduce((a, r) => a + r.duration, 0);
console.log(`\nvoice-over total: ${total.toFixed(2)}s across ${results.length} scenes`);
console.log(`projected video length: ~${(total + results.length * 1.4 - (results.length - 1) * 0.6).toFixed(1)}s`);
writeFileSync(`${ROOT}/tts/durations.json`, JSON.stringify(results, null, 2));
