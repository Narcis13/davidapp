// The HTTP routes added in iteration 4, one module per area. Each module's default export takes the
// server's helpers and returns route entries shaped like those in ../http.js: [method, regex, handler, opts?],
// where opts.raw means the handler reads the request body itself (an upload) instead of JSON.

import footage from './footage.js';
import fonts from './fonts.js';
import speech from './speech.js';
import exchange from './exchange.js';
import provenance from './provenance.js';

/** @param {any} api { studio, author, send, png, file, read, int } */
export const moreRoutes = (api) => [footage, fonts, speech, exchange, provenance].flatMap((m) => m(api));
