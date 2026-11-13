// English spelling: the English dictionary is written in American spelling, "English (UK)" is derived from it.
// Pairs [American, British] of whole words (lower case); capitals of the text are kept.
const PAIRS = [
  ['color', 'colour'], ['colors', 'colours'], ['colored', 'coloured'], ['coloring', 'colouring'],
  ['center', 'centre'], ['centers', 'centres'], ['centered', 'centred'], ['centering', 'centring'], ['centerline', 'centreline'], ['centerlines', 'centrelines'],
  ['gray', 'grey'], ['meter', 'metre'], ['meters', 'metres'], ['millimeter', 'millimetre'], ['millimeters', 'millimetres'],
  ['fiber', 'fibre'], ['caliber', 'calibre'], ['aluminum', 'aluminium'], ['mold', 'mould'], ['molds', 'moulds'],
  ['behavior', 'behaviour'], ['neighbor', 'neighbour'], ['neighbors', 'neighbours'], ['neighboring', 'neighbouring'], ['favorite', 'favourite'], ['favorites', 'favourites'],
  ['license', 'licence'], ['licenses', 'licences'],
  ['canceled', 'cancelled'], ['canceling', 'cancelling'], ['labeled', 'labelled'], ['labeling', 'labelling'],
  ['modeled', 'modelled'], ['modeling', 'modelling'], ['traveled', 'travelled'], ['traveling', 'travelling'], ['leveled', 'levelled'], ['leveling', 'levelling'],
  ['beveled', 'bevelled'], ['channeled', 'channelled'], ['dialog', 'dialogue'], ['dialogs', 'dialogues'], ['catalog', 'catalogue'],
  ...['custom', 'organ', 'normal', 'minim', 'maxim', 'optim', 'recogn', 'initial', 'visual', 'synchron', 'final', 'standard', 'categor', 'summar', 'util', 'emphas', 'local', 'material']
    .flatMap(st => [['ize', 'ise'], ['izes', 'ises'], ['ized', 'ised'], ['izing', 'ising'], ['ization', 'isation']].map(([a, b]) => [st + a, st + b])),
  ['analyze', 'analyse'], ['analyzes', 'analyses'], ['analyzed', 'analysed'], ['analyzing', 'analysing'],
];
const US = new Map(PAIRS), UK = new Map(PAIRS.map(([a, b]) => [b, a]));
const keepCase = (from, to) => (from === from.toUpperCase() ? to.toUpperCase() : from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
const swap = (text, map) => text.replace(/[A-Za-z]+/g, w => { const t = map.get(w.toLowerCase()); return t ? keepCase(w, t) : w; });
/** American spelling of an English text. */
export const toUS = text => swap(text, UK);
/** British spelling of an English text. */
export const toUK = text => swap(text, US);
