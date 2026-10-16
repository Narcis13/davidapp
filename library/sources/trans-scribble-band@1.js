// A preset of trans-scribble@2: "Scribble cut with highlighter band". Made in the studio from parameters chosen in the playground.
// Its parameters are trans-scribble@2's, with these values as defaults; it draws by handing them to trans-scribble@2.
asset({
  kind: 'transition',
  title: 'Scribble cut with highlighter band',
  description: 'The doodle cut tuned on fablecut-doodle-tour: four tilted marker passes with a yellow highlighter band behind the stroke head and a pink rim, so the cut reads even on plain paper. Put it on the top (title) track; give the art track below the same preset with rim 0 and body 0 so both line up as one scribble.',
  tags: ['transition', 'scribble', 'doodle', 'sketch', 'preset'],
  duration: 0.7,
  formats: ['vertical', 'horizontal', 'square'],
  uses: { base: 'trans-scribble@2' },
  params: {
    rows: {
      type: 'integer',
      default: 4,
      min: 2,
      max: 10,
      description: 'Zigzag passes across the frame',
    },
    angle: {
      type: 'number',
      default: -9,
      min: -45,
      max: 45,
      step: 1,
      description: 'Tilt of each pass, degrees',
    },
    rim: {
      type: 'number',
      default: 2.2,
      min: 0,
      max: 8,
      step: 0.1,
      description: 'Width of the coloured rim, % of the frame\'s short side',
    },
    color: {
      type: 'string',
      default: '',
      description: 'Rim colour, a CSS colour (empty: the theme\'s accent2, else a marker pink)',
    },
    body: {
      type: 'number',
      default: 0.6,
      min: 0,
      max: 1,
      step: 0.05,
      description: 'Opacity of the marker band behind the stroke\'s head (0: none); on one track only when several share the cut',
    },
    bodyColor: {
      type: 'string',
      default: '',
      description: 'Band colour, a CSS colour (empty: the theme\'s highlight, else a marker yellow)',
    },
    tail: {
      type: 'number',
      default: 0.24,
      min: 0.02,
      max: 1,
      step: 0.01,
      description: 'Length of the band, as a share of the whole stroke',
    },
    wobble: { type: 'number', default: 0.35, min: 0, max: 2, step: 0.05 },
    ease: {
      type: 'enum',
      options: ['inOutCubic', 'outCubic', 'inOutQuad', 'linear'],
      default: 'inOutCubic',
    },
  },
  render(f, p) {
    return f.use('base', p);
  },
});
