/* Channel Fixer: cleans an IPTV channel list and exports a TiviMate-ready M3U.
 * Pure logic (parsing, cleaning, matching, building) sits at the top and has no
 * DOM access so it can be tested with Node; the page code is at the bottom. */
'use strict';

// ---------------------------------------------------------------- constants
const IPTV_ORG = 'https://iptv-org.github.io/api/';
const CATEGORIES = ['Main Channels', 'Entertainment', 'Movies', 'Sports', 'News', 'Documentary',
  'Kids', 'Music', 'Lifestyle', 'Religious', 'Shopping', 'Other', 'Regional', '+1 Channels', 'Adult'];
const COUNTRY_ALIASES = { GB: 'UK', ENG: 'UK', USA: 'US', CAN: 'CA', GER: 'DE', DEU: 'DE', FRA: 'FR', ESP: 'ES',
  ITA: 'IT', POR: 'PT', NED: 'NL', POL: 'PL', TUR: 'TR', IRL: 'IE', AUS: 'AU', NZL: 'NZ', IND: 'IN', SWE: 'SE',
  NOR: 'NO', DEN: 'DK', DNK: 'DK', FIN: 'FI', BEL: 'BE', SUI: 'CH', AUT: 'AT', GRE: 'GR', ALB: 'AL', ROU: 'RO',
  ROM: 'RO', BUL: 'BG', HUN: 'HU', CZE: 'CZ', RUS: 'RU', UKR: 'UA', BRA: 'BR', MEX: 'MX', ARG: 'AR', AR: 'ARAB', KSA: 'SA',
  UAE: 'AE', PAK: 'PK', BAN: 'BD', PHI: 'PH', 'EX-YU': 'EXYU', EXYU: 'EXYU', YU: 'EXYU', ARAB: 'ARAB', ARA: 'ARAB',
  AFR: 'AFR', LAT: 'LATAM', LATAM: 'LATAM', LATINO: 'LATAM', CARIB: 'CARIB', CAR: 'CARIB', KUR: 'KURD' };
const COUNTRY_WORDS = { 'united kingdom': 'UK', england: 'UK', britain: 'UK', 'great britain': 'UK', scotland: 'UK',
  'united states': 'US', america: 'US', usa: 'US', ireland: 'IE', canada: 'CA', germany: 'DE', deutschland: 'DE',
  france: 'FR', spain: 'ES', espana: 'ES', italy: 'IT', italia: 'IT', portugal: 'PT', netherlands: 'NL',
  holland: 'NL', poland: 'PL', polska: 'PL', turkey: 'TR', india: 'IN', australia: 'AU', arabic: 'ARAB',
  arab: 'ARAB', 'ex-yu': 'EXYU', 'ex yu': 'EXYU', africa: 'AFR', latino: 'LATAM', caribbean: 'CARIB' };
const PSEUDO_COUNTRIES = { EXYU: 'Ex-Yugoslavia', ARAB: 'Arabic', AFR: 'Africa', LATAM: 'Latin America',
  CARIB: 'Caribbean', KURD: 'Kurdish', ZZ: 'Unknown country' };
// Main channels, in the order a viewer in that country expects them.
const CURATED_MAIN = {
  UK: ['BBC One', 'BBC Two', 'ITV1', 'Channel 4', 'Channel 5', 'BBC Three', 'BBC Four', 'ITV2', 'ITV3', 'ITV4',
    'ITVBe', 'E4', 'More4', 'Film4', '5USA', '5STAR', 'Sky Showcase', 'Sky Max', 'Sky Atlantic', 'Sky Witness',
    'Sky Comedy', 'Dave', 'U&Dave', 'W', 'U&W', 'Gold', 'U&Gold', 'U&Alibi', 'U&Drama', 'U&Yesterday', 'Comedy Central', 'Quest', 'Really', 'Drama', 'Blaze', 'BBC Scotland',
    'BBC Alba', 'S4C', 'STV', 'UTV'],
  IE: ['RTE One', 'RTE2', 'Virgin Media One', 'Virgin Media Two', 'Virgin Media Three', 'TG4', 'RTEjr'],
};
const REGION_WORDS = ['london', 'scotland', 'wales', 'cymru', 'ni', 'northernireland', 'yorkshire', 'east', 'west',
  'north', 'south', 'northwest', 'northeast', 'southwest', 'southeast', 'eastmidlands', 'westmidlands', 'midlands',
  'anglia', 'granada', 'tynetees', 'meridian', 'border', 'central', 'westcountry', 'channelislands', 'oxford',
  'cambridgeshire', 'pacific', 'atlantic', 'mountain', 'eastyorkshire', 'lincolnshire', 'northeastcumbria',
  'southeast', 'southwest', 'channeltelevision', 'utv', 'stv'];
const QUALITY_ORDER = { fhd: [3, 2, 4, 1], '4k': [4, 3, 2, 1], hd: [2, 3, 1, 4], sd: [1, 2, 3, 4] };
const QUALITY_LABEL = { 1: 'SD', 2: 'HD', 3: 'FHD', 4: '4K' };

// ---------------------------------------------------------------- text helpers
function norm(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, '');
}
function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return (2 * n) / (a.size + b.size);
}
function digits(s) { return (s.match(/\d+/g) || []).join(','); }
function titleCase(s) {
  if (/[a-z]/.test(s)) return s; // already mixed case: leave it
  return s.split(' ').map(w => (w.length > 3 && /^[A-Z]+$/.test(w)) ? w[0] + w.slice(1).toLowerCase() : w).join(' ');
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function attr(s) { return String(s ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, "'"); }

// ---------------------------------------------------------------- country detection
function makeCountryResolver(countryCodes) {
  const codes = new Set(countryCodes);
  return function resolve(token) {
    if (!token) return null;
    const t = token.toUpperCase().replace(/\s+/g, '');
    if (COUNTRY_ALIASES[t]) return COUNTRY_ALIASES[t];
    if (t.length === 2 && codes.has(t)) return t;
    return null;
  };
}
const PREFIX_RE = /^\s*[\[(|{]?\s*([A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?)\s*(?:[\])|}:\-–—»>➤►▶•⋆★✪|*#/\\]+|\s[|•⋆★»➤►▶]+)\s*/u;
function countryFromText(text, resolve) {
  if (!text) return null;
  const s = text.normalize('NFKC');
  const m = s.match(PREFIX_RE);
  if (m) { const cc = resolve(m[1]); if (cc) return cc; }
  const first = s.match(/^\s*[\[(|]?\s*([A-Za-z]{2,4}(?:-[A-Za-z]{2})?)\b/);
  if (first) { const cc = resolve(first[1]); if (cc && first[1] === first[1].toUpperCase()) return cc; }
  const low = s.toLowerCase();
  for (const [w, cc] of Object.entries(COUNTRY_WORDS)) {
    if (new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(low)) return cc;
  }
  return null;
}
const SPORT_WORDS_RE = /tennis|\batp\b|\bwta\b|wimbledon|roland\s*garros|french\s*open|australian\s*open|\bus\s*open\b|davis\s*cup|\bppv\b|\bnfl\b|\bnba\b|\bnhl\b|\bmlb\b|\bufc\b|\bwwe\b|football|soccer|premier\s*league|champions\s*league|\bf1\b|formula\s*1|motogp|golf|cricket|rugby|boxing|darts|snooker|racing|\bsports?\b/i;
function categoryFromGroup(group) {
  const g = (group || '').toLowerCase();
  if (/adult|xxx|18\+|porn/.test(g)) return 'Adult';
  if (SPORT_WORDS_RE.test(g)) return 'Sports';
  if (/sport|football|soccer|nfl|nba|nhl|mlb|ppv|f1|racing|golf|tennis|boxing|ufc|wwe|cricket|rugby/.test(g)) return 'Sports';
  if (/news/.test(g)) return 'News';
  if (/kid|child|cartoon|junior|family/.test(g)) return 'Kids';
  if (/movie|cinema|film/.test(g)) return 'Movies';
  if (/music/.test(g)) return 'Music';
  if (/docu|docs|discovery|nature|history|science/.test(g)) return 'Documentary';
  if (/relig|christian|islam|quran|gospel/.test(g)) return 'Religious';
  if (/shop/.test(g)) return 'Shopping';
  if (/regional|local/.test(g)) return 'Regional';
  if (/entertain|general|variety/.test(g)) return 'Entertainment';
  return null;
}
function categoryFromCatalog(cats, nsfw) {
  const c = new Set(cats || []);
  if (nsfw || c.has('xxx')) return 'Adult';
  if (c.has('kids') || c.has('animation')) return 'Kids';
  if (c.has('sports')) return 'Sports';
  if (c.has('news') || c.has('business') || c.has('weather') || c.has('legislative')) return 'News';
  if (c.has('movies')) return 'Movies';
  if (c.has('music')) return 'Music';
  if (c.has('documentary') || c.has('science') || c.has('education') || c.has('culture')) return 'Documentary';
  if (c.has('religious')) return 'Religious';
  if (c.has('shop')) return 'Shopping';
  if (['lifestyle', 'cooking', 'travel', 'outdoor', 'auto', 'relax', 'woman', 'family'].some(x => c.has(x))) return 'Lifestyle';
  if (c.has('general') || c.has('public')) return 'Main Channels';
  if (c.size) return 'Entertainment';
  return null;
}

// ---------------------------------------------------------------- name cleaning
const JUNK_RE = /\b(?:f?hd|uhd|sd|hdr|hdr10|4k|8k|hevc|h\.?26[45]|x26[45]|\d{3,4}[pi]|\d{2,3}\s?fps|raw|vip|backup|bkp|multi(?:sub|audio)?|lq|hq|(?:low|high|medium)\s?quality|geo-?blocked)\b/gi;
const SYMBOL_RE = /[★☆✦✧✪✯⭐●◉○◆◇♦■□▪▫►▶➤➜➔»«|•·⋆✓✔⚽🔴🟢🎬⚡❤♥️]|\p{Extended_Pictographic}/gu;

function qualityOf(s) {
  if (/\b(?:4k|uhd|2160p?|8k)\b/i.test(s)) return 4;
  if (/\b(?:fhd|1080[pi]?)\b/i.test(s)) return 3;
  if (/\b(?:hd|720p?)\b/i.test(s)) return 2;
  if (/\b(?:sd|lq|480p?|576[pi]?)\b/i.test(s)) return 1;
  return 0; // not stated
}

function cleanName(raw, cc, resolve) {
  let s = String(raw || '').normalize('NFKC');
  // separator rows such as "##### UK BACKUP #####" or "======== SPORTS ========"
  const alnum = s.replace(/[^\p{L}\p{N}]/gu, '');
  if (alnum.length < 1 || (/^[\s#=*~_\-★☆✦◆•|]{3,}/u.test(s) && /[#=*~_\-★☆✦◆•|]{3,}\s*$/u.test(s))) {
    return { separator: true };
  }
  let nameCc = null;
  const m = s.match(PREFIX_RE);
  if (m && resolve(m[1])) { nameCc = resolve(m[1]); s = s.slice(m[0].length); }
  // "01. BBC One", "101 - BBC One"
  s = s.replace(/^\s*\d{1,4}\s*[.):\-]\s+/, '');
  const quality = qualityOf(s);
  const hevc = /\b(?:hevc|h\.?265|x265)\b/i.test(s);
  const backup = /\b(?:backup|bkp|alt|alternative|b\/u)\b|\(\s*(?:2|b|alt)\s*\)/i.test(s);
  // timeshift: "E4 +1", "ITV1 (+1)", "Channel 4 Plus 1"
  let timeshift = 0;
  const ts = s.match(/(?:[\s(]\+\s?(\d{1,2})\)?|\bplus\s?(\d{1,2})\b)(?=\s|$|\))/i);
  if (ts) { timeshift = Number(ts[1] || ts[2]); s = s.replace(ts[0], ' '); }
  s = s.replace(SYMBOL_RE, ' ').replace(JUNK_RE, ' ')
    .replace(/\(\s*(?:2|b|alt)\s*\)/gi, ' ').replace(/\b(?:alt|alternative)\b/gi, ' ')
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^[\s\-:|_.,/]+|[\s\-:|_.,/]+$/g, '').trim();
  // trailing country code that repeats the prefix: "BBC One UK"
  const country = nameCc || cc;
  const tail = s.match(/\s[\[(]?([A-Za-z]{2,3})[\])]?$/);
  if (tail && country && resolve(tail[1]) === country && s.split(' ').length > 1) s = s.slice(0, -tail[0].length).trim();
  s = s.replace(/^[\s\-:|_.,/]+|[\s\-:|_.,/]+$/g, '').trim();
  if (!s) return { separator: true };
  return { clean: s, nameCc, quality, hevc, backup, timeshift };
}

// ---------------------------------------------------------------- logos
// Imgur has blocked UK visitors since 2025, and most iptv-org logos live there.
function isBlockedLogo(url) { return /(^|\/\/|\.)imgur\.com\//i.test(url || ''); }
const TVLOGOS_RAW = 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/';
const TVLOGOS_EXTRA_FOLDERS = { turkey: ['TR'], nordic: ['NO', 'DK', 'SE', 'FI', 'IS'], caribbean: ['CARIB'],
  'world-africa': ['AFR'], 'world-latin-america': ['LATAM'], 'world-middle-east': ['ARAB'],
  serbia: ['EXYU'], croatia: ['EXYU'], slovenia: ['EXYU'] };
const TVLOGOS_GLOBAL = ['international', 'world-europe', 'world-asia'];
function slugify(s) {
  return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
const LOGO_ALIASES = { more4: '4more', more4plus1: '4moreplus', cbbc: 'bbccbbc', cbeebies: 'bbccbeebies' };
function logoKeys(k) {
  const out = [k];
  if (LOGO_ALIASES[k]) out.push(LOGO_ALIASES[k]);
  const t = k.replace(/(tv|channel|television|hd)$/, '');
  if (t !== k && t.length >= 2) out.push(t);
  return out;
}
// paths: ["countries/united-kingdom/bbc-one-uk.png", ...]
function buildLogoIndex(paths, countries) {
  const folderToCc = {};
  for (const c of countries || []) (folderToCc[slugify(c.name)] ||= []).push(c.code);
  for (const [f, ccs] of Object.entries(TVLOGOS_EXTRA_FOLDERS)) (folderToCc[f] ||= []).push(...ccs);
  const byCc = new Map(), global = new Map();
  for (const path of paths) {
    const m = path.match(/^countries\/([^/]+)\/([^/]+)\.png$/i);
    if (!m || /obsolete/i.test(m[2])) continue;
    const parts = m[2].toLowerCase().split('-');
    if (parts.length > 1 && /^[a-z]{2,4}$|^\d+_[a-z]+$/.test(parts[parts.length - 1])) parts.pop(); // country suffix
    const variant = parts.some(p => ['hz', 'white', 'light', 'dark', 'alt', 'mono', 'black'].includes(p));
    const clean = parts.filter(p => !['hz', 'white', 'light', 'dark', 'alt', 'mono', 'black'].includes(p));
    const key = norm(clean.join(' '));
    const targets = TVLOGOS_GLOBAL.includes(m[1]) ? [global]
      : (folderToCc[m[1]] || []).map(cc => { if (!byCc.has(cc)) byCc.set(cc, new Map()); return byCc.get(cc); });
    for (const map of targets) {
      // plain logos win over "hz"/"white" variants
      if (!variant) { if (!map.has(key) || map.get(key).variant) map.set(key, { path, variant }); }
      else if (!map.has(key)) map.set(key, { path, variant });
      for (const k of logoKeys(key).slice(1)) if (!map.has(k)) map.set(k, { path, variant });
    }
  }
  return { byCc, global };
}
function findTvLogo(idx, names, cc, timeshift) {
  if (!idx) return '';
  const maps = [idx.byCc.get(cc), idx.global].filter(Boolean);
  const keys = [];
  for (const n of names) {
    if (!n) continue;
    for (const k of logoKeys(norm(n))) {
      if (timeshift) keys.push(k + 'plus' + timeshift, k + 'plus');
      keys.push(k);
    }
  }
  for (const map of maps) for (const k of keys) { const hit = map.get(k); if (hit) return TVLOGOS_RAW + hit.path.split('/').map(encodeURIComponent).join('/'); }
  return '';
}

// ---------------------------------------------------------------- catalogue
function buildCatalog({ channels, logos, feeds, countries }) {
  const byId = new Map();
  const nameIdx = new Map();
  const feedIdx = new Map();
  const countryNames = {};
  for (const c of countries || []) countryNames[c.code] = { name: c.name, flag: c.flag || '' };
  const countryNorm = new Set();
  for (const c of countries || []) { countryNorm.add(norm(c.code)); countryNorm.add(norm(c.name)); }
  ['latam', 'dach', 'panregional', 'digital', 'europe', 'international', 'asia', 'africa', 'middleeast', 'mena',
    'nordic', 'scandinavia', 'balkans', 'cee', 'emea', 'apac', 'world', 'global'].forEach(x => countryNorm.add(x));

  for (const c of channels) {
    byId.set(c.id, { id: c.id, name: c.name, alt: c.alt_names || [], country: c.country, cats: c.categories || [],
      nsfw: !!c.is_nsfw, closed: !!c.closed, logo: '', logoScore: -1, feedLogos: {}, regions: [], langs: null });
  }
  for (const l of logos || []) {
    const c = byId.get(l.channel);
    if (!c || !l.url) continue;
    const fmt = (l.format || '').toUpperCase();
    const score = (l.in_use ? 50 : 0) + (isBlockedLogo(l.url) ? 0 : 60)
      + ({ PNG: 20, JPEG: 15, JPG: 15, WEBP: 10, SVG: 0 }[fmt] ?? 5)
      + Math.min(l.width || 0, 1000) / 100;
    if (l.feed) {
      const prev = c.feedLogos[l.feed];
      if (!prev || prev.score < score) c.feedLogos[l.feed] = { url: l.url, score };
    } else if (score > c.logoScore) { c.logo = l.url; c.logoScore = score; }
  }
  const add = (map, key, val) => { if (!key) return; const a = map.get(key); if (a) a.push(val); else map.set(key, [val]); };
  for (const c of byId.values()) for (const n of [c.name, ...c.alt]) add(nameIdx, norm(n), c);

  for (const f of feeds || []) {
    const c = byId.get(f.channel);
    if (!c) continue;
    if (f.is_main && f.languages && f.languages.length) c.langs = f.languages;
    const label = String(f.name || '').replace(/\s*\b(?:SD|HD|FHD|UHD|4K)\b\s*/gi, ' ').trim();
    const key = norm(label);
    if (!key || /^plus\d+$/.test(key) || /^\d{3,4}[pi]?$/.test(key)) continue;
    if (countryNorm.has(key)) {
      // e.g. "Discovery Channel UK": a country version, not a region
      add(feedIdx, norm(c.name) + key, { ch: c, feed: null });
      continue;
    }
    if (f.is_main) continue;
    if (!c.regions.some(r => r.key === key)) c.regions.push({ key, name: label, id: f.id });
    add(feedIdx, norm(c.name) + key, { ch: c, feed: { name: label, id: f.id } });
  }
  const byCountry = new Map();
  for (const c of byId.values()) {
    if (!byCountry.has(c.country)) byCountry.set(c.country, []);
    byCountry.get(c.country).push(c);
  }
  return { byId, nameIdx, feedIdx, byCountry, countryNames, fuzzyCache: new Map() };
}

function pickBest(list, cc) {
  if (!list || !list.length) return null;
  let best = null, bestScore = -1;
  for (const c of list) {
    const s = (c.country === cc ? 10 : 0) + (c.closed ? 0 : 3) + (c.logo ? 1 : 0);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return best;
}

// Exact and rule-based matching. Returns {ch, feed, how} or null.
function matchExact(cat, clean, cc) {
  const key = norm(clean);
  if (!key) return null;
  const exact = pickBest(cat.nameIdx.get(key), cc);
  if (exact && (exact.country === cc || !cc || !cat.byCountry.has(cc) || cat.nameIdx.get(key).length === 1)) {
    return { ch: exact, feed: null, how: 'exact' };
  }
  const feedHits = cat.feedIdx.get(key);
  if (feedHits) {
    const hit = feedHits.find(h => h.ch.country === cc) || feedHits[0];
    return { ch: hit.ch, feed: hit.feed, how: hit.feed ? 'regional' : 'exact' };
  }
  // drop a trailing "tv" / "channel" / "television"
  const trimmed = key.replace(/(tv|channel|television)$/, '');
  if (trimmed !== key && trimmed.length >= 2) {
    const t = pickBest(cat.nameIdx.get(trimmed), cc);
    if (t && (!cc || t.country === cc)) return { ch: t, feed: null, how: 'exact' };
  }
  // regional guess: "BBC One London" → BBC One + London
  for (let i = key.length - 2; i >= 2; i--) {
    const rest = key.slice(i);
    const list = cat.nameIdx.get(key.slice(0, i));
    if (!list) continue;
    const base = list.find(c => c.country === cc) || (!cc ? list[0] : null);
    if (!base) continue;
    const region = base.regions.find(r => r.key === rest || rest.startsWith(r.key));
    if (region) return { ch: base, feed: { name: region.name, id: region.id }, how: 'regional' };
    if (REGION_WORDS.includes(rest) && base.regions.length) {
      return { ch: base, feed: { name: clean.slice(clean.length - Math.max(rest.length, 2)).trim(), id: null }, how: 'regional' };
    }
  }
  if (exact) return { ch: exact, feed: null, how: 'exact', foreign: true }; // same name, other country
  return null;
}

function matchFuzzy(cat, clean, cc) {
  const key = norm(clean);
  if (!cc || key.length < 4) return null;
  let pool = cat.fuzzyCache.get(cc);
  if (!pool) {
    pool = [];
    for (const c of cat.byCountry.get(cc) || []) {
      for (const n of [c.name, ...c.alt]) {
        const k = norm(n);
        if (k.length >= 3) pool.push({ c, k, g: bigrams(k), d: digits(k) });
      }
    }
    cat.fuzzyCache.set(cc, pool);
  }
  const g = bigrams(key), d = digits(key);
  let best = null, bestScore = 0;
  for (const p of pool) {
    if (p.d !== d) continue; // "Sky Sports 1" must never become "Sky Sports 2"
    if (Math.abs(p.k.length - key.length) > Math.max(3, key.length * 0.35)) continue;
    const s = dice(g, p.g);
    if (s > bestScore) { bestScore = s; best = p.c; }
  }
  return bestScore >= 0.86 ? { ch: best, feed: null, how: 'fuzzy', score: bestScore } : null;
}

// ---------------------------------------------------------------- source parsing
function parseM3U(text) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  let epg = '';
  const head = lines[0] || '';
  const hm = head.match(/(?:url-tvg|x-tvg-url)="([^"]+)"/i);
  if (hm) epg = hm[1].split(',')[0].trim();
  let cur = null;
  for (const line of lines) {
    const l = line.trim();
    if (l.startsWith('#EXTINF')) {
      const attrs = {};
      const commaAt = findTitleComma(l);
      const meta = l.slice(0, commaAt);
      for (const m of meta.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1].toLowerCase()] = m[2];
      cur = { name: l.slice(commaAt + 1).trim(), attrs };
    } else if (l.startsWith('#EXTGRP:') && cur) {
      cur.attrs['group-title'] = cur.attrs['group-title'] || l.slice(8).trim();
    } else if (l && !l.startsWith('#') && cur) {
      out.push({
        name: cur.name || cur.attrs['tvg-name'] || '',
        group: cur.attrs['group-title'] || '',
        logo: cur.attrs['tvg-logo'] || '',
        epgId: cur.attrs['tvg-id'] || '',
        url: l,
        catchup: cur.attrs.catchup ? { type: cur.attrs.catchup, days: cur.attrs['catchup-days'] || '', source: cur.attrs['catchup-source'] || '' } : null,
      });
      cur = null;
    }
  }
  return { entries: out, epg };
}
function findTitleComma(line) {
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQ = !inQ;
    else if (line[i] === ',' && !inQ) return i;
  }
  return line.length;
}
function isLiveUrl(url) {
  return !/\/(movie|series)\//i.test(url) && !/\.(mp4|mkv|avi)(\?|$)/i.test(url);
}
function parseXtreamLink(text) {
  try {
    const u = new URL(text.trim());
    const user = u.searchParams.get('username'), pass = u.searchParams.get('password');
    if (user && pass) return { server: `${u.protocol}//${u.host}`, username: user, password: pass };
  } catch (_) { /* not a link */ }
  return null;
}
function normaliseServer(s) {
  s = String(s || '').trim();
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  const u = new URL(s);
  return `${u.protocol}//${u.host}`;
}

// ---------------------------------------------------------------- language and topic filters
const ENGLISH_CCS = new Set(['UK', 'US', 'IE', 'CA', 'AU', 'NZ']);
const NON_ENGLISH_RE = /\b(?:hindi|punjabi|urdu|tamil|telugu|bangla|bengali|gujarati|malayalam|marathi|kannada|desi|asian|arabic|arab|polish|polska|turkish|turk|kurdish|persian|farsi|somali|french|fran[cç]ais|german|deutsch|spanish|espa[nñ]ol|latino|portuguese|portugu[eê]s|italian|italiano|russian|romanian|albanian|shqip|greek|chinese|mandarin|cantonese|filipino|tagalog|vietnamese|korean|japanese|thai|nepali|sinhala|pashto|afghan|bosnian|croatian|serbian|ex-?yu|balkan|hebrew|swahili|amharic|tigrinya|yoruba|lithuanian|latvian|bulgarian|hungarian|czech|slovak|dutch|nederlands|swedish|norwegian|danish|finnish)\b/i;
const ENGLISH_RE = /\benglish\b|\beng\b/i;
const TRUE_CRIME_RE = /\bcrime\b|investigation|\bid\b(?:\s*x?tra)?$|^id\b|real\s*crime|\bmurders?\b|cbs\s*reality|\bforensic/i;
function isEnglishChannel(ch) {
  const m = ch.match;
  const text = ch.variants.map(v => `${v.name} ${v.group}`).join(' ');
  if (ch.variants.some(v => ENGLISH_RE.test(v.name))) return true; // "beIN Sports 1 English"
  if (NON_ENGLISH_RE.test(text)) return false; // the provider's own label ("UK | HINDI") wins
  // a UK copy of a pan-European channel (Eurosport 1) is the English version
  if (m && m.ch.country !== ch.cc && ENGLISH_CCS.has(ch.cc)) return true;
  if (m && m.ch.langs && m.ch.langs.length) return m.ch.langs.includes('eng');
  if (ENGLISH_RE.test(text)) return true;
  return ENGLISH_CCS.has(ch.cc);
}
function isTrueCrime(ch) {
  const names = [ch.name, ch.autoName, ...(ch.match ? [ch.match.ch.name, ...ch.match.ch.alt] : [])];
  return names.some(n => n && TRUE_CRIME_RE.test(n));
}
function wordFilter(words) {
  const list = String(words || '').split(',').map(w => w.trim().toLowerCase()).filter(Boolean);
  return list.length ? ch => list.some(w => ch.name.toLowerCase().includes(w)) : () => false;
}

// ---------------------------------------------------------------- processing
function prepareEntries(rawEntries, resolve, cat) {
  const entries = [];
  rawEntries.forEach((r, i) => {
    const groupCc = countryFromText(r.group, resolve);
    const c = cleanName(r.name, groupCc, resolve);
    if (c.separator) return;
    const e = { ...r, idx: i, clean: c.clean, quality: c.quality, hevc: c.hevc, backup: c.backup,
      timeshift: c.timeshift, groupCat: categoryFromGroup(r.group) };
    e.cc = c.nameCc || groupCc || null;
    e.baseKey = (e.cc || '') + '|' + norm(e.clean);
    e.auto = cat ? matchExact(cat, e.clean, e.cc) : null;
    if (!e.cc && e.auto) e.cc = e.auto.ch.country;
    e.cc = e.cc || 'ZZ';
    entries.push(e);
  });
  return entries;
}

// Groups entries into channels. `opts`: {countries:[], quality, regional, unmatched, backups, adult, groupNames}
function buildChannels(entries, cat, overrides, opts) {
  const selected = new Set(opts.countries);
  const ovMatch = overrides.match || {}, ovChan = overrides.chan || {};
  const map = new Map();
  for (const e of entries) {
    if (!selected.has(e.cc)) continue;
    let m;
    const om = ovMatch[e.baseKey];
    if (om === 'none') m = null;
    else if (om && cat.byId.get(om)) m = { ch: cat.byId.get(om), feed: null, how: 'manual' };
    else {
      m = e.auto;
      if ((!m || m.foreign) && !e.fuzzyDone && !opts.noFuzzy) { e.fuzzy = matchFuzzy(cat, e.clean, e.cc); e.fuzzyDone = true; }
      if (e.fuzzy && (!m || m.foreign)) m = e.fuzzy;
    }
    const base = m ? `${m.ch.id}${m.feed ? '@' + norm(m.feed.name) : ''}` : 'u:' + norm(e.clean);
    const key = `${e.cc}|${base}${e.timeshift ? '+' + e.timeshift : ''}`;
    let ch = map.get(key);
    if (!ch) {
      ch = { key, cc: e.cc, match: m, timeshift: e.timeshift, variants: [] };
      map.set(key, ch);
    }
    ch.variants.push(e);
  }
  const order = QUALITY_ORDER[opts.quality] || QUALITY_ORDER.fhd;
  const curatedRank = {};
  for (const [cc, list] of Object.entries(CURATED_MAIN)) curatedRank[cc] = new Map(list.map((n, i) => [norm(n), i]));

  const channels = [...map.values()];
  for (const ch of channels) {
    const m = ch.match;
    const ov = ovChan[ch.key] || {};
    ch.ov = ov;
    ch.variants.sort((a, b) => variantScore(a, order) - variantScore(b, order));
    const best = ch.variants[0];
    let name = m ? m.ch.name + (m.feed ? ' ' + m.feed.name : '') : titleCase(best.clean);
    if (ch.timeshift) name += ' +' + ch.timeshift;
    ch.autoName = name;
    ch.name = ov.name || name;
    const feedLogo = m && m.feed && m.feed.id && m.ch.feedLogos[m.feed.id];
    const catalogLogo = (feedLogo && feedLogo.url) || (m && m.ch.logo) || '';
    const providerLogo = ch.variants.map(v => v.logo).find(Boolean) || '';
    const tvLogo = findTvLogo(cat.tvLogos, [name.replace(/ \+\d+$/, ''), m && m.feed ? null : m && m.ch.name,
      ...(m && !m.feed ? m.ch.alt : []), best.clean], ch.cc, ch.timeshift);
    // regional version with no logo of its own: borrow the main channel's
    const mainTvLogo = m && m.feed ? findTvLogo(cat.tvLogos, [m.ch.name, ...m.ch.alt], ch.cc, ch.timeshift) : '';
    if (opts.logos === 'provider' && providerLogo) ch.autoLogo = providerLogo;
    else ch.autoLogo = [tvLogo, catalogLogo, providerLogo, mainTvLogo, m && m.feed ? m.ch.logo : ''].find(u => u && !isBlockedLogo(u)) || catalogLogo || providerLogo || '';
    ch.logo = ov.logo || ch.autoLogo;
    ch.epgId = best.epgId || ch.variants.map(v => v.epgId).find(Boolean) || (m ? m.ch.id : '');
    ch.status = !m ? 'unmatched' : m.how;
    const rank = curatedRank[ch.cc] && m ? curatedRank[ch.cc].get(norm(m.ch.name)) : undefined;
    ch.rank = rank === undefined || m.feed || ch.timeshift ? 9999 : rank;
    let catName = m ? categoryFromCatalog(m.ch.cats, m.ch.nsfw) : null;
    if (catName === 'Main Channels' && curatedRank[ch.cc] && ch.rank === 9999) catName = 'Entertainment';
    if (ch.rank !== 9999) catName = 'Main Channels';
    let groupCat = ch.variants.map(v => v.groupCat).find(Boolean);
    if (!m && SPORT_WORDS_RE.test(ch.variants.map(v => v.name).join(' '))) groupCat = 'Sports';
    if (!catName || (groupCat === 'Adult')) catName = groupCat === 'Regional' ? (catName || 'Entertainment') : (groupCat || catName);
    if (!catName) catName = 'Other';
    ch.isRegional = !!(m && m.feed) || groupCat === 'Regional';
    ch.mainKey = m && (m.feed || ch.timeshift) ? `${ch.cc}|${m.ch.id}` : null;
    ch.autoCat = catName;
    ch.cat = ov.cat || catName;
    ch.adult = ch.cat === 'Adult' || !!(m && m.ch.nsfw);
  }

  // Exclusions
  const byKey = new Map(channels.map(c => [c.key, c]));
  const userWords = wordFilter(opts.excludeWords);
  for (const ch of channels) {
    ch.english = isEnglishChannel(ch);
    ch.crime = isTrueCrime(ch);
    let reason = '';
    if (ch.adult && opts.adult) reason = 'adult';
    else if (opts.englishOnly && !ch.english) reason = 'not English';
    else if (opts.noSports && ch.cat === 'Sports') reason = 'sports';
    else if (opts.noCrime && ch.crime) reason = 'true crime';
    else if (userWords(ch)) reason = 'your words';
    else if (ch.status === 'unmatched' && !opts.unmatched) reason = 'unrecognised';
    else if ((ch.isRegional || ch.timeshift) && opts.regional === 'hide' && !ch.ov.cat) reason = 'regional';
    if (ch.ov.hidden === true) reason = 'hidden';
    if (ch.ov.hidden === false) reason = '';
    ch.excluded = reason;
    ch.out = !reason;
  }
  // Placement of regional / +1 versions
  for (const ch of channels) {
    ch.after = null;
    if (!(ch.isRegional || ch.timeshift) || ch.ov.cat) continue;
    const main = ch.mainKey && byKey.get(ch.mainKey);
    if (opts.regional === 'after' && main && main.out) { ch.after = main; ch.cat = main.cat; }
    else if (opts.regional !== 'after') ch.cat = ch.timeshift ? '+1 Channels' : 'Regional';
  }
  // Order: countries (tick order) → category → curated rank → name; "after" items follow their main
  const ccOrder = new Map(opts.countries.map((c, i) => [c, i]));
  const catOrder = new Map(CATEGORIES.map((c, i) => [c, i]));
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const cmp = (a, b) => (ccOrder.get(a.cc) - ccOrder.get(b.cc)) || (catOrder.get(a.cat) - catOrder.get(b.cat))
    || (a.rank - b.rank) || collator.compare(a.name, b.name);
  const top = channels.filter(c => !c.after).sort(cmp);
  const followers = new Map();
  for (const c of channels.filter(c => c.after)) {
    if (!followers.has(c.after.key)) followers.set(c.after.key, []);
    followers.get(c.after.key).push(c);
  }
  const ordered = [];
  for (const c of top) {
    ordered.push(c);
    const f = followers.get(c.key);
    if (f) ordered.push(...f.sort((a, b) => (a.timeshift - b.timeshift) || collator.compare(a.name, b.name)));
  }
  const multi = opts.countries.length > 1;
  let no = 0, lastCc = null;
  for (const c of ordered) {
    if (opts.perCountry && c.cc !== lastCc) { no = 0; lastCc = c.cc; }
    const showCc = opts.groupNames === 'always' || (opts.groupNames !== 'never' && multi);
    c.group = showCc ? `${countryLabelShort(c.cc)} • ${c.cat}` : c.cat;
    c.chno = c.out ? ++no : null;
  }
  return ordered;
}
// Tennis playlist: tennis channels and tournament feeds from every country, plus each
// Grand Slam's broadcasters (from tennis-rights.js). A channel can sit in several groups.
function rightsMatch(pattern, ch) {
  const wild = pattern.endsWith('*');
  const pk = norm(pattern.replace(/\*$/, ''));
  const names = [ch.name, ch.match && ch.match.ch.name, ch.variants[0].clean];
  return names.some(n => {
    if (!n) return false;
    const k = norm(n);
    if (wild) return k.startsWith(pk);
    return k === pk || (k.startsWith(pk) && /^(?:\d{1,2}|hd|fhd|uhd|4k)$/.test(k.slice(pk.length)));
  });
}
function buildTennis(entries, cat, overrides, opts, T) {
  const all = [...new Set(entries.map(e => e.cc))];
  const chans = buildChannels(entries, cat, overrides, { ...opts, countries: all, noFuzzy: true, noSports: false,
    englishOnly: false, noCrime: false, excludeWords: '', unmatched: true, regional: 'group', perCountry: false });
  const groups = new Map([['Tennis Channels', []], ...T.slams.map(s => [s, []])]);
  for (const c of chans) {
    if (c.adult || c.timeshift || (c.match && c.match.feed) || c.ov.hidden === true) continue;
    if (opts.tennisEnglish && !c.english) continue;
    const text = [c.name, ...c.variants.map(v => `${v.name} ${v.group}`)].join(' | ');
    const events = T.slams.filter(s => T.slamWords[s].test(text) && !(s === 'US Open' && /golf/i.test(text)));
    const tennis = T.tennisWords.test(text) || events.length > 0;
    const add = (g, kind) => { const list = groups.get(g); if (!list.some(x => x.c === c)) list.push({ c, kind }); };
    for (const s of events) add(s, 'event');
    if (tennis && !events.length) add('Tennis Channels', 'event');
    for (const r of T.rights) if (r.cc.includes(c.cc) && r.channels.some(p => rightsMatch(p, c))) add(r.slam, 'broadcaster');
  }
  const ccOrder = cc => { const i = opts.countries.indexOf(cc); return i >= 0 ? i : 100; };
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  const home = opts.countries[0];
  const rows = [];
  let no = 0;
  for (const [g, list] of groups) {
    list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'event' ? -1 : 1) || (ccOrder(a.c.cc) - ccOrder(b.c.cc))
      || a.c.cc.localeCompare(b.c.cc) || collator.compare(a.c.name, b.c.name));
    for (const { c, kind } of list) {
      rows.push({ ...c, name: c.cc === home ? c.name : `${c.name} (${countryLabelShort(c.cc)})`, group: g,
        chno: ++no, out: true, kind });
    }
  }
  return rows;
}
function variantScore(v, order) {
  const q = v.quality || 2;
  let s = order.indexOf(q) * 10;
  if (!v.quality) s += 2; // unstated quality is usually HD
  if (v.test === 'fail') s += 1000;
  if (v.test === 'ok') s -= 100;
  if (v.backup) s += 5;
  if (v.hevc) s += 1; // HEVC plays on fewer devices
  return s * 100000 + v.idx;
}
function countryLabelShort(cc) { return cc === 'ZZ' ? 'Other' : cc; }

function buildM3U(channels, ctx) {
  const lines = [];
  lines.push(ctx.epg ? `#EXTM3U url-tvg="${attr(ctx.epg)}" x-tvg-url="${attr(ctx.epg)}"` : '#EXTM3U');
  const emit = (c, v, name, group, chno) => {
    const url = ctx.streamUrl(v);
    let extra = '';
    if (v.archive) extra = ` catchup="xc" catchup-days="${attr(v.archive)}"`;
    else if (v.catchup) {
      extra = ` catchup="${attr(v.catchup.type)}"` + (v.catchup.days ? ` catchup-days="${attr(v.catchup.days)}"` : '')
        + (v.catchup.source ? ` catchup-source="${attr(v.catchup.source)}"` : '');
    }
    lines.push(`#EXTINF:-1 tvg-id="${attr(c.epgId)}" tvg-name="${attr(name)}" tvg-logo="${attr(c.logo)}"`
      + `${chno ? ` tvg-chno="${chno}"` : ''} group-title="${attr(group)}"${extra},${name.replace(/[\r\n]+/g, ' ')}`);
    lines.push(url);
  };
  const out = channels.filter(c => c.out);
  for (const c of out) emit(c, c.variants[0], c.name, c.group, c.chno);
  if (ctx.backups) {
    for (const c of out) {
      c.variants.slice(1).forEach((v, i) => {
        const label = QUALITY_LABEL[v.quality] || 'copy';
        emit(c, v, `${c.name} (${label} ${i + 2})`, ctx.multi ? `${countryLabelShort(c.cc)} • Backups` : 'Backups', null);
      });
    }
  }
  return lines.join('\n') + '\n';
}

if (typeof module !== 'undefined') {
  module.exports = { buildTennis, rightsMatch, isEnglishChannel, buildLogoIndex, findTvLogo, isBlockedLogo, norm, cleanName, countryFromText, makeCountryResolver, buildCatalog, matchExact, matchFuzzy,
    parseM3U, prepareEntries, buildChannels, buildM3U, parseXtreamLink, normaliseServer, isLiveUrl };
}

// =================================================================== page
if (typeof document !== 'undefined') (function page() {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const PAGE_SIZE = 150;
  const S = {
    helper: false, info: null, cat: null, catPromise: null, resolve: null,
    source: null, entries: [], epg: '', channels: [], overrides: { match: {}, chan: {} },
    page: 0, testing: false,
    opts: { countries: [], quality: 'fhd', regional: 'group', unmatched: true, backups: false, adult: true,
      groupNames: 'auto', format: 'ts', logos: 'provider', englishOnly: true, noSports: true, noCrime: true,
      excludeWords: '', perCountry: true, tennis: true, tennisEnglish: true },
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* storage blocked */ } },
  };

  function setStatus(el, html, cls = '') { el.className = 'status ' + cls; el.innerHTML = html; }
  const loadStatus = $('#load-status');

  async function getJson(url) {
    const r = await fetch(url);
    let body;
    try { body = await r.json(); } catch (_) { throw new Error(`Unexpected answer (HTTP ${r.status})`); }
    if (!r.ok) throw new Error(body && body.error ? body.error : `HTTP ${r.status}`);
    return body;
  }

  // ---------- start-up
  async function init() {
    S.opts = { ...S.opts, ...store.get('cf-settings', {}) };
    try {
      S.info = await getJson('/api/info');
      S.helper = true;
    } catch (_) { S.helper = false; }
    const note = $('#helper-note');
    if (S.helper) {
      note.innerHTML = 'Connected to the Channel Fixer helper. Your login only goes to your provider.';
      try { S.overrides = normaliseOverrides(await getJson('/api/overrides')); } catch (_) { /* first run */ }
    } else {
      note.classList.add('warn');
      note.innerHTML = 'The helper isn\'t running, so logging in to your provider won\'t work from this page '
        + '(browsers block it). Start it with <code>python3 server.py</code> and open '
        + '<code>http://localhost:8765</code>, or use the <b>M3U file</b> tab.';
      S.overrides = normaliseOverrides(store.get('cf-overrides', {}));
      $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'file'));
      $$('.tabpane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== 'file'));
    }
    const login = store.get('cf-login', null);
    if (login) {
      const f = $('#form-xtream');
      f.server.value = login.server || ''; f.username.value = login.username || '';
      f.password.value = login.password || ''; f.remember.checked = true;
    }
    bindSettings();
  }
  function normaliseOverrides(o) { return { match: (o && o.match) || {}, chan: (o && o.chan) || {} }; }
  let saveTimer = null;
  function saveOverrides() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (S.helper) fetch('/api/overrides', { method: 'POST', body: JSON.stringify(S.overrides) }).catch(() => {});
      else store.set('cf-overrides', S.overrides);
    }, 400);
  }

  // ---------- catalogue
  async function loadTvLogoPaths() {
    try {
      if (S.helper) return await getJson('/api/tvlogos');
      const tree = await getJson('https://api.github.com/repos/tv-logo/tv-logos/git/trees/main?recursive=1');
      return tree.tree.map(t => t.path).filter(p => p.startsWith('countries/') && p.endsWith('.png'));
    } catch (e) {
      console.warn('tv-logos unavailable, using catalogue logos only', e);
      return null;
    }
  }
  function loadCatalog() {
    if (!S.catPromise) {
      const base = S.helper ? '/api/iptv/' : IPTV_ORG;
      S.catPromise = Promise.all(['channels', 'logos', 'feeds', 'countries'].map(f => getJson(base + f + '.json')))
        .then(([channels, logos, feeds, countries]) => {
          S.cat = buildCatalog({ channels, logos, feeds, countries });
          S.resolve = makeCountryResolver(countries.map(c => c.code));
          return loadTvLogoPaths().then(paths => {
            if (paths) S.cat.tvLogos = buildLogoIndex(paths, countries);
            return S.cat;
          });
        })
        .catch(e => { S.catPromise = null; throw new Error('Channel catalogue: ' + e.message); });
    }
    return S.catPromise;
  }

  // ---------- sources
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x => x.classList.toggle('active', x === t));
    $$('.tabpane').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab));
  }));
  const fx = $('#form-xtream');
  fx.server.addEventListener('input', () => {
    const p = parseXtreamLink(fx.server.value);
    if (p) { fx.server.value = p.server; fx.username.value = p.username; fx.password.value = p.password; }
  });
  fx.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (!S.helper) return setStatus(loadStatus, 'Start the helper first (see the note above), or use the M3U file tab.', 'error');
    let server;
    try { server = normaliseServer(fx.server.value); } catch (_) { return setStatus(loadStatus, 'That server address doesn\'t look right.', 'error'); }
    const cred = { server, username: fx.username.value.trim(), password: fx.password.value };
    if (fx.remember.checked) store.set('cf-login', cred); else store.del('cf-login');
    await run(async () => {
      const q = a => '/api/xtream?' + new URLSearchParams({ ...cred, action: a });
      setStatus(loadStatus, 'Logging in…');
      const info = await getJson(q(''));
      if (!info || !info.user_info || String(info.user_info.auth) !== '1') throw new Error('The provider rejected that username or password.');
      setStatus(loadStatus, 'Downloading channel list and catalogue… (the first time takes a minute)');
      const [cats, streams] = await Promise.all([getJson(q('get_live_categories')), getJson(q('get_live_streams')), loadCatalog()]);
      const catName = new Map((cats || []).map(c => [String(c.category_id), c.category_name]));
      const raw = (streams || []).map(s => ({
        name: s.name || '', group: catName.get(String(s.category_id)) || '', logo: s.stream_icon || '',
        epgId: s.epg_channel_id || '', streamId: s.stream_id,
        archive: Number(s.tv_archive) === 1 && Number(s.tv_archive_duration) > 0 ? String(s.tv_archive_duration) : '',
      }));
      const epg = `${server}/xmltv.php?${new URLSearchParams({ username: cred.username, password: cred.password })}`;
      process({ kind: 'xtream', cred }, raw, epg);
    });
  });
  $('#form-url').addEventListener('submit', async ev => {
    ev.preventDefault();
    const url = ev.target.url.value.trim();
    if (!S.helper) return setStatus(loadStatus, 'Fetching a link needs the helper. Download the file and use the M3U file tab instead.', 'error');
    await run(async () => {
      setStatus(loadStatus, 'Downloading playlist and catalogue…');
      const [text] = await Promise.all([
        fetch('/api/m3u?' + new URLSearchParams({ url })).then(async r => {
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
          return r.text();
        }), loadCatalog()]);
      loadM3UText(text, parseXtreamLink(url));
    });
  });
  const fileInput = $('#file-input'), drop = $('#drop');
  fileInput.addEventListener('change', () => fileInput.files[0] && readFile(fileInput.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  function readFile(file) {
    run(async () => {
      setStatus(loadStatus, 'Reading file and downloading the catalogue…');
      const [text] = await Promise.all([file.text(), loadCatalog()]);
      loadM3UText(text, null);
    });
  }
  function loadM3UText(text, cred) {
    if (!/^\s*#EXTM3U/.test(text)) throw new Error('That doesn\'t look like an M3U playlist.');
    const { entries, epg } = parseM3U(text);
    const live = entries.filter(e => isLiveUrl(e.url));
    let epgUrl = epg;
    if (!epgUrl && cred) epgUrl = `${cred.server}/xmltv.php?${new URLSearchParams({ username: cred.username, password: cred.password })}`;
    process({ kind: 'm3u' }, live, epgUrl);
  }
  async function run(fn) {
    $$('#step-source button').forEach(b => { b.disabled = true; });
    try { await fn(); } catch (e) { setStatus(loadStatus, escapeHtml(e.message || String(e)), 'error'); console.error(e); }
    $$('#step-source button').forEach(b => { b.disabled = false; });
  }

  function process(source, raw, epg) {
    setStatus(loadStatus, `Cleaning ${raw.length.toLocaleString()} channels…`);
    S.source = source; S.epg = epg || '';
    S.entries = prepareEntries(raw, S.resolve, S.cat);
    const counts = countByCountry();
    S.opts.countries = S.opts.countries.filter(c => counts.has(c));
    if (!S.opts.countries.length) {
      // the browser's region first (en-GB → UK), otherwise the biggest country
      let region = ((navigator.language || '').split('-')[1] || '').toUpperCase();
      if (region === 'GB') region = 'UK';
      if (counts.has(region)) S.opts.countries = [region];
    }
    if (!S.opts.countries.length) {
      const top = [...counts.entries()].filter(([c]) => c !== 'ZZ').sort((a, b) => b[1] - a[1])[0];
      S.opts.countries = [top ? top[0] : 'ZZ'];
    }
    setStatus(loadStatus, `Loaded ${raw.length.toLocaleString()} channels from ${counts.size} countries.`, 'ok');
    $('#opt-format-wrap').classList.toggle('hidden', source.kind !== 'xtream');
    $('#epg-url').textContent = S.epg || 'none found (add your provider\'s EPG link in TiviMate)';
    ['#step-settings', '#step-review', '#step-export'].forEach(s => $(s).classList.remove('hidden'));
    renderCountries(false);
    rebuild();
  }
  function countByCountry() {
    const m = new Map();
    for (const e of S.entries) m.set(e.cc, (m.get(e.cc) || 0) + 1);
    return m;
  }
  function countryLabel(cc) {
    const c = S.cat && S.cat.countryNames[cc];
    return c ? `${c.flag} ${c.name}` : (PSEUDO_COUNTRIES[cc] || cc);
  }

  // ---------- settings
  let showAllCountries = false;
  function renderCountries(all) {
    showAllCountries = all;
    const counts = [...countByCountry().entries()].sort((a, b) => b[1] - a[1]);
    const shown = all ? counts : counts.filter(([c], i) => i < 24 || S.opts.countries.includes(c));
    $('#countries').innerHTML = shown.map(([cc, n]) => {
      const pos = S.opts.countries.indexOf(cc);
      return `<label class="chip ${pos >= 0 ? 'on' : ''}"><input type="checkbox" value="${escapeHtml(cc)}" ${pos >= 0 ? 'checked' : ''}>`
        + `${pos >= 0 ? `<span class="order">${pos + 1}</span>` : ''}${escapeHtml(countryLabel(cc))} <small>${n.toLocaleString()}</small></label>`;
    }).join('');
    $('#more-countries').classList.toggle('hidden', all || counts.length <= shown.length);
  }
  $('#countries').addEventListener('change', e => {
    const cc = e.target.value;
    if (e.target.checked) S.opts.countries.push(cc);
    else S.opts.countries = S.opts.countries.filter(c => c !== cc);
    renderCountries(showAllCountries);
    saveSettings(); rebuild();
  });
  $('#more-countries').addEventListener('click', () => renderCountries(true));
  function bindSettings() {
    const map = { '#opt-quality': 'quality', '#opt-regional': 'regional', '#opt-groupnames': 'groupNames', '#opt-format': 'format',
      '#opt-logos': 'logos' };
    for (const [sel, key] of Object.entries(map)) {
      $(sel).value = S.opts[key];
      $(sel).addEventListener('change', e => { S.opts[key] = e.target.value; saveSettings(); rebuild(); });
    }
    const checks = { '#opt-unmatched': 'unmatched', '#opt-backups': 'backups', '#opt-adult': 'adult',
      '#opt-english': 'englishOnly', '#opt-sports': 'noSports', '#opt-crime': 'noCrime', '#opt-percountry': 'perCountry',
      '#opt-tennis': 'tennis', '#opt-tennis-english': 'tennisEnglish' };
    $('#opt-words').value = S.opts.excludeWords || '';
    $('#opt-words').addEventListener('change', e => { S.opts.excludeWords = e.target.value; saveSettings(); rebuild(); });
    for (const [sel, key] of Object.entries(checks)) {
      $(sel).checked = !!S.opts[key];
      $(sel).addEventListener('change', e => { S.opts[key] = e.target.checked; saveSettings(); rebuild(); });
    }
  }
  function saveSettings() { store.set('cf-settings', S.opts); }

  // ---------- review
  function rebuild(keepPage) {
    if (!S.entries.length) return;
    S.channels = buildChannels(S.entries, S.cat, S.overrides, S.opts);
    if (!keepPage) S.page = 0;
    renderStats(); renderGroupFilter(); renderRows(); schedulePlaylists();
  }
  function renderStats() {
    const out = S.channels.filter(c => c.out);
    const count = f => out.filter(f).length;
    const merged = S.channels.reduce((n, c) => n + (c.out ? c.variants.length - 1 : 0), 0);
    const cards = [
      [out.length, 'channels in playlist'],
      [count(c => ['exact', 'regional', 'manual'].includes(c.status)), 'recognised'],
      [count(c => c.status === 'fuzzy'), 'guessed (check these)'],
      [count(c => c.status === 'unmatched'), 'unrecognised'],
      [merged, 'duplicate copies merged'],
      [count(c => !c.logo), 'without a logo'],
    ];
    $('#stats').innerHTML = cards.map(([n, l]) => `<div class="stat"><b>${n.toLocaleString()}</b><span>${l}</span></div>`).join('');
  }
  function renderGroupFilter() {
    const sel = $('#f-group'), cur = sel.value;
    const groups = [...new Set(S.channels.map(c => c.group))];
    sel.innerHTML = '<option value="">All groups</option>' + groups.map(g => `<option>${escapeHtml(g)}</option>`).join('');
    sel.value = groups.includes(cur) ? cur : '';
  }
  function filtered() {
    const q = norm($('#f-search').value), st = $('#f-status').value, g = $('#f-group').value;
    return S.channels.filter(c => {
      if (g && c.group !== g) return false;
      if (q && !norm(c.name).includes(q) && !c.variants.some(v => norm(v.name).includes(q))) return false;
      switch (st) {
        case 'check': return c.status === 'fuzzy' || c.status === 'unmatched';
        case 'unmatched': return c.status === 'unmatched';
        case 'fuzzy': return c.status === 'fuzzy';
        case 'merged': return c.variants.length > 1;
        case 'nologo': return !c.logo;
        case 'imgur': return isBlockedLogo(c.logo);
        case 'hidden': return c.ov.hidden === true;
        default: return true;
      }
    });
  }
  const STATUS_BADGE = {
    exact: ['ok', 'recognised'], regional: ['ok', 'regional'], manual: ['ok', 'fixed by you'],
    fuzzy: ['warn', 'guessed'], unmatched: ['bad', 'unrecognised'],
  };
  function renderRows() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    S.page = Math.min(S.page, pages - 1);
    const slice = list.slice(S.page * PAGE_SIZE, (S.page + 1) * PAGE_SIZE);
    const catOptions = c => CATEGORIES.map(k => `<option ${k === c.cat ? 'selected' : ''}>${k}</option>`).join('');
    $('#rows').innerHTML = slice.map(c => {
      const [bc, bl] = STATUS_BADGE[c.status];
      const v0 = c.variants[0];
      const variants = c.variants.map((v, i) => `<li>${escapeHtml(v.name)} <small>${escapeHtml(v.group)}</small>`
        + `${v.test === 'ok' ? ' <span class="badge ok">plays</span>' : v.test === 'fail' ? ' <span class="badge bad">failed</span>' : ''}`
        + `${i === 0 ? ' <span class="badge">used</span>' : ''}</li>`).join('');
      return `<tr data-key="${escapeHtml(c.key)}" class="${c.out ? '' : 'off'}">
        <td class="no">${c.chno || ''}</td>
        <td><div class="logo" data-act="logo" title="Click to set a logo link">${c.logo
          ? `<img loading="lazy" src="${escapeHtml(c.logo)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'none',textContent:'broken'}))">`
          : '<span class="none">no logo</span>'}</div></td>
        <td><input class="name" value="${escapeHtml(c.name)}" data-act="name" aria-label="Channel name">
          <div><span class="badge ${bc}">${bl}</span>${c.excluded ? `<span class="badge">${escapeHtml(c.excluded)}</span>` : ''}${c.variants.length > 1 ? `<span class="badge">${c.variants.length} copies</span>` : ''}</div></td>
        <td><select class="grp" data-act="cat" aria-label="Group">${catOptions(c)}</select></td>
        <td class="raw">${c.variants.length > 1
          ? `<details><summary>${escapeHtml(v0.name)}</summary><ul>${variants}</ul></details>`
          : escapeHtml(v0.name)}</td>
        <td class="actions"><button class="btn tiny" data-act="match">Match…</button>
          <button class="btn tiny" data-act="hide">${c.out ? 'Hide' : 'Show'}</button></td></tr>`;
    }).join('') || '<tr><td colspan="6" class="hint">No channels here. Tick a country above or change the filters.</td></tr>';
    const pager = $('#pager');
    pager.innerHTML = pages > 1 ? `<button class="btn tiny" data-p="${S.page - 1}" ${S.page ? '' : 'disabled'}>‹ Prev</button>`
      + `<span class="hint">Page ${S.page + 1} of ${pages} · ${list.length.toLocaleString()} channels</span>`
      + `<button class="btn tiny" data-p="${S.page + 1}" ${S.page < pages - 1 ? '' : 'disabled'}>Next ›</button>`
      : `<span class="hint">${list.length.toLocaleString()} channels</span>`;
  }
  $('#pager').addEventListener('click', e => { const p = e.target.dataset.p; if (p !== undefined) { S.page = Number(p); renderRows(); } });
  ['#f-search', '#f-status', '#f-group'].forEach(s => $(s).addEventListener('input', () => { S.page = 0; renderRows(); }));

  function chanByKey(key) { return S.channels.find(c => c.key === key); }
  function setChanOv(c, patch) {
    const cur = { ...(S.overrides.chan[c.key] || {}), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] === undefined || cur[k] === '') delete cur[k];
    if (Object.keys(cur).length) S.overrides.chan[c.key] = cur; else delete S.overrides.chan[c.key];
    saveOverrides(); rebuild(true);
  }
  $('#rows').addEventListener('change', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const c = chanByKey(tr.dataset.key); if (!c) return;
    if (e.target.dataset.act === 'name') setChanOv(c, { name: e.target.value.trim() === c.autoName ? undefined : e.target.value.trim() });
    if (e.target.dataset.act === 'cat') setChanOv(c, { cat: e.target.value === c.autoCat ? undefined : e.target.value });
  });
  $('#rows').addEventListener('click', e => {
    const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const c = chanByKey(el.closest('tr').dataset.key); if (!c) return;
    // Hide → remember "hidden"; Show → drop the flag, or force-show if a setting would still hide it
    if (el.dataset.act === 'hide') setChanOv(c, { hidden: c.out ? true : (autoReason(c) ? false : undefined) });
    if (el.dataset.act === 'logo') {
      const url = window.prompt('Paste a logo image link (leave empty to use the automatic one):', c.ov.logo || '');
      if (url !== null) setChanOv(c, { logo: url.trim() || undefined });
    }
    if (el.dataset.act === 'match') openMatch(c);
  });
  function autoReason(c) {
    if (c.adult && S.opts.adult) return 'adult';
    if (c.status === 'unmatched' && !S.opts.unmatched) return 'unrecognised';
    if ((c.isRegional || c.timeshift) && S.opts.regional === 'hide') return 'regional';
    return '';
  }

  // ---------- match dialog
  const dlg = $('#match-dialog');
  let dlgChan = null;
  function openMatch(c) {
    dlgChan = c;
    $('#md-name').textContent = c.name;
    $('#md-raw').textContent = 'Provider names: ' + c.variants.map(v => v.name).join(' · ');
    $('#md-search').value = c.variants[0].clean;
    searchCatalog();
    dlg.showModal();
    $('#md-search').focus();
  }
  function searchCatalog() {
    const q = norm($('#md-search').value);
    const box = $('#md-results');
    if (q.length < 2) { box.innerHTML = '<p class="hint">Type at least two letters.</p>'; return; }
    const hits = [];
    for (const ch of S.cat.byId.values()) {
      const names = [ch.name, ...ch.alt].map(norm);
      const exact = names.includes(q), pre = names.some(n => n.startsWith(q)), sub = names.some(n => n.includes(q));
      if (!sub) continue;
      const score = (exact ? 0 : pre ? 1 : 2) + (ch.country === dlgChan.cc ? 0 : 3) + (ch.closed ? 1 : 0);
      hits.push([score, ch]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length);
    box.innerHTML = hits.slice(0, 60).map(([, ch]) => `<button type="button" class="result" data-id="${escapeHtml(ch.id)}">
      <span class="logo">${ch.logo ? `<img loading="lazy" src="${escapeHtml(ch.logo)}" alt="" referrerpolicy="no-referrer">` : '<span class="none">no logo</span>'}</span>
      <span>${escapeHtml(ch.name)}<br><small>${escapeHtml(countryLabel(ch.country))}${ch.closed ? ' · closed' : ''} · ${escapeHtml(ch.id)}</small></span></button>`).join('')
      || '<p class="hint">Nothing found. Try a shorter name.</p>';
  }
  $('#md-search').addEventListener('input', searchCatalog);
  $('#md-results').addEventListener('click', e => {
    const b = e.target.closest('.result'); if (!b) return;
    setMatch(b.dataset.id); dlg.close();
  });
  $('#md-unmatch').addEventListener('click', () => setMatch('none'));
  $('#md-reset').addEventListener('click', () => setMatch(undefined));
  function setMatch(id) {
    const old = dlgChan;
    for (const v of old.variants) { if (id === undefined) delete S.overrides.match[v.baseKey]; else S.overrides.match[v.baseKey] = id; }
    saveOverrides(); rebuild(true);
  }

  // ---------- stream test
  function streamUrl(v) {
    if (S.source.kind === 'xtream') {
      const { server, username, password } = S.source.cred;
      return `${server}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${v.streamId}.${S.opts.format}`;
    }
    return v.url;
  }
  $('#btn-test').addEventListener('click', async () => {
    const st = $('#test-status');
    if (S.testing) { S.testing = false; return; }
    if (!S.helper) return setStatus(st, 'Testing streams needs the helper (python3 server.py).', 'error');
    const todo = S.channels.filter(c => c.out && c.variants.length > 1 && !c.variants.some(v => v.test === 'ok'));
    if (!todo.length) return setStatus(st, 'Nothing to test: no merged channels left without a working copy.', 'ok');
    S.testing = true; $('#btn-test').textContent = 'Stop testing';
    let done = 0, fixed = 0;
    for (const c of todo) {
      if (!S.testing) break;
      setStatus(st, `Testing ${escapeHtml(c.name)}… (${done}/${todo.length}). One stream at a time, so your provider's connection limit isn't hit.<progress max="${todo.length}" value="${done}"></progress>`);
      for (const v of c.variants) {
        if (!S.testing || v.test === 'fail') continue;
        try {
          const r = await getJson('/api/probe?' + new URLSearchParams({ url: streamUrl(v) }));
          v.test = r.ok ? 'ok' : 'fail';
        } catch (_) { v.test = 'fail'; }
        await new Promise(r => setTimeout(r, 400));
        if (v.test === 'ok') { if (v !== c.variants[0]) fixed++; break; }
      }
      done++;
    }
    S.testing = false; $('#btn-test').textContent = 'Test streams';
    setStatus(st, `Tested ${done} channels. ${fixed} switched to a copy that plays.`, 'ok');
    rebuild(true);
  });

  // ---------- unrecognised list (names and groups only, never the login or stream links)
  $('#btn-export-unrec').addEventListener('click', () => {
    const rows = S.channels.filter(c => c.status === 'unmatched' || c.status === 'fuzzy');
    const lines = ['status\tcleaned name\tprovider name\tprovider group'];
    for (const c of rows) for (const v of c.variants) {
      lines.push([c.status === 'fuzzy' ? 'guessed: ' + c.name : 'unrecognised', v.clean, v.name, v.group]
        .map(x => String(x).replace(/[\t\r\n]+/g, ' ')).join('\t'));
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'channel-fixer-unrecognised.txt' });
    document.body.appendChild(a); a.click(); a.remove();
    setStatus($('#test-status'), `Saved ${rows.length.toLocaleString()} channels to channel-fixer-unrecognised.txt.`, 'ok');
  });

  // ---------- export: one playlist per country (or one for all) plus the Tennis playlist
  function makePlaylists() {
    const lists = [];
    const cs = S.opts.countries;
    if (S.opts.perCountry && cs.length > 1) {
      for (const cc of cs) {
        lists.push({ id: playlistId(cc), title: countryLabel(cc), multi: false,
          channels: buildChannels(S.entries, S.cat, S.overrides, { ...S.opts, countries: [cc], perCountry: false }) });
      }
    } else if (cs.length) {
      lists.push({ id: cs.length === 1 ? playlistId(cs[0]) : 'all', title: cs.length === 1 ? countryLabel(cs[0]) : 'All my countries',
        multi: cs.length > 1, channels: S.channels });
    }
    if (S.opts.tennis && window.TENNIS_RIGHTS) {
      lists.push({ id: 'tennis', title: '🎾 Tennis', multi: false, tennis: true,
        channels: buildTennis(S.entries, S.cat, S.overrides, S.opts, window.TENNIS_RIGHTS) });
    }
    for (const l of lists) {
      l.count = l.channels.filter(c => c.out).length;
      l.file = `${l.id}.m3u`;
      l.text = () => buildM3U(l.channels, { epg: S.epg, streamUrl, backups: S.opts.backups && !l.tennis, multi: l.multi });
    }
    return lists;
  }
  function playlistId(cc) { return cc === 'ZZ' ? 'other' : cc.toLowerCase(); }
  let plTimer = null;
  function schedulePlaylists() { clearTimeout(plTimer); plTimer = setTimeout(renderPlaylists, 250); }
  function renderPlaylists() {
    if (!S.entries.length) return;
    S.playlists = makePlaylists();
    const link = l => S.shareBase ? `<code>${escapeHtml(S.shareBase)}/playlists/${escapeHtml(l.file)}</code>` : '';
    $('#playlists').innerHTML = S.playlists.map(l => `<div class="playlist">
      <span><b>${escapeHtml(l.title)}</b> <small>${l.count.toLocaleString()} channels</small><br>${link(l)}</span>
      <button class="btn" data-dl="${escapeHtml(l.id)}">Download</button></div>`).join('')
      || '<p class="hint">Tick at least one country.</p>';
    const tennis = S.playlists.find(l => l.tennis);
    $('#tennis-preview').classList.toggle('hidden', !tennis);
    if (tennis) {
      const groups = new Map();
      for (const c of tennis.channels) { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c.name); }
      $('#tennis-list').innerHTML = [...groups].map(([g, names]) => `<h4>${escapeHtml(g)} (${names.length})</h4><p>${escapeHtml(names.join(' · '))}</p>`).join('')
        || '<p>No tennis channels or Grand Slam broadcasters were found in your list.</p>';
    }
  }
  const exportStatus = $('#export-status');
  $('#playlists').addEventListener('click', e => {
    const id = e.target.dataset.dl; if (!id) return;
    const l = S.playlists.find(x => x.id === id); if (!l) return;
    const blob = new Blob([l.text()], { type: 'audio/x-mpegurl' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `channel-fixer-${l.file}` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus(exportStatus, `Saved ${l.count.toLocaleString()} channels to channel-fixer-${escapeHtml(l.file)}.`, 'ok');
  });
  $('#btn-publish').addEventListener('click', async () => {
    if (!S.helper) return setStatus(exportStatus, 'Sharing needs the helper running with --lan.', 'error');
    try {
      const files = {};
      for (const l of S.playlists || []) files[l.file] = l.text();
      const r = await fetch('/api/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) });
      if (!r.ok) throw new Error((await r.json()).error);
      const info = await getJson('/api/info');
      if (info.lan && info.ips.length) {
        S.shareBase = `http://${info.ips[0]}:${info.port}`;
        renderPlaylists();
        setStatus(exportStatus, 'Shared. In TiviMate, add each link above as its own M3U playlist. Keep this computer and the helper running; when you click Share again, TiviMate picks up the changes the next time it refreshes.', 'ok');
      } else {
        setStatus(exportStatus, 'Saved, but the helper isn\'t open to your home network. Restart it with <code>python3 server.py --lan</code> and click this again.', 'error');
      }
    } catch (e) { setStatus(exportStatus, escapeHtml(e.message), 'error'); }
  });
  $('#copy-epg').addEventListener('click', () => { if (S.epg) navigator.clipboard.writeText(S.epg).catch(() => {}); });
  $('#btn-overrides-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S.overrides, null, 1)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'channel-fixer-fixes.json' });
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('#overrides-import').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const o = normaliseOverrides(JSON.parse(await f.text()));
      Object.assign(S.overrides.match, o.match); Object.assign(S.overrides.chan, o.chan);
      saveOverrides(); rebuild(true);
      setStatus(exportStatus, 'Fixes restored.', 'ok');
    } catch (_) { setStatus(exportStatus, 'That file isn\'t a Channel Fixer backup.', 'error'); }
  });

  init();
})();
