// Reads a client's shipment request written in English, French or Arabic into the planner's request shape.
// Rule-based: it finds ports, quantities, boxes, dates and prices it recognises and reports what is missing.

import TARIFFS from "../../../shared/freight-tariffs.json";

const MONTHS = [
  ["january", "jan", "janvier", "janv", "يناير", "جانفي", "كانون الثاني"],
  ["february", "feb", "fevrier", "fev", "فبراير", "فيفري", "شباط"],
  ["march", "mar", "mars", "مارس", "اذار"],
  ["april", "apr", "avril", "avr", "ابريل", "افريل", "نيسان"],
  ["may", "mai", "مايو", "ماي", "ايار"],
  ["june", "jun", "juin", "يونيو", "جوان", "حزيران"],
  ["july", "jul", "juillet", "juil", "يوليو", "جويلية", "تموز"],
  ["august", "aug", "aout", "اغسطس", "اوت", "اب"],
  ["september", "sept", "sep", "septembre", "سبتمبر", "ايلول"],
  ["october", "oct", "octobre", "اكتوبر", "تشرين الاول"],
  ["november", "nov", "novembre", "نوفمبر", "تشرين الثاني"],
  ["december", "dec", "decembre", "ديسمبر", "كانون الاول"],
];

// Lowercase, Latin digits, no Latin accents, one form of alef: so aliases match however they were typed.
export function normalize(text) {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[٫]/g, ".")
    .replace(/[٬]/g, ",")
    .normalize("NFD")
    .replace(/[̀-ًͯ-ٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .toLowerCase();
}

const ARABIC = /[؀-ۿ]/;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// "7,800" "7 800" "7.800" "18.4" "18,4"
export function parseNumber(raw) {
  const s = raw.replace(/[\s  ]/g, "");
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
  const lastSep = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (lastSep === -1) return Number(s);
  return Number(s.slice(0, lastSep).replace(/[.,]/g, "") + "." + s.slice(lastSep + 1));
}

const NUM = String.raw`(\d{1,3}(?:[   .,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`;

const ALIASES = Object.entries(TARIFFS.ports)
  .flatMap(([name, p]) => p.aliases.map((a) => ({ name, alias: normalize(a) })))
  .sort((a, b) => b.alias.length - a.alias.length);

const DEST_BEFORE = /(\bto|\ba|\bvers|\bpour|\bdestination(\s+de|\s+du)?|\bdest\.?|\bdelivered\s+to|\bdeliver\s+to|\bpod:?|الى|نحو|ل)\s*(the\s+)?(port\s+(of|de|d')\s*)?(ميناء\s*)?$/;
const ORIGIN_BEFORE = /(\bfrom|\bex|\bde|\bdu|\bdepuis|\bpol:?|\bloading\s+(at|in)|\bchargement\s+a|من)\s*(the\s+)?(port\s+(of|de|d')\s*)?(ميناء\s*)?$/;

function findPorts(norm) {
  const hits = [];
  const taken = new Array(norm.length).fill(false);
  for (const { name, alias } of ALIASES) {
    const re = ARABIC.test(alias) ? new RegExp(esc(alias), "g") : new RegExp(`(?<![a-z])${esc(alias)}(?![a-z])`, "g");
    for (const m of norm.matchAll(re)) {
      if (taken.slice(m.index, m.index + alias.length).some(Boolean)) continue;
      for (let i = m.index; i < m.index + alias.length; i++) taken[i] = true;
      hits.push({ name, index: m.index });
    }
  }
  hits.sort((a, b) => a.index - b.index);

  let origin = null;
  let destination = null;
  const loose = [];
  for (const h of hits) {
    const before = norm.slice(Math.max(0, h.index - 30), h.index);
    if (!destination && DEST_BEFORE.test(before)) destination = h.name;
    else if (!origin && ORIGIN_BEFORE.test(before)) origin = h.name;
    else loose.push(h.name);
  }
  for (const name of loose) {
    if (name === origin || name === destination) continue;
    if (!origin) origin = name;
    else if (!destination) destination = name;
  }
  return { origin, destination };
}

function findWeight(norm) {
  const kg = norm.match(new RegExp(`${NUM}\\s*(kgs?|kilos?|kilogrammes?|كغ|كلغ|كيلوغرام|كيلو)(?![a-z])`));
  if (kg) return Math.round(parseNumber(kg[1]));
  const t = norm.match(new RegExp(`${NUM}\\s*(t|tons?|tonnes?|mt|طن|اطنان)(?![a-z])`));
  if (t) return Math.round(parseNumber(t[1]) * 1000);
  return null;
}

function findVolume(norm) {
  const m = norm.match(
    new RegExp(`${NUM}\\s*(m3|m³|cbm|cubic\\s+met(er|re)s?|met(re|er)s?\\s+cubes?|م3|م³|متر\\s*مكعب|مترا\\s*مكعبا|متر\\s*مكعبا)`),
  );
  return m ? parseNumber(m[1]) : null;
}

const BOX_KIND = String.raw`(hc|hq|high[\s-]?cube|dv|dc|gp|dry|std|standard|rf|reefer|rh|frigo|refrigere|مبرده?)?`;

function boxCode(size, kind = "", reefer) {
  const k = kind || "";
  const isReefer = /rf|rh|reefer|frigo|refrig|مبرد/.test(k) || reefer;
  const isHigh = /hc|hq|high|rh/.test(k);
  if (size === "20") return isReefer ? "20RF" : "20DV";
  if (isReefer) return "40RH";
  return isHigh || size === "45" ? "40HC" : "40DV";
}

function findContainers(norm, reefer) {
  const found = [];
  const used = [];
  const patterns = [
    new RegExp(String.raw`(\d+)\s*(?:x|×|\*)\s*(20|40|45)(?!\d|\s*(?:cm|mm)\b)\s*(?:'|’|ft|feet|foot|pieds?|قدم)?\s*${BOX_KIND}`, "g"),
    new RegExp(
      String.raw`(\d+)\s*(?:containers?|conteneurs?|boxes|box|boites|حاويات|حاوية)?\s*(?:de\s+|of\s+|من\s+)?(20|40|45)\s*(?:'|’|ft|feet|foot|-foot|pieds?|قدما?)\s*${BOX_KIND}`,
      "g",
    ),
  ];
  for (const re of patterns) {
    for (const m of norm.matchAll(re)) {
      const span = [m.index, m.index + m[0].length];
      if (used.some(([a, b]) => span[0] < b && a < span[1])) continue;
      used.push(span);
      const code = boxCode(m[2], m[3], reefer);
      const count = Number(m[1]);
      if (count < 1 || count > 200) continue;
      const line = found.find((f) => f.code === code);
      if (line) line.count += count;
      else found.push({ code, count });
    }
  }
  return found;
}

function findPrice(norm) {
  const CUR = String.raw`(\$|usd|us\$|dollars?|€|eur|euros?|tnd|dt|د\.ت|دينار|دولار|يورو)`;
  const before = norm.match(new RegExp(`${CUR}\\s*${NUM}`));
  const after = norm.match(new RegExp(`${NUM}\\s*${CUR}(?![a-z])`));
  const m = [before && { cur: before[1], num: before[2], i: before.index }, after && { cur: after[2], num: after[1], i: after.index }]
    .filter(Boolean)
    .sort((a, b) => a.i - b.i)[0];
  if (!m) return null;
  const currency = /€|eur/.test(m.cur) ? "EUR" : /tnd|dt|د\.ت|دينار/.test(m.cur) ? "TND" : "USD";
  return { amount: parseNumber(m.num), currency };
}

const pad = (n) => String(n).padStart(2, "0");

function isoDate(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function withYear(m, d, year, today) {
  if (year) return isoDate(year < 100 ? 2000 + year : year, m, d);
  const y = Number(today.slice(0, 4));
  const iso = isoDate(y, m, d);
  return iso && iso < today ? isoDate(y + 1, m, d) : iso;
}

function findDeadline(norm, today) {
  const monthAlt = MONTHS.flat()
    .sort((a, b) => b.length - a.length)
    .map(esc)
    .join("|");
  const monthIndex = (word) => MONTHS.findIndex((names) => names.includes(word)) + 1;
  const candidates = [];
  for (const m of norm.matchAll(/(\d{4})-(\d{1,2})-(\d{1,2})/g)) {
    candidates.push({ i: m.index, iso: isoDate(+m[1], +m[2], +m[3]) });
  }
  for (const m of norm.matchAll(/(?<![\d.,])(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?![\d/])/g)) {
    candidates.push({ i: m.index, iso: withYear(+m[2], +m[1], m[3] && +m[3], today) });
  }
  const dayMonth = new RegExp(String.raw`(?<!\d)(\d{1,2})(?:st|nd|rd|th|er)?\s+(?:of\s+)?(${monthAlt})\.?(?:\s+(\d{4}))?(?![a-z])`, "g");
  for (const m of norm.matchAll(dayMonth)) {
    candidates.push({ i: m.index, iso: withYear(monthIndex(m[2]), +m[1], m[3] && +m[3], today) });
  }
  const monthDay = new RegExp(String.raw`(?<![a-z])(${monthAlt})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?(?!\d)`, "g");
  for (const m of norm.matchAll(monthDay)) {
    candidates.push({ i: m.index, iso: withYear(monthIndex(m[1]), +m[2], m[3] && +m[3], today) });
  }
  return candidates.filter((c) => c.iso).sort((a, b) => a.i - b.i)[0]?.iso ?? null;
}

function findLabelled(text, labels) {
  const re = new RegExp(String.raw`(?:${labels})\s*[:\-–]\s*([^\n,;.]+)`, "i");
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

const REEFER_WORDS = /reefer|refrigerat|frigorifique|refrigere|frozen|chilled|congele|temperature controlled|°c|\bfrigo\b|مبرد|تبريد|مجمد/;
const HAZMAT_WORDS = /hazmat|hazardous|dangerous|imdg|imo class|\bclass [1-9]\b|\bun ?\d{4}\b|\bdg\b|dangereu|خطره|خطيره|قابله للاشتعال/;

// Returns { request, missing } where missing lists what the planner still needs.
export function parseRequest(text, today) {
  const norm = normalize(text);
  const { origin, destination } = findPorts(norm);
  const reefer = REEFER_WORDS.test(norm.replace(/[ةه]/g, "ه"));
  const hazmat = HAZMAT_WORDS.test(norm.replace(/[ةه]/g, "ه"));
  const containers = findContainers(norm, reefer);
  const request = {
    client: findLabelled(text, "client|customer|shipper|exp[ée]diteur|العميل|الحريف|الزبون") ?? "",
    origin,
    destination,
    weight_kg: findWeight(norm),
    volume_m3: findVolume(norm),
    commodity: findLabelled(text, "commodity|goods|cargo|marchandises?|produits?|البضاعة|بضاعة|السلعة") ?? "",
    reefer: reefer || containers.some((c) => TARIFFS.equipment[c.code].reefer),
    hazmat,
    deadline: findDeadline(norm, today),
    price: findPrice(norm),
    containers,
  };
  const missing = [];
  if (!origin) missing.push("origin");
  if (!destination) missing.push("destination");
  if (!request.weight_kg && !request.volume_m3 && !containers.length) missing.push("quantity");
  return { request, missing };
}
