import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankedVoices, voiceQuality } from '../src/ui/voice.js';

const v = (name, voiceURI, lang = 'en-US') => ({ name, voiceURI, lang, localService: true });

test('Premium beats Enhanced beats standard; novelty and non-English voices are dropped', () => {
  const list = rankedVoices([
    v('Fred', 'com.apple.speech.synthesis.voice.Fred'),
    v('Samantha', 'com.apple.voice.compact.en-US.Samantha'),
    v('Zarvox', 'com.apple.speech.synthesis.voice.Zarvox'),
    v('Ava', 'com.apple.voice.enhanced.en-US.Ava'),
    v('Zoe', 'com.apple.voice.premium.en-US.Zoe'),
    v('Thomas', 'com.apple.voice.compact.fr-FR.Thomas', 'fr-FR'),
  ]);
  assert.deepEqual(list.map((x) => x.name), ['Zoe', 'Ava', 'Samantha']);
  assert.deepEqual(list.map(voiceQuality), ['Premium', 'Enhanced', 'Standard']);
});
