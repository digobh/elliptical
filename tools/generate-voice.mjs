// Generates the coach clips with ElevenLabs (voice: Jessica) into assets/voice/jessica/.
// Only missing clips are generated; delete a file (or use --force) to redo it.
// Needs an ElevenLabs API key in ELEVENLABS_API_KEY (in this project's cloud
// session the network proxy injects it, so a placeholder is enough).
//   node tools/generate-voice.mjs [--force]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { CLIPS } from './voice-script.mjs';

const VOICE = { name: 'Jessica', id: 'cgSgspJ2msm6clMCkdW9' };
const MODEL = 'eleven_multilingual_v2';
const SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true };
const OUT = 'assets/voice/jessica';
const force = process.argv.includes('--force');
const key = process.env.ELEVENLABS_API_KEY || 'proxy-injected';

mkdirSync(OUT, { recursive: true });
let made = 0, chars = 0;
for (const [id, text] of Object.entries(CLIPS)) {
  const file = `${OUT}/${id}.mp3`;
  if (existsSync(file) && !force) continue;
  const code = execFileSync('curl', ['-sS', '-o', file, '-w', '%{http_code}', '-X', 'POST',
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE.id}?output_format=mp3_44100_64`,
    '-H', `xi-api-key: ${key}`, '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS })]).toString();
  if (code !== '200') throw new Error(`${id}: HTTP ${code} ${execFileSync('head', ['-c', '300', file])}`);
  made++; chars += text.length;
  process.stdout.write(`${id} (${statSync(file).size} B)\n`);
}
const manifest = { voice: VOICE.name, model: MODEL, clips: Object.fromEntries(Object.entries(CLIPS).map(([id, text]) => [id, text])) };
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(`Generated ${made} clips (${chars} characters). Manifest: ${Object.keys(CLIPS).length} clips.`);
