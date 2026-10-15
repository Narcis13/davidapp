// MCP tools: speech (iteration 4). The voice and the word times of a narration, made inside the studio.

/** @param {any} api @returns {any[]} */
export default function tools(api) {
  const { studio, who, z, REF, AUTHOR } = api;
  return [
    {
      name: 'speech_status',
      title: 'Speech tools available',
      description: 'What the studio can do with speech on this machine: transcription (whisper.cpp: STUDIO_WHISPER_CLI, STUDIO_WHISPER_MODEL, optional STUDIO_WHISPER_MODEL_2), a voice engine (STUDIO_TTS = kokoro with STUDIO_KOKORO_DIR, or elevenlabs with ELEVENLABS_API_KEY) and FFmpeg. For every missing piece it says exactly what to set or install. The settings come from the environment or a git-ignored .env at the repo root; nothing is guessed. Without any of it add_narration with timings still works.',
      input: {},
      readOnly: true,
      run: () => ({ json: studio.speech.status() }),
    },
    {
      name: 'transcribe',
      title: 'Transcribe audio with word times',
      description: 'Words and their start and end times (seconds) from a sound asset (ref) or an audio file (path), with whisper.cpp (token times, -ojf). model: primary (default), secondary, or the path of a ggml model. Returns { text, words, model, seconds }; a file already transcribed with the same model is answered from the cache (cached: true). Takes a minute or more for long audio.',
      input: { ref: REF.optional(), path: z.string().optional().describe('Absolute path of an audio file'), model: z.string().optional().describe('primary | secondary | path of a ggml model'), language: z.string().optional().describe('Default en'), refine: z.boolean().optional().describe('Move each word\'s start and end onto the sound (default true): whisper puts a start in the silence before the word; rawWords keeps its own times') },
      readOnly: true,
      run: async (a) => ({ json: await studio.speech.transcribe({ ref: a.ref, path: a.path, model: a.model, language: a.language, refine: a.refine }) }),
    },
    {
      name: 'voice_samples',
      title: 'Hear one line in several voices',
      description: 'The same line spoken in several voices, saved as WAV files under <data>/speech/samples/ with their durations: the choice for the owner at the voice gate. voices: voice ids to hear; without it count (default 3) different voices are picked (best graded first, spread over language and gender). Returns the paths. The engine is the configured one (speech_status).',
      input: { line: z.string().describe('The sentence to speak (at most 600 characters)'), voices: z.array(z.string()).optional(), count: z.number().int().min(1).max(12).optional(), speed: z.number().min(0.5).max(2).optional() },
      run: async (a) => ({ json: await studio.speech.voiceSamples({ line: a.line, voices: a.voices, count: a.count, speed: a.speed }) }),
    },
    {
      name: 'generate_narration',
      title: 'Generate a narration from a script',
      description: 'Speak the script in a voice and create the narration asset (a sound with its script and the time of every word) in one call: the voice engine synthesizes (Kokoro, or ElevenLabs which times the words itself), whisper.cpp transcribes the take (both models when two are configured), the transcript is aligned to the script and checked against it, and the asset is added. The same name again is a new take that keeps the anchors. Takes minutes for a long script. Put the result on an audio track with role narration, as for add_narration.',
      input: {
        script: z.string().describe('The text to speak'), voice: z.string().describe('A voice id from voice_samples / speech_status'), name: z.string().describe('Asset name: lowercase letters, digits and dashes'),
        speed: z.number().min(0.5).max(2).optional(), title: z.string().optional(), description: z.string().optional(), for_clip: z.string().optional(), language: z.string().optional(),
        check: z.boolean().optional().describe('Transcribe the take to check it against the script (default true)'), author: AUTHOR,
      },
      run: async (a) => {
        const r = await studio.speech.generateNarration({ script: a.script, voice: a.voice, speed: a.speed, name: a.name, title: a.title, description: a.description, forClip: a.for_clip, language: a.language, check: a.check, author: who(a.author) });
        return { json: { added: r.asset.ref, duration: r.asset.duration, words: r.words, stats: r.stats, voice: r.voice, timedBy: r.timedBy, models: r.models, seconds: r.seconds, transcript: r.transcript, warnings: r.warnings } };
      },
    },
  ];
}
