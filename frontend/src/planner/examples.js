// Random client requests for the "Try an example" button, written the way parse.js reads them.
// The budget is set from the planned cost so the example shows a realistic margin.

import TARIFFS from "../../../shared/freight-tariffs.json";
import { parseRequest } from "./parse";
import { plan } from "./plan";

const MONTH_NAMES = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  fr: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
};

const FR_PORTS = {
  Rades: "Radès",
  Algiers: "Alger",
  Genoa: "Gênes",
  Valencia: "Valence",
  Barcelona: "Barcelone",
  Piraeus: "Le Pirée",
  Antwerp: "Anvers",
  Hamburg: "Hambourg",
  Singapore: "Singapour",
};

const ARABIC = /[؀-ۿ]/;

// "de" with French elision: du Pirée, d'Anvers, de Gênes.
const frDe = (port) => (port.startsWith("Le ") ? `du ${port.slice(3)}` : /^[AEIOUÉ]/.test(port) ? `d'${port}` : `de ${port}`);

function portName(name, lang) {
  if (lang === "fr") return FR_PORTS[name] ?? name;
  if (lang === "ar") return TARIFFS.ports[name].aliases.find((a) => ARABIC.test(a)) ?? name;
  return name;
}


// Each scenario says who ships what, and how the client describes the quantity.
const SCENARIOS = [
  {
    clients: { en: ["Medjerda Olive Oil Co", "Zitouna Oils"], fr: ["Huilerie de la Medjerda", "Huiles Zitouna"], ar: ["شركة مجردة لزيت الزيتون", "زيوت الزيتونة"] },
    goods: { en: "bottled olive oil", fr: "huile d'olive en bouteilles", ar: "زيت زيتون معبأ" }, qty: "weight_volume", tons: [12, 24], density: 190 },
  {
    clients: { en: ["Cap Bon Textiles", "Monastir Apparel"], fr: ["Textiles du Cap Bon", "Confection Monastir"], ar: ["نسيج الوطن القبلي", "ملابس المنستير"] },
    goods: { en: "ready-made garments", fr: "vêtements confectionnés", ar: "ملابس جاهزة" }, qty: "volume", m3: [35, 140] },
  {
    clients: { en: ["Gafsa Agro Supply", "Gabes Fertilisers"], fr: ["Gafsa Agro Distribution", "Engrais de Gabès"], ar: ["قفصة للتزويد الفلاحي", "أسمدة قابس"] },
    goods: { en: "phosphate fertiliser", fr: "engrais phosphatés", ar: "أسمدة فوسفاتية" }, qty: "boxes", size: "20", boxes: [2, 6] },
  {
    clients: { en: ["Sahel Auto Parts", "Sousse Motors"], fr: ["Sahel Pièces Auto", "Sousse Motors"], ar: ["قطع غيار الساحل", "سوسة للسيارات"] },
    goods: { en: "auto parts", fr: "pièces automobiles", ar: "قطع غيار سيارات" }, qty: "boxes", size: "40HC", boxes: [1, 4] },
  {
    clients: { en: ["Djerba Ceramics", "Nabeul Tiles"], fr: ["Céramiques de Djerba", "Carrelages de Nabeul"], ar: ["خزف جربة", "بلاط نابل"] },
    goods: { en: "ceramic tiles", fr: "carrelage en céramique", ar: "بلاط خزفي" }, qty: "weight", tons: [15, 40] },
  {
    clients: { en: ["Atlas Chemicals", "Ben Arous Paints"], fr: ["Atlas Chimie", "Peintures de Ben Arous"], ar: ["أطلس للكيماويات", "دهانات بن عروس"] },
    goods: { en: "paint and solvents", fr: "peintures et solvants", ar: "دهانات ومذيبات" }, qty: "weight_volume", tons: [6, 16], density: 600, hazmat: true },
  {
    clients: { en: ["Tozeur Dates", "Kebili Palms"], fr: ["Dattes de Tozeur", "Palmeraies de Kébili"], ar: ["تمور توزر", "نخيل قبلي"] },
    goods: { en: "fresh dates", fr: "dattes fraîches", ar: "تمور طازجة" }, qty: "boxes", size: "40RF", boxes: [1, 3], reefer: true },
  {
    clients: { en: ["Kerkennah Seafood", "Carthage Foods"], fr: ["Pêcheries de Kerkennah", "Carthage Alimentaire"], ar: ["مصائد قرقنة", "قرطاج للأغذية"] },
    goods: { en: "frozen fish", fr: "poisson congelé", ar: "سمك مجمد" }, qty: "weight", tons: [10, 26], reefer: true },
];

const CURRENCIES = { en: ["USD", "USD", "EUR"], fr: ["EUR", "USD", "TND"], ar: ["USD", "TND", "TND"] };

const between = (rng, [lo, hi]) => lo + rng() * (hi - lo);
const intBetween = (rng, [lo, hi]) => Math.floor(lo + rng() * (hi - lo + 1));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];

const decimal = (v, lang) => (lang === "fr" ? String(v).replace(".", ",") : String(v));
const thousands = (n, sep) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);

function quantityText(s, rng, lang) {
  const reeferWord = { en: "refrigerated", fr: "réfrigéré", ar: "مبرد" }[lang];
  if (s.qty === "boxes") {
    const n = intBetween(rng, s.boxes);
    const box = {
      "20": { en: `${n} x 20' containers`, fr: `${n} conteneurs de 20'`, ar: `${n} حاويات 20 قدم` },
      "40HC": { en: `${n} x 40' high cube`, fr: `${n} x 40' high cube`, ar: `${n} x 40 HC` },
      "40RF": { en: `${n} x 40' reefer`, fr: `${n} x 40' reefer`, ar: `${n} x 40 reefer` },
    }[s.size][lang];
    return s.reefer && lang === "ar" ? `${box} (${reeferWord})` : box;
  }
  const tons = s.tons ? Math.round(between(rng, s.tons) * 10) / 10 : null;
  const m3 = s.qty === "volume" ? Math.round(between(rng, s.m3)) : Math.round((tons * 1000) / s.density);
  const weight = { en: `${decimal(tons, lang)} t`, fr: `${decimal(tons, lang)} t`, ar: `${decimal(tons, lang)} طن` }[lang];
  const volume = { en: `about ${m3} m3`, fr: `environ ${m3} m3`, ar: `حوالي ${m3} م3` }[lang];
  const parts = s.qty === "volume" ? [volume] : s.qty === "weight" ? [weight] : [weight, volume];
  return parts.join(lang === "ar" ? "، " : ", ") + (s.reefer ? ` (${reeferWord})` : "");
}

function deadlineText(today, rng, lang) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + intBetween(rng, [16, 70]));
  const day = d.getUTCDate();
  const month = MONTH_NAMES[lang][d.getUTCMonth()];
  return { en: `Delivery before ${day} ${month}.`, fr: `Livraison avant le ${day} ${month}.`, ar: `التسليم قبل ${day} ${month}.` }[lang];
}

function budgetText(amount, currency, lang) {
  if (lang === "fr") return `Budget ${thousands(amount, " ")} ${{ USD: "$", EUR: "€", TND: "TND" }[currency]}.`;
  if (lang === "ar") return `الميزانية ${amount} ${{ USD: "دولار", EUR: "يورو", TND: "دينار" }[currency]}.`;
  return `Budget ${{ USD: "$", EUR: "€", TND: "TND " }[currency]}${thousands(amount, ",")}.`;
}

function pickRoute(rng) {
  const ports = Object.keys(TARIFFS.ports);
  const tunisian = ports.filter((p) => TARIFFS.ports[p].country === "Tunisia");
  const origin = rng() < 0.6 && tunisian.length ? pick(rng, tunisian) : pick(rng, ports);
  let destination = pick(rng, ports);
  while (destination === origin) destination = pick(rng, ports);
  return { origin, destination };
}

// A random request in the given language ("en", "fr" or "ar"). rng defaults to Math.random.
export function randomExample(lang, today, rng = Math.random) {
  const s = pick(rng, SCENARIOS);
  const { origin, destination } = pickRoute(rng);
  const from = portName(origin, lang);
  const to = portName(destination, lang);
  const goods = s.goods[lang];
  const qty = quantityText(s, rng, lang);
  const hazmat = s.hazmat ? { en: " IMO class 3, dangerous goods.", fr: " Classe IMO 3, marchandises dangereuses.", ar: " بضائع خطرة من الفئة 3." }[lang] : "";
  const lines = {
    en: [`Client: ${pick(rng, s.clients.en)}`, `Cargo: ${goods}`, `We need to ship ${qty} from the Port of ${from} to ${to}.${hazmat} ${deadlineText(today, rng, lang)}`],
    fr: [`Client : ${pick(rng, s.clients.fr)}`, `Marchandise : ${goods}`, `Nous devons expédier ${qty} au départ ${frDe(from)}, à destination ${frDe(to)}.${hazmat} ${deadlineText(today, rng, lang)}`],
    ar: [`العميل: ${pick(rng, s.clients.ar)}`, `البضاعة: ${goods}`, `نريد شحن ${qty} من ميناء ${from} إلى ${to}.${hazmat} ${deadlineText(today, rng, lang)}`],
  }[lang];
  const text = lines.join("\n");

  // Price the request at 20 to 60% above the cheapest plan, in the client's currency.
  const currency = pick(rng, CURRENCIES[lang]);
  const cheapest = plan(parseRequest(text, today).request, today).matrix.options[0].profit_margin;
  const cost = cheapest.carrier_freight_cost + cheapest.container_rent_fee + cheapest.port_fees;
  const local = (cost * between(rng, [1.2, 1.6])) / TARIFFS.fx_usd[currency];
  const amount = Math.ceil(local / 100) * 100;
  return `${text} ${budgetText(amount, currency, lang)}`;
}
