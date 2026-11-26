'use strict';
// CP437 (IBM PC OEM) <-> Unicode. Used to decode .ANS / .ASC art files byte-exactly.
const HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

const TO_UNICODE = new Array(256);
for (let i = 0; i < 128; i++) TO_UNICODE[i] = String.fromCharCode(i);
for (let i = 0; i < 128; i++) TO_UNICODE[128 + i] = HIGH[i];

const FROM_UNICODE = new Map();
for (let i = 0; i < 256; i++) FROM_UNICODE.set(TO_UNICODE[i], i);

function decode(buf) {
  let out = '';
  for (const b of buf) out += TO_UNICODE[b];
  return out;
}

// A board writes prose in Unicode (em dashes, curly quotes, ellipses) but the
// OEM character set has no such glyphs: transliterate the common ones instead of
// dropping a block character into the middle of a sentence
const TRANSLIT = {
  '\u2014': '-', '\u2013': '-', '\u2018': "'", '\u2019': "'",
  '\u201c': '"', '\u201d': '"', '\u2026': '...', '\u00a0': ' ',
};

function encode(str) {
  const bytes = [];
  for (const ch of str) {
    if (FROM_UNICODE.has(ch)) bytes.push(FROM_UNICODE.get(ch));
    else if (TRANSLIT[ch]) for (const c of TRANSLIT[ch]) bytes.push(c.charCodeAt(0));
    else {
      const cp = ch.codePointAt(0);
      bytes.push(cp < 128 ? cp : 0xfe);
    }
  }
  return Buffer.from(bytes);
}

module.exports = { TO_UNICODE, FROM_UNICODE, decode, encode, HIGH };
