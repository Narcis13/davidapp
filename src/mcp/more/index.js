// The MCP tools added in iteration 4, one module per area, so each area's tools live beside each other
// and away from the core list in ../tools.js. Each module's default export takes the shared helpers and
// returns tool definitions shaped like those in tools.js: { name, title, description, input, run }.

import footage from './footage.js';
import fonts from './fonts.js';
import speech from './speech.js';
import exchange from './exchange.js';
import provenance from './provenance.js';

/** @param {any} api { studio, who, image, z, REF, PARAMS, AUTHOR, FORMAT, COMPOSITION, compactAsset, compactRender } */
export const moreTools = (api) => [footage, fonts, speech, exchange, provenance].flatMap((m) => m(api));
