/**
 * Assembles the pitch video.
 *
 * Scene length is derived from the generated narration rather than guessed, so
 * the pictures follow the voice. Each card becomes its own clip with a slow
 * Ken Burns move, the clips are chained with crossfades, and each scene's
 * narration is placed after its transition has finished — which is why the
 * timeline maths below tracks both clip starts and scene starts.
 *
 * Run with TTS present in tts/<scene>.wav for a voiced cut; without it the
 * video renders silent from estimated durations, which is how the pipeline gets
 * validated before a key is available.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';

import { fileURLToPath } from 'node:url';
/** Working directory for renders. Override with WORKDIR to keep them out of the tree. */
const ROOT = (process.env.WORKDIR ?? fileURLToPath(new URL('.', import.meta.url))).replace(/\/$/, '');
const CLIPS = `${ROOT}/clips`;
const TTS = `${ROOT}/tts`;
const OUT = `${ROOT}/out`;
mkdirSync(CLIPS, { recursive: true });
mkdirSync(OUT, { recursive: true });

const cfg = JSON.parse(readFileSync(`${ROOT}/script.json`, 'utf8'));
const FPS = cfg.fps;
const XF = cfg.crossfade;
const LEAD = cfg.lead;
const TAIL = 0.7;
const FINAL_HOLD = 1.6;

const run = (args) => execFileSync('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * True when an existing clip is complete.
 *
 * Encoders write progressively, so a killed run leaves a file that exists but
 * has no moov atom and will not decode. Checking the duration proves the file
 * finished rather than merely started.
 */
function clipIsGood(file, expected, tolerance = 0.06) {
  if (!existsSync(file)) return false;
  try {
    return Math.abs(probe(file) - expected) <= tolerance;
  } catch {
    return false;
  }
}
const probe = (file) =>
  Number(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { encoding: 'utf8' },
    ).trim(),
  );

/** Finds the recorded interaction clip, whatever hash Playwright gave it. */
function findRecording(dir) {
  const full = `${ROOT}/${dir}`;
  if (!existsSync(full)) return null;
  const f = readdirSync(full).find((n) => n.endsWith('.webm'));
  return f ? `${full}/${f}` : null;
}

const words = (s) => s.trim().split(/\s+/).length;

// ---------------------------------------------------------------- durations
let voiced = 0;
const scenes = cfg.scenes.map((s) => {
  const wav = `${TTS}/${s.id}.wav`;
  const mp3 = `${TTS}/${s.id}.mp3`;
  const ttsFile = existsSync(wav) ? wav : existsSync(mp3) ? mp3 : null;
  const narration = ttsFile ? probe(ttsFile) : words(s.narration) / 2.5;
  if (ttsFile) voiced += 1;
  const duration = narration + LEAD + TAIL;
  return { ...s, ttsFile, narration, duration };
});

// ------------------------------------------------------------------- clips
const clips = [];
scenes.forEach((scene, si) => {
  const total = scene.parts.reduce((a, p) => a + p.weight, 0);
  scene.parts.forEach((part, pi) => {
    let dur = (scene.duration * part.weight) / total;
    if (part.maxSec !== undefined) dur = Math.min(dur, part.maxSec);
    dur = Math.max(2.0, Number(dur.toFixed(3)));

    const file = `${CLIPS}/${scene.id}_${pi}.mp4`;
    const frames = Math.round(dur * FPS);
    // Resume: an already-rendered clip is bytes-identical to what this would
    // produce, so re-running after a failure only redoes the part that failed.
    if (process.env.RESUME === '1' && clipIsGood(file, dur)) {
      clips.push({ file, dur, sceneId: scene.id, si });
      console.log(`  reuse ${file.split('/').pop()} (${dur.toFixed(2)}s)`);
      return;
    }

    if (part.type === 'card') {
      // Prefer the 2304x1296 copy: still 1.2x the output, so a 1.05 zoom never
      // upscales, but zoompan resamples a third of the pixels and runs 2x faster.
      const small = `${ROOT}/cards-sm/${part.name}.png`;
      const full = `${ROOT}/cards/${part.name}.png`;
      const img = existsSync(small) ? small : full;
      if (!existsSync(img)) throw new Error(`missing card ${img}`);
      const z = {
        in: { expr: `min(1+0.0007*on,1.05)`, pan: false },
        out: { expr: `max(1.05-0.0007*on,1.0)`, pan: false },
        'pan-r': { expr: `1.04`, pan: true },
        'pan-l': { expr: `1.04`, pan: false },
      }[part.motion];

      // Drift is expressed in output frames so the move always completes within
      // the clip, however long the narration made it.
      const cx = 'iw/2-(iw/zoom/2)';
      const cy = 'ih/2-(ih/zoom/2)';
      let x = cx;
      if (part.motion === 'pan-r') x = `(iw-iw/zoom)*on/${frames}`;
      if (part.motion === 'pan-l') x = `(iw-iw/zoom)*(1-on/${frames})`;

      // The cards are already 3840x2160 — twice the output height — so zoompan
      // has all the headroom it needs. Upscaling further only made it slower.
      run([
        '-y', '-framerate', String(FPS), '-loop', '1', '-i', img, '-t', String(dur),
        '-filter_complex',
        `zoompan=z='${z.expr}':x='${x}':y='${cy}':d=1:s=1920x1080:fps=${FPS},format=yuv420p`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-r', String(FPS),
        '-movflags', '+faststart', file,
      ]);
    } else {
      const src = findRecording(part.path);
      if (!src) throw new Error(`no recording under ${part.path}`);
      const srcDur = probe(src);
      const start = Math.min(part.trimStart ?? 0, Math.max(0, srcDur - 2));
      const len = Math.min(dur, srcDur - start);
      run([
        '-y', '-ss', String(start), '-i', src, '-t', String(len),
        '-filter_complex',
        `scale=1920:1080:flags=lanczos,fps=${FPS},format=yuv420p`,
        '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-r', String(FPS),
        '-movflags', '+faststart', file,
      ]);
      dur = len;
    }
    clips.push({ file, dur, sceneId: scene.id, si });
  });
});

// --------------------------------------------------------------- timeline
const startOf = [];
let cursor = 0;
for (let i = 0; i < clips.length; i += 1) {
  startOf.push(cursor);
  cursor += clips[i].dur - XF;
}
const total = cursor + XF;
console.log('\n=== timeline ===');
clips.forEach((c, i) =>
  console.log(`  clip ${i} ${c.sceneId.padEnd(4)} start ${startOf[i].toFixed(2)}s dur ${c.dur.toFixed(2)}s`),
);
console.log(`  total ${total.toFixed(2)}s (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, '0')})`);

// ---------------------------------------------------------- video assembly
// Written to a temporary name and moved into place only once ffmpeg exits, so a
// truncated encode can never be mistaken for a finished one.
const silent = `${CLIPS}/video-only.mp4`;
const silentTmp = `${CLIPS}/video-only.tmp.mp4`;
if (clips.length === 1) {
  run(['-y', '-i', clips[0].file, '-c', 'copy', silentTmp]);
} else {
  const inputs = clips.flatMap((c) => ['-i', c.file]);
  let filter = '';
  let prev = '0:v';
  let acc = clips[0].dur;
  for (let i = 1; i < clips.length; i += 1) {
    const offset = acc - XF;
    const label = i === clips.length - 1 ? 'vout' : `v${i}`;
    filter += `[${prev}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${offset.toFixed(3)}[${label}];`;
    prev = label;
    acc = offset + clips[i].dur;
  }
  filter = filter.replace(/;$/, '');
  run([
    '-y', ...inputs,
    '-filter_complex', filter,
    '-map', '[vout]',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
    '-r', String(FPS), '-movflags', '+faststart', silentTmp,
  ]);
}
renameSync(silentTmp, silent);
console.log(`\nvideo track: ${probe(silent).toFixed(2)}s`);

// ------------------------------------------------------------------ audio
const final = `${OUT}/agrishield-demo.mp4`;
const finalTmp = `${OUT}/agrishield-demo.tmp.mp4`;
if (voiced === 0) {
  console.log('no narration found in tts/ — exporting silent (pipeline check only)');
  run(['-y', '-i', silent, '-c', 'copy', finalTmp]);
} else {
  const withAudio = scenes.filter((s) => s.ttsFile);
  const firstClipOfScene = new Map();
  clips.forEach((c, i) => {
    if (!firstClipOfScene.has(c.sceneId)) firstClipOfScene.set(c.sceneId, i);
  });

  const inputs = ['-i', silent];
  let filter = '';
  const labels = [];
  withAudio.forEach((s, k) => {
    inputs.push('-i', s.ttsFile);
    const at = Math.round((startOf[firstClipOfScene.get(s.id)] + LEAD) * 1000);
    filter += `[${k + 1}:a]aresample=48000,adelay=${at}|${at}[a${k}];`;
    labels.push(`[a${k}]`);
  });
  filter += `${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0[aout]`;

  run([
    '-y', ...inputs,
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000',
    '-movflags', '+faststart', '-t', total.toFixed(3), finalTmp,
  ]);
}
renameSync(finalTmp, final);

const size = (execFileSync('stat', ['-c', '%s', final], { encoding: 'utf8' }).trim() / 1048576).toFixed(1);
console.log(`\n=== ${final} ===`);
console.log(execFileSync('ffprobe', [
  '-v', 'error', '-show_entries',
  'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration,size',
  '-of', 'default=nw=1', final,
], { encoding: 'utf8' }));
console.log(`${size} MB`);
writeFileSync(`${OUT}/timeline.json`, JSON.stringify({ total, clips: clips.map((c, i) => ({ ...c, start: startOf[i] })) }, null, 2));
