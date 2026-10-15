// HTTP routes: speech (iteration 4).

/** @param {any} api @returns {any[]} */
export default function routes(api) {
  const { studio } = api;
  return [
    // what is set up, and what to set for each missing piece (never the API key)
    ['GET', /^\/api\/speech$/, () => studio.speech.status()],
    // the voices of the configured engine (Kokoro takes a few seconds the first time)
    ['GET', /^\/api\/speech\/voices$/, () => studio.speech.voices()],
  ];
}
