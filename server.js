// XRT Buyer Finder - main server file
'use strict';

const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Data directory setup ────────────────────────────────────────────────────
const DATA_BASE = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_DIR = path.join(DATA_BASE, 'buyer-finder');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');
const TEMP_DIR = path.join(DATA_DIR, 'temp');

const FILES = {
  buyers: path.join(DATA_DIR, 'buyers.json'),
  searches: path.join(DATA_DIR, 'searches.json'),
  outreach: path.join(DATA_DIR, 'outreach.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  tokens: path.join(DATA_DIR, 'gmail-tokens.json'),
  lookup_job: path.join(DATA_DIR, 'lookup_job.json'),
};

function ensureDirs() {
  [DATA_DIR, PHOTOS_DIR, TEMP_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function readJSON(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {}
  return fallback;
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function initDataFiles() {
  ensureDirs();
  if (!fs.existsSync(FILES.buyers)) writeJSON(FILES.buyers, { buyers: [] });
  if (!fs.existsSync(FILES.searches)) writeJSON(FILES.searches, { searches: [] });
  if (!fs.existsSync(FILES.outreach)) writeJSON(FILES.outreach, { outreach: [] });
  if (!fs.existsSync(FILES.settings)) writeJSON(FILES.settings, { thresholds: [], version: '1.0.0' });
}

// ─── Change 1: Seed Nova Biomedical buyers on startup ────────────────────────
function seedNovaBiomedicalBuyers() {
  const db = readJSON(FILES.buyers, { buyers: [] });
  const today = new Date().toISOString();

  // Step 1 — remove Nova Biomedical buyers sourced from web_research only
  // Preserves manual_research seeds and any manually added buyers with deal history
  const before = db.buyers.length;
  db.buyers = db.buyers.filter(b => {
    const isNova = (b.categories || []).some(c => c.brand.toLowerCase() === 'nova biomedical');
    if (!isNova) return true;
    return b.source === 'manual_research' || b.source === 'manual';
  });
  const removed = before - db.buyers.length;
  console.log(`[SEED] Removed ${removed} web-research Nova Biomedical buyers (manual records preserved)`);

  // Step 2 — seed confirmed buyers if not already present by company_name
  const seeds = [
    {
      id: 'buyer_seed_1',
      company_name: 'Diamond Diagnostics',
      website: 'https://diamonddiagnostics.com',
      email: '',
      phone: '',
      contact_name: '',
      categories: [{ brand: 'Nova Biomedical', item_type: 'blood gas analyzer', notes: 'One of the largest stocking distributors of blood gas analyzers globally. Explicitly purchases surplus and decommissioned Nova Biomedical equipment. Handles decontamination and removal.', minimum_threshold: 3 }],
      deal_history: [],
      status: 'active',
      source: 'manual_research',
      date_added: today,
      last_contacted: null,
      contact_count: 0,
      tags: ['medical', 'lab equipment', 'blood gas'],
    },
    {
      id: 'buyer_seed_2',
      company_name: 'EquipNet',
      website: 'https://equipnet.com',
      email: '',
      phone: '',
      contact_name: '',
      categories: [{ brand: 'Nova Biomedical', item_type: 'blood gas analyzer', notes: 'Global provider of preowned equipment. Explicitly lists Nova Biomedical as a brand they handle. Offers consignment and direct purchase. Contact via equipnet.com/sell-equipment', minimum_threshold: 3 }],
      deal_history: [],
      status: 'active',
      source: 'manual_research',
      date_added: today,
      last_contacted: null,
      contact_count: 0,
      tags: ['medical', 'lab equipment', 'industrial'],
    },
    {
      id: 'buyer_seed_3',
      company_name: 'Arc Scientific',
      website: 'https://arcscientific.com',
      email: 'sales@arcscientific.com',
      phone: '+1-857-237-5813',
      contact_name: '',
      categories: [{ brand: 'Nova Biomedical', item_type: 'blood gas analyzer', notes: 'Already has pHOx Ultra listings. Actively buys and sells used lab equipment globally. Known Nova Biomedical specialist.', minimum_threshold: 3 }],
      deal_history: [],
      status: 'active',
      source: 'manual_research',
      date_added: today,
      last_contacted: null,
      contact_count: 0,
      tags: ['medical', 'lab equipment', 'blood gas'],
    },
    {
      id: 'buyer_seed_4',
      company_name: 'Surplus Solutions',
      website: 'https://ssllc.com',
      email: '',
      phone: '',
      contact_name: '',
      categories: [{ brand: 'Nova Biomedical', item_type: 'blood gas analyzer', notes: 'Explicitly lists Nova Biomedical equipment. Buys surplus lab equipment directly. Has dedicated Nova Biomedical page on website.', minimum_threshold: 3 }],
      deal_history: [],
      status: 'active',
      source: 'manual_research',
      date_added: today,
      last_contacted: null,
      contact_count: 0,
      tags: ['medical', 'lab equipment'],
    },
    {
      id: 'buyer_seed_5',
      company_name: 'Tekyard',
      website: 'https://tekyard.com',
      email: '',
      phone: '',
      contact_name: '',
      categories: [{ brand: 'Nova Biomedical', item_type: 'blood gas analyzer', notes: 'Already has Nova Biomedical pHOx Ultra REF 42014 in inventory. Knows this model specifically and may want more units.', minimum_threshold: 3 }],
      deal_history: [],
      status: 'active',
      source: 'manual_research',
      date_added: today,
      last_contacted: null,
      contact_count: 0,
      tags: ['medical', 'lab equipment', 'blood gas'],
    },
  ];

  let added = 0;
  for (const seed of seeds) {
    const exists = db.buyers.some(b => b.company_name.toLowerCase() === seed.company_name.toLowerCase());
    if (!exists) { db.buyers.push(seed); added++; }
  }
  writeJSON(FILES.buyers, db);
  console.log(`[SEED] Added ${added} Nova Biomedical seed buyers`);
}

initDataFiles();
seedNovaBiomedicalBuyers();

// ─── Multer ──────────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (_, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

// ─── Gmail OAuth ─────────────────────────────────────────────────────────────
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || 'https://buyer-finder.onrender.com/auth/callback';
const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.compose', 'https://www.googleapis.com/auth/gmail.send'];

function makeOAuth2Client() {
  return new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI);
}

function loadTokens() { return readJSON(FILES.tokens, null); }
function saveTokens(tokens) { writeJSON(FILES.tokens, tokens); }

async function getAuthClient() {
  const tokens = loadTokens();
  if (!tokens) return null;
  const oauth2 = makeOAuth2Client();
  oauth2.setCredentials(tokens);
  oauth2.on('tokens', (newTokens) => {
    const current = loadTokens() || {};
    saveTokens({ ...current, ...newTokens });
  });
  try {
    if (tokens.expiry_date && tokens.expiry_date < Date.now() + 60000) {
      const { credentials } = await oauth2.refreshAccessToken();
      saveTokens({ ...tokens, ...credentials });
      oauth2.setCredentials({ ...tokens, ...credentials });
    }
    return oauth2;
  } catch (_) { return null; }
}

// ─── OpenRouter / Gemini Flash helper ────────────────────────────────────────
async function callOpenRouter(messages, system, tools, maxTokens = 4096) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const allMessages = system ? [{ role: 'system', content: system }, ...messages] : messages;
  const body = { model: 'google/gemini-2.5-flash', max_tokens: maxTokens, messages: allMessages };
  if (tools && tools.length) body.tools = tools;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://buyer-finder.onrender.com',
        'X-Title': 'XRT Buyer Finder',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        console.log('[OPENROUTER] Status:', res.statusCode);
        if (res.statusCode !== 200) console.log('[OPENROUTER] Error body:', raw.slice(0, 300));
        try {
          const parsed = JSON.parse(raw);
          parsed._httpStatus = res.statusCode;
          resolve(parsed);
        } catch (e) { reject(new Error('Invalid JSON from OpenRouter')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function extractTextFromResponse(resp) {
  if (!resp || !resp.choices || !resp.choices[0]) return '';
  const msg = resp.choices[0].message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  }
  return '';
}

function parseJSONSafe(text) {
  try { return JSON.parse(text); } catch (_) {}
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) { try { return JSON.parse(match[1].trim()); } catch (_) {} }
  const arrIdx = text.indexOf('[');
  const objIdx = text.indexOf('{');
  let idx = -1;
  if (arrIdx !== -1 && objIdx !== -1) idx = Math.min(arrIdx, objIdx);
  else if (arrIdx !== -1) idx = arrIdx;
  else if (objIdx !== -1) idx = objIdx;
  if (idx !== -1) { try { return JSON.parse(text.slice(idx)); } catch (_) {} }
  return null;
}

// ─── Change 2: URL normalization ─────────────────────────────────────────────
function normalizeWebsite(url) {
  if (!url || typeof url !== 'string') return url || '';
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    const normalized = u.protocol + '//' + u.hostname;
    if (normalized !== url && url.length > normalized.length) {
      console.log(`[BUYERS] Normalized URL: ${url} → ${normalized}`);
    }
    return normalized;
  } catch (_) { return url; }
}

// ─── Buyer search logic ──────────────────────────────────────────────────────
function getThreshold(brand, itemType) {
  const settings = readJSON(FILES.settings, { thresholds: [] });
  const key = `${brand.toLowerCase()}|${itemType.toLowerCase()}`;
  const found = (settings.thresholds || []).find(t => t.key === key);
  return found ? found.value : 3;
}

function getExistingBuyers(brand, itemType) {
  const db = readJSON(FILES.buyers, { buyers: [] });
  return db.buyers.filter(b => {
    if (b.status !== 'active') return false;
    return (b.categories || []).some(c =>
      c.brand.toLowerCase() === brand.toLowerCase() &&
      c.item_type.toLowerCase() === itemType.toLowerCase()
    );
  });
}

function saveBuyersToDb(newBuyers, brand, itemType) {
  const db = readJSON(FILES.buyers, { buyers: [] });
  let added = 0;
  for (const nb of newBuyers) {
    const existing = db.buyers.find(b =>
      b.company_name.toLowerCase() === (nb.company_name || '').toLowerCase()
    );
    if (existing) {
      // Change 1: merge new category into existing record, never duplicate
      const hasCat = (existing.categories || []).some(c =>
        c.brand.toLowerCase() === brand.toLowerCase() &&
        c.item_type.toLowerCase() === itemType.toLowerCase()
      );
      if (!hasCat) {
        existing.categories = existing.categories || [];
        existing.categories.push({ brand, item_type: itemType, notes: nb.evidence || '', minimum_threshold: 3 });
        console.log(`[BUYERS] Added category ${brand}/${itemType} to existing buyer: ${existing.company_name}`);
      }
      // Change 2: normalize/update website if existing has a path-specific URL
      if (nb.website) {
        const normalized = normalizeWebsite(nb.website);
        const existingNorm = normalizeWebsite(existing.website || '');
        if (!existing.website || (existing.website !== existingNorm)) {
          existing.website = normalized;
        }
      }
    } else {
      // Change 2: normalize website on new buyer creation
      const website = normalizeWebsite(nb.website || '');
      db.buyers.push({
        id: `buyer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        company_name: nb.company_name || 'Unknown',
        contact_name: nb.contact_name || '',
        email: nb.email || '',
        phone: nb.phone || '',
        website,
        categories: [{ brand, item_type: itemType, notes: nb.evidence || '', minimum_threshold: 3 }],
        deal_history: [],
        status: 'active',
        source: 'web_research',
        date_added: new Date().toISOString(),
        last_contacted: null,
        contact_count: 0,
        tags: [],
      });
      added++;
    }
  }
  writeJSON(FILES.buyers, db);
  return added;
}

// ─── Contact info lookup ─────────────────────────────────────────────────────
const GOOGLE_SEARCH_TOOL = [{
  type: 'openrouter:web_search',
  parameters: { engine: 'native', max_results: 5, search_context_size: 'medium' },
}];

async function lookupBuyerContact(companyName, website) {
  try {
    // Call 1: search — no JSON requirement, just gather facts
    const searchResp = await callOpenRouter(
      [{ role: 'user', content: `Search for contact information for the US-based company "${companyName}". Their website is ${website || 'unknown'}. Find their contact email address (especially any buying/purchasing department email), phone number, and contact page URL. Summarize everything you find. Only proceed if this appears to be a US-based company.` }],
      `You are a researcher finding contact information for US-based equipment buying companies. Search their website and any available sources. Report all contact details you find.`,
      GOOGLE_SEARCH_TOOL,
      1024
    );
    const research = extractTextFromResponse(searchResp);
    if (!research) return null;
    console.log(`[CONTACT] Research for ${companyName}: ${research.slice(0, 200)}…`);

    // Call 2: parse — no tools, extract JSON from research
    const parseResp = await callOpenRouter(
      [{ role: 'user', content: `Based on this research about ${companyName}:\n\n${research}\n\nExtract the contact information and return ONLY a JSON object with these fields: { "email": string or null, "phone": string or null, "contact_page": string or null }. No explanation, just the JSON object.` }],
      `Extract structured contact information from research text. Return only valid JSON.`,
      null,
      256
    );
    const text = extractTextFromResponse(parseResp);
    const parsed = parseJSONSafe(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    console.error(`[CONTACT] Lookup error for ${companyName}:`, err.message);
    return null;
  }
}

// ─── Change 3: Improved web search prompt + Change 4 contact lookup ──────────
async function runWebSearch(brand, itemType) {
  const angles = [
    `"we buy" used ${brand} ${itemType} equipment`,
    `sell used ${brand} ${itemType} surplus dealer`,
    `${brand} ${itemType} refurbisher buyer cash offer`,
    `${itemType} surplus equipment buyer ${brand} direct purchase`,
    `${brand} equipment broker "sell your" used`,
  ];

  const allBuyers = new Map();
  let consecutiveEmpty = 0;

  for (let i = 0; i < angles.length; i++) {
    if (consecutiveEmpty >= 3 || allBuyers.size >= 15) break;
    const angle = angles[i];
    console.log(`[SEARCH] Angle ${i + 1}: ${angle}`);

    try {
      // Call 1: search — gather research, no JSON requirement
      const searchResp = await callOpenRouter(
        [{ role: 'user', content: `Search for companies that PURCHASE used ${brand} ${itemType} equipment. Use this search query: "${angle}". For each company you find that buys this equipment, report: company name, their own website URL (not a marketplace), any email or phone, and specific evidence they buy equipment (quote from their site).` }],
        `You are a researcher finding wholesale buyers for used specialty equipment inside the United States. Search for US-based businesses that actively purchase surplus equipment. Focus on finding companies with "We Buy" pages, surplus dealers, refurbishers, and equipment brokers. Exclude marketplaces like eBay, DOTmed, LabX, Machinio. Report all qualifying US-based buyers you find with their details. IMPORTANT: Only include companies headquartered in the United States. Do not include companies based in other countries including Japan, UK, Germany, Canada, Australia, or anywhere outside the US. If a company is foreign-based, skip it entirely.`,
        GOOGLE_SEARCH_TOOL,
        2048
      );

      console.log(`[SEARCH] Angle ${i + 1} — finish_reason: ${searchResp.choices?.[0]?.finish_reason}`);
      if (searchResp.error) console.log(`[SEARCH] Angle ${i + 1} API error:`, JSON.stringify(searchResp.error));

      const research = extractTextFromResponse(searchResp);
      console.log(`[SEARCH] Angle ${i + 1} research:\n---\n${research.slice(0, 600)}${research.length > 600 ? '\n…(truncated)' : ''}\n---`);

      if (!research) { consecutiveEmpty++; continue; }

      // Call 2: parse — extract JSON from research, no tools
      const parseResp = await callOpenRouter(
        [{ role: 'user', content: `Based on this research about companies that buy used ${brand} ${itemType} equipment:\n\n${research}\n\nExtract all qualifying buyer companies into a JSON array. Each entry must have: company_name, website (company's own domain only, never dotmed/labx/machinio/ebay), email (or null), phone (or null), evidence (quote proving they buy equipment). Exclude any marketplace listing pages. Only extract US-based companies — skip any company that appears to be headquartered outside the United States. A US company will have a US address, US phone number (+1 or area code format), or a .com domain with US contact information. Return ONLY the JSON array, no explanation. If none qualify, return [].` }],
        `Extract structured buyer company data from research text. Return only a valid JSON array. Only include US-headquartered companies.`,
        null,
        1024
      );

      const text = extractTextFromResponse(parseResp);
      console.log(`[SEARCH] Angle ${i + 1} parsed text:\n---\n${text.slice(0, 400)}${text.length > 400 ? '\n…' : ''}\n---`);

      const parsed = parseJSONSafe(text);
      console.log(`[SEARCH] Angle ${i + 1} parsed: ${Array.isArray(parsed) ? 'array[' + parsed.length + ']' : typeof parsed}`);

      const rawCompanies = Array.isArray(parsed) ? parsed : (parsed && parsed.companies ? parsed.companies : []);

      // Normalize field names — AI may use "name" instead of "company_name"
      const companies = rawCompanies.map(c => ({
        company_name: c.company_name || c.name || c.company || '',
        website: c.website || c.url || c.site || '',
        email: c.email || c.contact_email || '',
        phone: c.phone || c.telephone || c.contact_phone || '',
        evidence: c.evidence || c.notes || c.description || '',
      }));

      if (companies.length > 0) {
        console.log(`[SEARCH] Angle ${i + 1} first company keys: ${Object.keys(rawCompanies[0]).join(', ')}`);
      }

      let newThisAngle = 0;
      for (const c of companies) {
        if (!c.company_name) continue;
        const key = c.company_name.toLowerCase().trim();
        if (!allBuyers.has(key)) {
          allBuyers.set(key, c);
          newThisAngle++;
        }
      }

      if (newThisAngle === 0) consecutiveEmpty++;
      else consecutiveEmpty = 0;

      console.log(`[SEARCH] Angle ${i + 1} found ${newThisAngle} new buyers (total: ${allBuyers.size})`);
    } catch (err) {
      console.error(`[SEARCH] Angle ${i + 1} error:`, err.message);
      consecutiveEmpty++;
    }
  }

  const results = Array.from(allBuyers.values());
  console.log(`[SEARCH] Found ${results.length} total buyers for ${brand} ${itemType}`);
  return results;
}

// ─── AI item identification ──────────────────────────────────────────────────
async function identifyItem(photoBuffers, brand, model, itemType) {
  try {
    const images = photoBuffers.slice(0, 3).map(buf => ({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${buf.toString('base64')}` },
    }));
    const resp = await callOpenRouter(
      [{ role: 'user', content: [...images, { type: 'text', text: `Identify this equipment. User says brand: "${brand}", model: "${model}", type: "${itemType}". Return JSON: { brand, model, item_type, condition, description, what_included }` }] }],
      'You are an expert equipment appraiser. Identify the item with precision.',
      null, 1024
    );
    const text = extractTextFromResponse(resp);
    return parseJSONSafe(text) || { brand, model, item_type: itemType };
  } catch (_) { return { brand, model, item_type: itemType }; }
}

// ─── Gmail draft creation ────────────────────────────────────────────────────
function makeEmailBody(buyer, opts) {
  const { brand, model, itemType, quantity, condition, notes } = opts;
  const lines = [
    `Hello ${buyer.company_name},`,
    '',
    `My name is Kendall Gattison with Xtreme Electronic Recycling based in Clovis, CA. I came across ${buyer.company_name} while researching buyers for the equipment described below and wanted to reach out directly.`,
    '',
    'EQUIPMENT AVAILABLE:',
    `Brand: ${brand}`,
    `Model: ${model || 'N/A'}`,
    `Type: ${itemType}`,
    `Quantity: ${quantity}`,
    `Condition: ${condition}`,
  ];
  if (notes) { lines.push(''); lines.push(notes); }
  lines.push('', 'Please see the attached photos for visual reference. We are open to offers and looking to move this equipment promptly.', '', 'If this is something you purchase, please reply or reach me at:', 'Email: kendall@xtremeelectronicrecycling.com', '', 'Thank you for your time.', '', 'Kendall Gattison', 'Xtreme Electronic Recycling', 'Clovis, CA');
  return lines.join('\n');
}

function buildMimeMessage(to, subject, body, attachments) {
  const boundary = `boundary_${Date.now()}`;
  const lines = [];
  lines.push(`To: ${to || ''}`);
  lines.push(`Subject: ${subject}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: quoted-printable');
  lines.push('');
  lines.push(body);
  for (const att of attachments) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${att.mimeType}; name="${att.filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
    lines.push('');
    lines.push(att.data.toString('base64').replace(/.{76}/g, '$&\n'));
  }
  lines.push(`--${boundary}--`);
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

async function createGmailDraft(auth, buyer, opts, photoBuffers) {
  const gmail = google.gmail({ version: 'v1', auth });
  const subject = `${opts.brand} ${opts.model || opts.itemType} Available - ${opts.quantity} Unit${opts.quantity > 1 ? 's' : ''} | Xtreme Electronic Recycling`;
  const body = makeEmailBody(buyer, opts);
  const attachments = photoBuffers.map((buf, i) => ({ filename: `photo_${i + 1}.jpg`, mimeType: 'image/jpeg', data: buf }));
  const raw = buildMimeMessage(buyer.email || '', subject, body, attachments);
  const res = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
  return res.data.id;
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Routes ──────────────────────────────────────────────────────────────────
app.get('/ping', (_, res) => res.json({ ok: true }));

// Gmail OAuth
app.get('/auth', (_, res) => {
  const oauth2 = makeOAuth2Client();
  const url = oauth2.generateAuthUrl({ access_type: 'offline', scope: GMAIL_SCOPES, prompt: 'consent' });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.redirect('/?error=no_code');
  try {
    const oauth2 = makeOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    saveTokens(tokens);
    res.redirect('/?gmail=connected');
  } catch (err) {
    console.error('[AUTH] Callback error:', err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/auth/status', async (_, res) => {
  try {
    const auth = await getAuthClient();
    if (!auth) return res.json({ connected: false });
    const gmail = google.gmail({ version: 'v1', auth });
    const profile = await gmail.users.getProfile({ userId: 'me' });
    res.json({ connected: true, email: profile.data.emailAddress });
  } catch (_) { res.json({ connected: false }); }
});

app.get('/auth/disconnect', (_, res) => {
  try { fs.unlinkSync(FILES.tokens); } catch (_) {}
  res.json({ ok: true });
});

// ─── Change 2: Async background search ───────────────────────────────────────
app.post('/api/search', upload.array('photos', 5), async (req, res) => {
  try {
    const { brand, item_type, model, quantity, condition, notes } = req.body;
    if (!brand || !item_type) return res.status(400).json({ error: 'brand and item_type required' });

    const searchId = `search_${Date.now()}`;
    const photoBuffers = (req.files || []).map(f => f.buffer);

    // Save initial processing record and return 202 immediately
    const searches = readJSON(FILES.searches, { searches: [] });
    searches.searches.unshift({
      id: searchId,
      brand,
      item_type,
      model: model || '',
      quantity: parseInt(quantity) || 1,
      condition: condition || '',
      notes: notes || '',
      search_date: new Date().toISOString(),
      status: 'processing',
      buyers: [],
      from_cache: false,
    });
    writeJSON(FILES.searches, searches);

    console.log(`[SEARCH] ${searchId} queued`);
    res.status(202).json({ search_id: searchId, status: 'processing' });

    // Run full pipeline in background
    (async () => {
      try {
        // AI identification (non-blocking)
        let identification = null;
        if (photoBuffers.length > 0) {
          try {
            const compressed = await Promise.all(
              photoBuffers.map(buf => sharp(buf).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer())
            );
            identification = await identifyItem(compressed, brand, model, item_type);
          } catch (_) {}
        }

        const threshold = getThreshold(brand, item_type);
        const existing = getExistingBuyers(brand, item_type);
        let buyers;
        let fromCache = false;

        if (existing.length >= threshold) {
          console.log(`[SEARCH] ${searchId} using ${existing.length} existing buyers — threshold met`);
          buyers = existing;
          fromCache = true;
        } else {
          console.log(`[SEARCH] ${searchId} only ${existing.length} existing (threshold ${threshold}) — running web search`);
          const found = await runWebSearch(brand, item_type);
          console.log(`[SEARCH] ${searchId} web search returned ${found.length} companies`);

          if (found.length > 0) {
            const added = saveBuyersToDb(found, brand, item_type);
            console.log(`[SEARCH] ${searchId} saved ${added} new buyers to db`);

            // Change 4: contact lookup for newly found buyers with no contact info
            const db = readJSON(FILES.buyers, { buyers: [] });
            for (const nb of found) {
              if (!nb.email && !nb.phone && nb.website) {
                await new Promise(r => setTimeout(r, 1000));
                try {
                  const contact = await lookupBuyerContact(nb.company_name, nb.website);
                  if (contact && (contact.email || contact.phone)) {
                    const rec = db.buyers.find(b => b.company_name.toLowerCase() === nb.company_name.toLowerCase());
                    if (rec) {
                      if (contact.email) { rec.email = contact.email; console.log(`[CONTACT] Found email for ${nb.company_name}: ${contact.email}`); }
                      if (contact.phone) { rec.phone = contact.phone; console.log(`[CONTACT] Found phone for ${nb.company_name}: ${contact.phone}`); }
                    }
                  } else {
                    console.log(`[CONTACT] No contact info found for ${nb.company_name}`);
                  }
                } catch (err) {
                  console.error(`[CONTACT] Error for ${nb.company_name}:`, err.message);
                }
              }
            }
            writeJSON(FILES.buyers, db);
          }
          buyers = getExistingBuyers(brand, item_type);
        }

        // Update search record with results
        const db2 = readJSON(FILES.searches, { searches: [] });
        const rec = db2.searches.find(s => s.id === searchId);
        if (rec) {
          rec.status = 'complete';
          rec.buyers = buyers;
          rec.from_cache = fromCache;
          rec.buyers_found = buyers.length;
          rec.identification = identification;
          rec.completed_at = new Date().toISOString();
        }
        writeJSON(FILES.searches, db2);
        console.log(`[SEARCH] ${searchId} complete — ${buyers.length} buyers`);
      } catch (err) {
        console.error(`[SEARCH] ${searchId} failed:`, err.message);
        try {
          const db2 = readJSON(FILES.searches, { searches: [] });
          const rec = db2.searches.find(s => s.id === searchId);
          if (rec) { rec.status = 'failed'; rec.error = err.message; }
          writeJSON(FILES.searches, db2);
        } catch (_) {}
      }
    })();

  } catch (err) {
    console.error('[SEARCH] Queue error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Poll endpoint for search status
app.get('/api/search/:search_id', (req, res) => {
  try {
    const db = readJSON(FILES.searches, { searches: [] });
    const rec = db.searches.find(s => s.id === req.params.search_id);
    if (!rec) return res.status(404).json({ error: 'Search not found' });
    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buyers
app.get('/api/buyers', (req, res) => {
  try {
    const db = readJSON(FILES.buyers, { buyers: [] });
    let buyers = db.buyers;
    const { brand, item_type, status } = req.query;
    if (status && status !== 'all') buyers = buyers.filter(b => b.status === status);
    if (brand) buyers = buyers.filter(b => (b.categories || []).some(c => c.brand.toLowerCase().includes(brand.toLowerCase())));
    if (item_type) buyers = buyers.filter(b => (b.categories || []).some(c => c.item_type.toLowerCase().includes(item_type.toLowerCase())));
    res.json({ buyers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Change 6: CSV export
app.get('/api/buyers/export', (req, res) => {
  try {
    const db = readJSON(FILES.buyers, { buyers: [] });
    const buyers = db.buyers || [];
    const today = new Date().toISOString().slice(0, 10);
    const headers = ['First Name', 'Last Name', 'Company', 'Email', 'Phone', 'Website', 'Tags', 'Brand Categories', 'Notes', 'Date Added', 'Last Contacted', 'Deal Count', 'Status'];
    const escCsv = v => {
      const s = String(v || '');
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = buyers.map(b => {
      const cats = (b.categories || []).map(c => `${c.brand} - ${c.item_type}`).join(' | ');
      const notes = (b.categories || []).map(c => c.notes).filter(Boolean).slice(-1)[0] || '';
      return [
        '', // First Name
        '', // Last Name
        b.company_name,
        b.email || '',
        b.phone || '',
        b.website || '',
        (b.tags || []).join(', '),
        cats,
        notes,
        (b.date_added || '').slice(0, 10),
        (b.last_contacted || '').slice(0, 10),
        (b.deal_history || []).length,
        b.status || '',
      ].map(escCsv).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="xrt-buyers-${today}.csv"`);
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/buyers', (req, res) => {
  try {
    const db = readJSON(FILES.buyers, { buyers: [] });
    const buyer = {
      id: `buyer_${Date.now()}`,
      company_name: req.body.company_name || 'Unknown',
      contact_name: req.body.contact_name || '',
      email: req.body.email || '',
      phone: req.body.phone || '',
      website: req.body.website || '',
      categories: req.body.categories || [],
      deal_history: [],
      status: 'active',
      source: 'manual',
      date_added: new Date().toISOString(),
      last_contacted: null,
      contact_count: 0,
      tags: req.body.tags || [],
    };
    db.buyers.push(buyer);
    writeJSON(FILES.buyers, db);
    res.json({ buyer });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/buyers/:id', (req, res) => {
  try {
    const db = readJSON(FILES.buyers, { buyers: [] });
    const idx = db.buyers.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Buyer not found' });
    db.buyers[idx] = { ...db.buyers[idx], ...req.body, id: req.params.id };
    writeJSON(FILES.buyers, db);
    res.json({ buyer: db.buyers[idx] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/buyers/:id/deal', (req, res) => {
  try {
    const db = readJSON(FILES.buyers, { buyers: [] });
    const buyer = db.buyers.find(b => b.id === req.params.id);
    if (!buyer) return res.status(404).json({ error: 'Buyer not found' });
    buyer.deal_history = buyer.deal_history || [];
    buyer.deal_history.push({
      date: new Date().toISOString().slice(0, 10),
      item: req.body.item || '',
      outcome: req.body.outcome || '',
      amount: req.body.amount || '',
      notes: req.body.notes || '',
    });
    buyer.last_contacted = new Date().toISOString();
    buyer.contact_count = (buyer.contact_count || 0) + 1;
    writeJSON(FILES.buyers, db);
    res.json({ buyer });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Outreach job queue helpers ───────────────────────────────────────────────
function readOutreachDb() { return readJSON(FILES.outreach, { outreach: [] }); }

function updateOutreachJob(outreachId, updater) {
  const db = readOutreachDb();
  const rec = db.outreach.find(o => o.id === outreachId);
  if (rec) { updater(rec); writeJSON(FILES.outreach, db); }
}

// Outreach / bulk Gmail drafts — background job with polling
const outreachUpload = upload.array('photos', 5);
app.post('/api/outreach', (req, res, next) => {
  if (req.is('multipart/form-data')) return outreachUpload(req, res, next);
  next();
}, async (req, res) => {
  try {
    const auth = await getAuthClient();
    if (!auth) return res.status(401).json({ error: 'Gmail not connected. Please connect at /auth' });

    let { buyer_ids, brand, model, item_type, quantity, condition, notes, search_id } = req.body;
    const ids = typeof buyer_ids === 'string' ? JSON.parse(buyer_ids) : (Array.isArray(buyer_ids) ? buyer_ids : []);

    // Resolve photos — multipart files OR base64 JSON array
    let photoBuffers;
    if (req.files && req.files.length > 0) {
      photoBuffers = req.files.map(f => f.buffer);
    } else if (Array.isArray(req.body.photos) && req.body.photos.length > 0) {
      photoBuffers = req.body.photos.map(b64 => {
        const clean = b64.replace(/^data:image\/[^;]+;base64,/, '');
        return Buffer.from(clean, 'base64');
      });
    } else {
      photoBuffers = [];
    }

    // If item details missing, look up from search record
    if ((!brand || !item_type) && search_id) {
      const searchDb = readJSON(FILES.searches, { searches: [] });
      const sr = searchDb.searches.find(s => s.id === search_id);
      if (sr) {
        brand = brand || sr.brand;
        model = model || sr.model;
        item_type = item_type || sr.item_type;
        quantity = quantity || sr.quantity;
        condition = condition || sr.condition;
        notes = notes || sr.notes;
      }
    }

    const outreachId = `outreach_${Date.now()}`;
    const tempPhotoDir = path.join(TEMP_DIR, outreachId);

    // Save photos to per-job temp dir so they survive background processing
    const photoPaths = [];
    if (photoBuffers.length > 0) {
      fs.mkdirSync(tempPhotoDir, { recursive: true });
      for (let i = 0; i < photoBuffers.length; i++) {
        const p = path.join(tempPhotoDir, `photo_${i + 1}.jpg`);
        fs.writeFileSync(p, photoBuffers[i]);
        photoPaths.push(p);
      }
    }

    // Save job record immediately
    const db = readOutreachDb();
    const jobRecord = {
      id: outreachId,
      status: 'processing',
      brand: brand || '',
      item_type: item_type || '',
      model: model || '',
      quantity: parseInt(quantity) || 1,
      condition: condition || '',
      notes: notes || '',
      buyer_ids: ids,
      photo_paths: photoPaths,
      results: [],
      gmail_draft_ids: [],
      created_at: new Date().toISOString(),
    };
    db.outreach.unshift(jobRecord);
    writeJSON(FILES.outreach, db);

    console.log(`[OUTREACH] ${outreachId} queued — ${ids.length} buyers`);
    res.status(202).json({ outreach_id: outreachId, status: 'processing', total: ids.length });

    // Process drafts in background
    (async () => {
      try {
        const opts = { brand: brand || '', model: model || '', itemType: item_type || '', quantity: parseInt(quantity) || 1, condition: condition || '', notes: notes || '' };
        // Re-load photo buffers from saved paths
        const savedBuffers = photoPaths.map(p => fs.readFileSync(p));

        for (const buyerId of ids) {
          const buyersDb = readJSON(FILES.buyers, { buyers: [] });
          const buyer = buyersDb.buyers.find(b => b.id === buyerId);
          if (!buyer) {
            updateOutreachJob(outreachId, rec => {
              rec.results.push({ buyer_id: buyerId, company_name: 'Unknown', success: false, error: 'Buyer not found' });
            });
            continue;
          }
          try {
            const draftId = await createGmailDraft(auth, buyer, opts, savedBuffers);
            buyer.last_contacted = new Date().toISOString();
            buyer.contact_count = (buyer.contact_count || 0) + 1;
            writeJSON(FILES.buyers, buyersDb);
            updateOutreachJob(outreachId, rec => {
              rec.results.push({ buyer_id: buyerId, company_name: buyer.company_name, success: true, draft_id: draftId });
              rec.gmail_draft_ids.push(draftId);
            });
            console.log(`[DRAFT] Created for ${buyer.company_name}: ${draftId}`);
          } catch (err) {
            console.error(`[DRAFT] Failed for ${buyer.company_name}:`, err.message);
            updateOutreachJob(outreachId, rec => {
              rec.results.push({ buyer_id: buyerId, company_name: buyer.company_name, success: false, error: err.message });
            });
          }
        }

        // Mark complete
        updateOutreachJob(outreachId, rec => {
          rec.status = 'complete';
          rec.completed_at = new Date().toISOString();
          rec.draft_created = rec.gmail_draft_ids.length > 0;
        });
        console.log(`[OUTREACH] ${outreachId} complete`);
      } catch (err) {
        console.error(`[OUTREACH] ${outreachId} crashed:`, err.message);
        updateOutreachJob(outreachId, rec => { rec.status = 'failed'; rec.error = err.message; });
      } finally {
        // Clean up temp photos after job completes
        try { if (fs.existsSync(tempPhotoDir)) fs.rmSync(tempPhotoDir, { recursive: true }); } catch(_) {}
      }
    })();

  } catch (err) {
    console.error('[OUTREACH] Queue error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Poll outreach job status
app.get('/api/outreach/:outreach_id', (req, res) => {
  try {
    const db = readOutreachDb();
    const rec = db.outreach.find(o => o.id === req.params.outreach_id);
    if (!rec) return res.status(404).json({ error: 'Outreach job not found' });
    res.json(rec);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/outreach', (_, res) => {
  try { res.json(readOutreachDb()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Change 3: Bulk contact lookup ───────────────────────────────────────────
app.get('/api/buyers/lookup-contacts/status', (_, res) => {
  try {
    if (!fs.existsSync(FILES.lookup_job)) return res.json({ status: 'idle' });
    res.json(readJSON(FILES.lookup_job, { status: 'idle' }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/buyers/lookup-contacts', async (req, res) => {
  try {
    const db = readJSON(FILES.buyers, { buyers: [] });
    const targets = db.buyers.filter(b => !b.email && !b.phone && b.status === 'active');
    const job = { status: 'processing', total: targets.length, completed: 0, found: 0, results: [], started_at: new Date().toISOString() };
    writeJSON(FILES.lookup_job, job);
    console.log(`[CONTACT] Bulk lookup started — ${targets.length} buyers to check`);
    res.status(202).json({ status: 'processing', total: targets.length });

    (async () => {
      try {
        for (const buyer of targets) {
          await new Promise(r => setTimeout(r, 1000));
          let found = false;
          try {
            const contact = await lookupBuyerContact(buyer.company_name, buyer.website || '');
            if (contact && (contact.email || contact.phone)) {
              const freshDb = readJSON(FILES.buyers, { buyers: [] });
              const rec = freshDb.buyers.find(b => b.id === buyer.id);
              if (rec) {
                if (contact.email) { rec.email = contact.email; console.log(`[CONTACT] Found email for ${buyer.company_name}: ${contact.email}`); }
                if (contact.phone) { rec.phone = contact.phone; console.log(`[CONTACT] Found phone for ${buyer.company_name}: ${contact.phone}`); }
                writeJSON(FILES.buyers, freshDb);
              }
              found = true;
            } else {
              console.log(`[CONTACT] No contact info found for ${buyer.company_name}`);
            }
          } catch (err) {
            console.error(`[CONTACT] Error for ${buyer.company_name}:`, err.message);
          }
          const j = readJSON(FILES.lookup_job, job);
          j.completed++;
          if (found) j.found++;
          j.results.push({ buyer_id: buyer.id, company_name: buyer.company_name, found, email: buyer.email || '', phone: buyer.phone || '' });
          writeJSON(FILES.lookup_job, j);
        }
        const j = readJSON(FILES.lookup_job, job);
        j.status = 'complete';
        j.completed_at = new Date().toISOString();
        writeJSON(FILES.lookup_job, j);
        console.log(`[CONTACT] Bulk lookup complete — ${j.found} of ${j.total} found`);
      } catch (err) {
        console.error('[CONTACT] Bulk lookup crashed:', err.message);
        try {
          const j = readJSON(FILES.lookup_job, job);
          j.status = 'complete';
          j.error = err.message;
          writeJSON(FILES.lookup_job, j);
        } catch (_) {}
      }
    })();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/settings', (_, res) => {
  try { res.json(readJSON(FILES.settings, { thresholds: [] })); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.patch('/api/settings', (req, res) => {
  try {
    const current = readJSON(FILES.settings, { thresholds: [] });
    const updated = { ...current, ...req.body };
    writeJSON(FILES.settings, updated);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Main HTML page ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const gmailConnected = req.query.gmail === 'connected' ? 'true' : '';
  const authError = req.query.error || '';

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>XRT Buyer Finder</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Montserrat',sans-serif;background:#121212;color:#e0e0e0;min-height:100vh}
:root{--green:#4DB748;--gold:#FCB616;--dark:#1a1a1a;--card:#1e1e1e;--border:#2a2a2a;--input:#252525}
a{color:var(--green);text-decoration:none}a:hover{text-decoration:underline}
.header{background:#000;border-bottom:2px solid var(--gold);padding:14px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.header h1{font-size:1.4rem;font-weight:700;color:#fff;letter-spacing:1px}
.header h1 span{color:var(--gold)}
.badge{padding:4px 12px;border-radius:20px;font-size:.75rem;font-weight:600;cursor:pointer}
.badge.connected{background:#1a3a1a;color:var(--green);border:1px solid var(--green)}
.badge.disconnected{background:#3a1a1a;color:#f44;border:1px solid #f44}
.header-right{margin-left:auto;display:flex;gap:8px;align-items:center}
.tabs{display:flex;background:#111;border-bottom:1px solid var(--border);overflow-x:auto}
.tab{padding:14px 24px;cursor:pointer;font-size:.85rem;font-weight:600;color:#777;border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s}
.tab:hover{color:#ccc}.tab.active{color:var(--green);border-bottom-color:var(--green)}
.content{max-width:1100px;margin:0 auto;padding:24px 16px}
.panel{display:none}.panel.active{display:block}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:20px;margin-bottom:16px}
.card h3{font-size:1rem;font-weight:600;margin-bottom:14px;color:#fff}
label{display:block;font-size:.8rem;color:#aaa;margin-bottom:5px;font-weight:500}
input,select,textarea{width:100%;background:var(--input);border:1px solid var(--border);border-radius:6px;padding:10px 12px;color:#e0e0e0;font-family:inherit;font-size:.9rem;outline:none;transition:border .2s}
input:focus,select:focus,textarea:focus{border-color:var(--green)}
textarea{resize:vertical;min-height:80px}
.form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}
.form-group{margin-bottom:14px}
.btn{padding:10px 20px;border-radius:6px;border:none;cursor:pointer;font-family:inherit;font-size:.9rem;font-weight:600;transition:all .2s}
.btn-green{background:var(--green);color:#000}.btn-green:hover{background:#5dcf57}
.btn-gold{background:var(--gold);color:#000}.btn-gold:hover{background:#ffc53d}
.btn-outline{background:transparent;border:1px solid var(--border);color:#ccc}.btn-outline:hover{border-color:#aaa;color:#fff}
.btn-red{background:#c0392b;color:#fff}.btn-red:hover{background:#e74c3c}
.btn-full{width:100%;padding:14px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.photo-upload{border:2px dashed var(--border);border-radius:8px;padding:24px;text-align:center;cursor:pointer;transition:border .2s}
.photo-upload:hover{border-color:var(--green)}.photo-upload input{display:none}
.thumbnails{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.thumbnail{width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}
.status-bar{background:#1a2a1a;border:1px solid var(--green);border-radius:6px;padding:12px 16px;margin-bottom:16px;font-size:.85rem;color:var(--green);display:none}
.status-bar.show{display:block}.status-bar.error{background:#2a1a1a;border-color:#f44;color:#f44}
.buyer-card{background:#161616;border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:10px}
.buyer-card.selected{border-color:var(--green)}
.buyer-header{display:flex;align-items:flex-start;gap:12px}
.buyer-check{width:20px;height:20px;accent-color:var(--green);margin-top:2px;flex-shrink:0;cursor:pointer}
.buyer-name{font-size:.95rem;font-weight:700;color:#fff}
.buyer-meta{font-size:.78rem;color:#888;margin-top:3px}.buyer-meta a{color:var(--green)}
.tag{display:inline-block;background:#1e2e1e;color:var(--green);border:1px solid #2a4a2a;padding:2px 8px;border-radius:10px;font-size:.7rem;margin:2px}
.tag.deal{background:#2a2a1a;color:var(--gold);border-color:#3a3a2a}
.evidence{font-size:.78rem;color:#aaa;margin-top:6px;font-style:italic}
.results-actions{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.count-badge{background:#1a2a1a;color:var(--green);padding:6px 14px;border-radius:20px;font-size:.82rem;font-weight:600}
.pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:600}
.pill.active{background:#1a3a1a;color:var(--green)}.pill.inactive{background:#2a2a2a;color:#777}
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:1000;display:none;align-items:center;justify-content:center}
.modal-overlay.show{display:flex}
.modal{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:24px;width:90%;max-width:520px;max-height:90vh;overflow-y:auto}
.modal h3{margin-bottom:16px;font-size:1rem;color:#fff}
.modal-actions{display:flex;gap:10px;margin-top:20px;justify-content:flex-end}
.outreach-card{background:#161616;border:1px solid var(--border);border-radius:8px;padding:16px;margin-bottom:10px}
.outreach-card h4{font-size:.95rem;font-weight:700;color:#fff}
.outreach-meta{font-size:.78rem;color:#888;margin-top:4px}
.step-label{font-size:.75rem;font-weight:700;color:var(--gold);letter-spacing:.5px;margin-bottom:8px;text-transform:uppercase}
.loader{display:inline-block;width:16px;height:16px;border:2px solid #333;border-top-color:var(--green);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}
.progress-item{padding:8px 0;border-bottom:1px solid var(--border);font-size:.85rem;display:flex;align-items:center;gap:8px}
.progress-item:last-child{border-bottom:none}
.pi-ok{color:var(--green)}.pi-fail{color:#f66}.pi-pending{color:#aaa}
.settings-table td:first-child{font-weight:600;color:#ccc}
.inline-edit{background:var(--input);border:1px solid var(--border);border-radius:4px;padding:4px 8px;width:60px;color:#e0e0e0;font-family:inherit;text-align:center}
.flash{padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:.85rem;font-weight:500}
.flash.success{background:#1a3a1a;border:1px solid var(--green);color:var(--green)}
.flash.error{background:#3a1a1a;border:1px solid #f44;color:#f44}
.empty-state{text-align:center;padding:40px 20px;color:#555}
.search-spinner{text-align:center;padding:32px 0;color:#aaa;font-size:.9rem}
.search-spinner .big-loader{width:36px;height:36px;border-width:3px;margin:0 auto 12px;display:block}
@media(max-width:600px){.form-row{grid-template-columns:1fr}}
</style>
</head>
<body>

<div class="header">
  <h1>XRT <span>Buyer</span> Finder</h1>
  <div class="header-right">
    <span id="gmailBadge" class="badge disconnected" onclick="checkGmailStatus()">⚡ Connect Gmail</span>
    <button class="btn btn-outline" style="padding:6px 12px;font-size:.78rem" onclick="window.location='/auth'">Connect</button>
  </div>
</div>

<div id="flashBar" style="display:none;padding:0 16px"></div>

<div class="tabs">
  <div class="tab active" onclick="showTab('search',this)">New Search</div>
  <div class="tab" onclick="showTab('buyers',this)">Buyer Database</div>
  <div class="tab" onclick="showTab('outreach',this)">Outreach History</div>
  <div class="tab" onclick="showTab('settings',this)">Settings</div>
</div>

<!-- ─── TAB 1: New Search ──────────────────────────────────────────────────── -->
<div id="tab-search" class="panel active">
<div class="content">
  <div id="searchStatus" class="status-bar"></div>

  <div class="card">
    <div class="step-label">Step 1 — Item Details</div>
    <div class="form-row">
      <div class="form-group">
        <label>Brand <span style="color:#f44">*</span></label>
        <input id="s-brand" type="text" placeholder="e.g. Nova Biomedical, Zebra, Cisco">
      </div>
      <div class="form-group">
        <label>Item Type <span style="color:#f44">*</span></label>
        <input id="s-type" type="text" placeholder="e.g. blood gas analyzer, label printer, network switch">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Model / Part Number</label>
        <input id="s-model" type="text" placeholder="e.g. pHOx Ultra REF 42014, ZM400">
      </div>
      <div class="form-group">
        <label>Quantity <span style="color:#f44">*</span></label>
        <input id="s-qty" type="number" min="1" value="1">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Condition <span style="color:#f44">*</span></label>
        <select id="s-condition">
          <option value="Tested Working">Tested Working</option>
          <option value="Untested/As-Is">Untested / As-Is</option>
          <option value="For Parts">For Parts</option>
        </select>
      </div>
      <div class="form-group">
        <label>Additional Notes</label>
        <input id="s-notes" type="text" placeholder="e.g. removed from hospital service, includes all accessories">
      </div>
    </div>
  </div>

  <div class="card">
    <div class="step-label">Step 2 — Photos (up to 5)</div>
    <div class="photo-upload" onclick="document.getElementById('photoInput').click()">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#555" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
      <div style="color:#666;font-size:.85rem;margin-top:8px">Click to upload photos · JPEG, PNG, WEBP</div>
      <input type="file" id="photoInput" multiple accept="image/*" onchange="handlePhotos(this)">
    </div>
    <div id="thumbnails" class="thumbnails"></div>
  </div>

  <button id="findBtn" class="btn btn-green btn-full" onclick="runSearch()">Find Buyers →</button>

  <div id="searchingPanel" style="display:none;margin-top:20px">
    <div class="search-spinner">
      <span class="loader big-loader"></span>
      <div id="searchMsg">Checking buyer database...</div>
    </div>
  </div>

  <div id="resultsPanel" style="display:none;margin-top:20px">
    <div class="results-actions">
      <span id="buyerCount" class="count-badge">0 buyers found</span>
      <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;color:#aaa;cursor:pointer;margin:0">
        <input type="checkbox" id="selectAllChk" onchange="selectAllToggle(this)" style="width:auto;accent-color:var(--green)"> Select All
      </label>
      <button id="draftBtn" class="btn btn-gold" onclick="createDrafts()" style="margin-left:auto" disabled>
        Create Gmail Drafts for Selected
      </button>
    </div>
    <div id="buyerList"></div>
  </div>
</div>
</div>

<!-- ─── TAB 2: Buyer Database ──────────────────────────────────────────────── -->
<div id="tab-buyers" class="panel">
<div class="content">
  <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
    <input id="db-search" type="text" placeholder="Search by company, brand, item type…" style="flex:1;min-width:200px" oninput="loadBuyerDb()">
    <select id="db-status" onchange="loadBuyerDb()" style="width:150px">
      <option value="all">All Statuses</option>
      <option value="active">Active</option>
      <option value="inactive">Inactive</option>
    </select>
    <button class="btn btn-outline" onclick="window.location='/api/buyers/export'">Export CSV</button>
    <button class="btn btn-outline" onclick="startBulkContactLookup()" id="lookupContactsBtn">🔍 Find Missing Contacts</button>
    <button class="btn btn-gold" id="contactSelectedBtn" onclick="openOutreachModal()" disabled>Contact Selected</button>
    <button class="btn btn-green" onclick="openAddBuyer()">+ Add Buyer</button>
  </div>

  <!-- Bulk contact lookup modal -->
  <div id="lookupModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:center;justify-content:center">
    <div style="background:#1a1a1a;border:1px solid #333;border-radius:8px;padding:28px 32px;min-width:420px;max-width:560px;max-height:80vh;display:flex;flex-direction:column;gap:16px">
      <div style="font-size:1.1rem;font-weight:700;color:#4DB748">🔍 Finding Missing Contacts</div>
      <div id="lookupProgress" style="color:#aaa;font-size:.9rem">Starting...</div>
      <div style="background:#111;border-radius:6px;height:8px;overflow:hidden">
        <div id="lookupBar" style="height:100%;background:#4DB748;width:0%;transition:width .4s"></div>
      </div>
      <div id="lookupResults" style="overflow-y:auto;max-height:260px;font-size:.82rem;display:flex;flex-direction:column;gap:6px"></div>
      <button class="btn btn-outline" id="lookupCloseBtn" style="display:none" onclick="closeLookupModal()">Close & Refresh</button>
    </div>
  </div>
  <div id="buyerDbList"></div>
</div>
</div>

<!-- ─── TAB 3: Outreach History ─────────────────────────────────────────────── -->
<div id="tab-outreach" class="panel">
<div class="content">
  <div id="outreachList"></div>
</div>
</div>

<!-- ─── TAB 4: Settings ─────────────────────────────────────────────────────── -->
<div id="tab-settings" class="panel">
<div class="content">
  <div class="card">
    <h3>Gmail Connection</h3>
    <div id="gmailSettingsStatus" style="margin-bottom:14px;font-size:.85rem;color:#aaa">Checking…</div>
    <div style="display:flex;gap:10px">
      <button class="btn btn-green" onclick="window.location='/auth'">Connect / Reconnect Gmail</button>
      <button class="btn btn-outline" onclick="disconnectGmail()">Disconnect</button>
    </div>
  </div>
  <div class="card">
    <h3>Category Thresholds</h3>
    <p style="font-size:.82rem;color:#777;margin-bottom:14px">Minimum buyers required before skipping online search. Default: 3.</p>
    <div id="thresholdsTable"></div>
    <button class="btn btn-green" style="margin-top:14px" onclick="saveThresholds()">Save Thresholds</button>
  </div>
  <div class="card">
    <h3>About</h3>
    <table class="settings-table">
      <tr><td>Version</td><td>1.1.0</td></tr>
      <tr><td>Data Directory</td><td>${DATA_DIR.replace(/\\/g, '/')}</td></tr>
      <tr><td>Storage</td><td>Persistent disk at /data/buyer-finder/</td></tr>
    </table>
  </div>
</div>
</div>

<!-- ─── Modals ──────────────────────────────────────────────────────────────── -->
<div id="modalOverlay" class="modal-overlay" onclick="if(event.target===this)closeModal()">
  <div class="modal" id="modalContent"></div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
let selectedPhotos = [];
let searchResults = [];
let currentSearchMeta = {};
let currentSearchId = null;
let pollTimer = null;
let dbSelectedIds = new Set();
let connectedEmail = '';
let outreachPhotos = [];
let outreachBuyerIds = [];

// ── Tab switching ──────────────────────────────────────────────────────────
function showTab(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'buyers') loadBuyerDb();
  if (name === 'outreach') loadOutreach();
  if (name === 'settings') loadSettings();
}

// ── Flash ──────────────────────────────────────────────────────────────────
function flash(msg, type='success') {
  const bar = document.getElementById('flashBar');
  bar.innerHTML = '<div class="flash ' + type + '">' + msg + '</div>';
  bar.style.display = 'block';
  setTimeout(() => { bar.style.display = 'none'; }, 6000);
}

// ── Gmail ──────────────────────────────────────────────────────────────────
async function checkGmailStatus() {
  try {
    const r = await fetch('/auth/status').then(r => r.json());
    const badge = document.getElementById('gmailBadge');
    const statusEl = document.getElementById('gmailSettingsStatus');
    if (r.connected) {
      connectedEmail = r.email || '';
      badge.className = 'badge connected';
      badge.textContent = '✓ Gmail: ' + r.email;
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">✓ Connected as ' + r.email + '</span>';
    } else {
      connectedEmail = '';
      badge.className = 'badge disconnected';
      badge.textContent = '⚡ Connect Gmail';
      if (statusEl) statusEl.innerHTML = '<span style="color:#f66">Not connected</span>';
    }
  } catch(_) {}
}

async function disconnectGmail() {
  await fetch('/auth/disconnect');
  checkGmailStatus();
  flash('Gmail disconnected', 'error');
}

// ── Photos ─────────────────────────────────────────────────────────────────
function handlePhotos(input) {
  selectedPhotos = Array.from(input.files).slice(0, 5);
  const container = document.getElementById('thumbnails');
  container.innerHTML = '';
  selectedPhotos.forEach(f => {
    const img = document.createElement('img');
    img.className = 'thumbnail';
    img.src = URL.createObjectURL(f);
    container.appendChild(img);
  });
}

// ── Search (Change 2: async polling) ──────────────────────────────────────
function setStatus(msg, isError) {
  const el = document.getElementById('searchStatus');
  el.textContent = msg;
  el.className = 'status-bar show' + (isError ? ' error' : '');
}

const STATUS_MSGS = [
  'Checking buyer database...',
  'Searching online for buyers...',
  'Analyzing results...',
  'Searching online for buyers...',
  'Compiling buyer list...',
];
let msgIdx = 0;
let msgTimer = null;

function startStatusCycle() {
  msgIdx = 0;
  document.getElementById('searchMsg').textContent = STATUS_MSGS[0];
  msgTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % STATUS_MSGS.length;
    document.getElementById('searchMsg').textContent = STATUS_MSGS[msgIdx];
  }, 4000);
}

function stopStatusCycle() {
  if (msgTimer) { clearInterval(msgTimer); msgTimer = null; }
}

async function runSearch() {
  const brand = document.getElementById('s-brand').value.trim();
  const itemType = document.getElementById('s-type').value.trim();
  const model = document.getElementById('s-model').value.trim();
  const qty = document.getElementById('s-qty').value.trim();
  const condition = document.getElementById('s-condition').value;
  const notes = document.getElementById('s-notes').value.trim();

  if (!brand || !itemType) { flash('Brand and Item Type are required.', 'error'); return; }

  currentSearchMeta = { brand, model, itemType, quantity: qty, condition, notes };

  document.getElementById('findBtn').disabled = true;
  document.getElementById('resultsPanel').style.display = 'none';
  document.getElementById('searchingPanel').style.display = 'block';
  document.getElementById('searchStatus').className = 'status-bar';
  startStatusCycle();

  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

  try {
    const fd = new FormData();
    fd.append('brand', brand);
    fd.append('item_type', itemType);
    fd.append('model', model);
    fd.append('quantity', qty);
    fd.append('condition', condition);
    fd.append('notes', notes);
    selectedPhotos.forEach(f => fd.append('photos', f));

    const r = await fetch('/api/search', { method: 'POST', body: fd }).then(r => r.json());
    if (r.error) throw new Error(r.error);

    const searchId = r.search_id;
    pollTimer = setInterval(() => pollSearch(searchId), 3000);
  } catch(err) {
    stopStatusCycle();
    document.getElementById('searchingPanel').style.display = 'none';
    document.getElementById('findBtn').disabled = false;
    setStatus('Search failed: ' + err.message, true);
  }
}

async function pollSearch(searchId) {
  try {
    const r = await fetch('/api/search/' + searchId).then(r => r.json());
    if (r.status === 'complete') {
      clearInterval(pollTimer); pollTimer = null;
      stopStatusCycle();
      currentSearchId = searchId;
      document.getElementById('searchingPanel').style.display = 'none';
      document.getElementById('findBtn').disabled = false;
      searchResults = r.buyers || [];
      const fromCache = r.from_cache ? ' (from database)' : ' (from web search)';
      setStatus('Found ' + searchResults.length + ' buyer' + (searchResults.length !== 1 ? 's' : '') + fromCache);
      renderBuyerResults(searchResults);
      document.getElementById('resultsPanel').style.display = 'block';
    } else if (r.status === 'failed') {
      clearInterval(pollTimer); pollTimer = null;
      stopStatusCycle();
      document.getElementById('searchingPanel').style.display = 'none';
      document.getElementById('findBtn').disabled = false;
      setStatus('Search failed: ' + (r.error || 'Unknown error'), true);
    }
  } catch(_) {}
}

// ── Render search results (Change 5: checkboxes) ───────────────────────────
function renderBuyerResults(buyers) {
  const list = document.getElementById('buyerList');
  document.getElementById('buyerCount').textContent = buyers.length + ' buyer' + (buyers.length !== 1 ? 's' : '') + ' found';
  document.getElementById('selectAllChk').checked = false;

  if (!buyers.length) {
    list.innerHTML = '<div class="empty-state"><div style="font-size:2rem">🔍</div><div style="margin-top:8px;color:#666">No buyers found. Try different search terms.</div></div>';
    updateDraftBtn();
    return;
  }

  list.innerHTML = buyers.map((b, i) => {
    const deals = (b.deal_history || []).filter(d => d.outcome === 'completed').length;
    const cats = (b.categories || []).map(c => '<span class="tag">' + esc(c.brand) + ' · ' + esc(c.item_type) + '</span>').join('');
    const evidence = (b.categories || []).map(c => c.notes).filter(Boolean)[0] || '';
    return \`<div class="buyer-card" id="bcard_\${i}">
      <div class="buyer-header">
        <input type="checkbox" class="buyer-check" data-idx="\${i}" onchange="toggleBuyer(this)">
        <div style="flex:1">
          <div class="buyer-name">\${esc(b.company_name)}</div>
          <div class="buyer-meta">
            \${b.website ? '<a href="' + esc(b.website) + '" target="_blank">' + esc(b.website) + '</a>' : ''}
            \${b.email ? ' · ' + esc(b.email) : ''}
            \${b.phone ? ' · ' + esc(b.phone) : ''}
          </div>
          <div style="margin-top:6px">\${cats}</div>
          \${deals ? '<span class="tag deal">✓ ' + deals + ' deal' + (deals !== 1 ? 's' : '') + '</span>' : ''}
          \${evidence ? '<div class="evidence">' + esc(evidence) + '</div>' : ''}
        </div>
      </div>
    </div>\`;
  }).join('');
  updateDraftBtn();
}

function toggleBuyer(cb) {
  const i = cb.dataset.idx;
  document.getElementById('bcard_' + i).classList.toggle('selected', cb.checked);
  updateDraftBtn();
}

function selectAllToggle(masterCb) {
  document.querySelectorAll('.buyer-check').forEach(cb => {
    cb.checked = masterCb.checked;
    const i = cb.dataset.idx;
    document.getElementById('bcard_' + i).classList.toggle('selected', cb.checked);
  });
  updateDraftBtn();
}

function updateDraftBtn() {
  const n = document.querySelectorAll('.buyer-check:checked').length;
  const btn = document.getElementById('draftBtn');
  btn.disabled = n === 0;
  btn.textContent = n ? 'Create Personalized Gmail Drafts (' + n + ')' : 'Create Gmail Drafts for Selected';
}

// ── Bulk draft creation with progress modal (Change 5) ─────────────────────
async function createDrafts() {
  const checked = Array.from(document.querySelectorAll('.buyer-check:checked'));
  if (!checked.length) return;
  const buyerIds = checked.map(cb => searchResults[parseInt(cb.dataset.idx)].id).filter(Boolean);
  await runBulkDrafts(buyerIds, selectedPhotos);
}

async function createDraftsFromDb() {
  if (!dbSelectedIds.size) return;
  openOutreachModal();
}

// ── Outreach modal (DB tab) ────────────────────────────────────────────────
function openOutreachModal() {
  outreachBuyerIds = Array.from(dbSelectedIds);
  outreachPhotos = [];
  const n = outreachBuyerIds.length;

  // Get first selected buyer name for preview
  let firstName = 'Buyer Company';
  const firstCheck = document.querySelector('.db-check:checked');
  if (firstCheck) {
    const nameEl = document.querySelector('#dbcard_' + firstCheck.dataset.id + ' .buyer-name');
    if (nameEl) firstName = nameEl.textContent;
  }

  document.getElementById('modalContent').innerHTML = \`
    <div style="max-width:640px">
      <h3 style="margin-bottom:4px">Create Outreach Emails</h3>
      <div style="font-size:.82rem;color:#aaa;margin-bottom:16px">Creating drafts for \${n} selected buyer\${n !== 1 ? 's' : ''}</div>
      <div class="form-row">
        <div class="form-group">
          <label>Brand <span style="color:#f44">*</span></label>
          <input id="ob-brand" type="text" placeholder="e.g. Nova Biomedical, Zebra" oninput="updateOutreachPreview()">
          <div id="ob-brand-err" style="color:#f44;font-size:.75rem;display:none">Required</div>
        </div>
        <div class="form-group">
          <label>Model / Part Number <span style="color:#f44">*</span></label>
          <input id="ob-model" type="text" placeholder="e.g. pHOx Ultra REF 42014, ZM400" oninput="updateOutreachPreview()">
          <div id="ob-model-err" style="color:#f44;font-size:.75rem;display:none">Required</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Item Type <span style="color:#f44">*</span></label>
          <input id="ob-type" type="text" placeholder="e.g. blood gas analyzer, label printer" oninput="updateOutreachPreview()">
          <div id="ob-type-err" style="color:#f44;font-size:.75rem;display:none">Required</div>
        </div>
        <div class="form-group">
          <label>Quantity <span style="color:#f44">*</span></label>
          <input id="ob-qty" type="number" min="1" value="1" oninput="updateOutreachPreview()">
        </div>
      </div>
      <div class="form-group">
        <label>Condition <span style="color:#f44">*</span></label>
        <select id="ob-condition" onchange="updateOutreachPreview()">
          <option value="Tested Working">Tested Working</option>
          <option value="Untested/As-Is">Untested / As-Is</option>
          <option value="For Parts/Repair">For Parts / Repair</option>
        </select>
      </div>
      <div class="form-group">
        <label>Additional Notes</label>
        <textarea id="ob-notes" placeholder="e.g. removed from hospital service, includes all accessories, no power supply" style="min-height:60px" oninput="updateOutreachPreview()"></textarea>
      </div>
      <div class="form-group">
        <label>Attach photos (optional, up to 5)</label>
        <div class="photo-upload" onclick="document.getElementById('ob-photos').click()" style="padding:14px">
          <div style="color:#666;font-size:.82rem">Click to upload photos · JPEG, PNG, WEBP</div>
          <input type="file" id="ob-photos" multiple accept="image/*" onchange="handleOutreachPhotos(this)" style="display:none">
        </div>
        <div id="ob-thumbs" class="thumbnails" style="margin-top:8px"></div>
      </div>
      <div style="background:#111;border-radius:6px;padding:14px;margin-bottom:14px">
        <div style="font-size:.72rem;font-weight:700;color:var(--gold);letter-spacing:.5px;margin-bottom:8px;text-transform:uppercase">Email Preview <span style="color:#555;font-weight:400">(personalized per buyer)</span></div>
        <pre id="ob-preview" style="font-family:inherit;font-size:.75rem;color:#aaa;white-space:pre-wrap;line-height:1.5;max-height:180px;overflow-y:auto">Fill in the fields above to see a preview.</pre>
      </div>
      <button class="btn btn-green btn-full" style="margin-bottom:10px" onclick="submitOutreachForm()">Create Gmail Drafts</button>
      <button class="btn btn-outline btn-full" onclick="closeModal()">Cancel</button>
    </div>
  \`;

  // Make modal wider for this form
  document.querySelector('#modalOverlay .modal').style.maxWidth = '660px';
  openModal();
  updateOutreachPreview();
}

function handleOutreachPhotos(input) {
  outreachPhotos = Array.from(input.files).slice(0, 5);
  const container = document.getElementById('ob-thumbs');
  if (!container) return;
  container.innerHTML = '';
  outreachPhotos.forEach(f => {
    const img = document.createElement('img');
    img.className = 'thumbnail';
    img.src = URL.createObjectURL(f);
    container.appendChild(img);
  });
}

function updateOutreachPreview() {
  const previewEl = document.getElementById('ob-preview');
  if (!previewEl) return;
  const brand = (document.getElementById('ob-brand')?.value || '').trim() || '[Brand]';
  const model = (document.getElementById('ob-model')?.value || '').trim() || '[Model]';
  const itemType = (document.getElementById('ob-type')?.value || '').trim() || '[Item Type]';
  const qty = document.getElementById('ob-qty')?.value || '1';
  const condition = document.getElementById('ob-condition')?.value || '[Condition]';
  const notes = (document.getElementById('ob-notes')?.value || '').trim();
  const lines = [
    'Hello [Buyer Company Name],',
    '',
    'My name is Kendall Gattison with Xtreme Electronic Recycling based in Clovis, CA. I came across [Company] while researching buyers and wanted to reach out directly.',
    '',
    'EQUIPMENT AVAILABLE:',
    'Brand: ' + brand,
    'Model: ' + model,
    'Type: ' + itemType,
    'Quantity: ' + qty,
    'Condition: ' + condition,
  ];
  if (notes) { lines.push(''); lines.push(notes); }
  lines.push('', 'Please see attached photos for visual reference. We are looking to move this equipment promptly.', '', '— Kendall Gattison, XRT');
  previewEl.textContent = lines.join('\\n');
}

async function submitOutreachForm() {
  const brand = document.getElementById('ob-brand')?.value.trim() || '';
  const model = document.getElementById('ob-model')?.value.trim() || '';
  const itemType = document.getElementById('ob-type')?.value.trim() || '';
  const qty = document.getElementById('ob-qty')?.value || '1';
  const condition = document.getElementById('ob-condition')?.value || '';
  const notes = document.getElementById('ob-notes')?.value.trim() || '';

  // Validate
  let valid = true;
  ['ob-brand', 'ob-model', 'ob-type'].forEach(id => {
    const errEl = document.getElementById(id + '-err');
    const val = document.getElementById(id)?.value.trim();
    if (!val) { if (errEl) errEl.style.display = 'block'; valid = false; }
    else { if (errEl) errEl.style.display = 'none'; }
  });
  if (!valid) return;

  // Read photos as base64
  const photos = await Promise.all(outreachPhotos.map(f => new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = e => res(e.target.result);
    reader.onerror = rej;
    reader.readAsDataURL(f);
  })));

  const gmailLabel = connectedEmail ? \` (\${connectedEmail})\` : '';
  closeModal();
  // Reset modal max-width
  document.querySelector('#modalOverlay .modal').style.maxWidth = '';

  // Show progress modal
  const buyerIds = outreachBuyerIds;
  const total = buyerIds.length;
  document.getElementById('modalContent').innerHTML = \`
    <h3>Creating Gmail Drafts</h3>
    <div id="progressList" style="margin:16px 0;max-height:300px;overflow-y:auto">
      <div class="progress-item"><span class="loader"></span><span class="pi-pending">Sending \${total} draft\${total !== 1 ? 's' : ''}...</span></div>
    </div>
    <div id="progressSummary" style="font-size:.85rem;color:#aaa;margin-top:8px"></div>
    <div class="modal-actions" id="progressActions" style="display:none">
      <a href="https://mail.google.com/mail/u/kendall@xtremeelectronicrecycling.com/#drafts" target="_blank" class="btn btn-green">Open Gmail Drafts →\${esc(gmailLabel)}</a>
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>
  \`;
  openModal();

  try {
    const payload = { buyer_ids: buyerIds, brand, model, item_type: itemType, quantity: qty, condition, notes, photos };
    const r = await fetch('/api/outreach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    pollOutreachJob(r.outreach_id, r.total, gmailLabel);
  } catch(err) {
    document.getElementById('progressList').innerHTML = '<div style="color:#f66">Error: ' + esc(err.message) + '</div>';
    document.getElementById('progressActions').style.display = 'flex';
  }
}

async function runBulkDrafts(buyerIds, photos, overrideMeta) {
  const meta = overrideMeta || currentSearchMeta;
  const { brand, model, itemType, quantity, condition, notes } = meta;
  const total = buyerIds.length;
  const gmailLabel = connectedEmail ? \` (\${connectedEmail})\` : '';

  // Show progress modal
  document.getElementById('modalContent').innerHTML = \`
    <h3>Creating Gmail Drafts</h3>
    <div id="progressList" style="margin:16px 0;max-height:300px;overflow-y:auto"></div>
    <div id="progressSummary" style="font-size:.85rem;color:#aaa;margin-top:8px"></div>
    <div class="modal-actions" id="progressActions" style="display:none">
      <a href="https://mail.google.com/mail/u/kendall@xtremeelectronicrecycling.com/#drafts" target="_blank" class="btn btn-green">Open Gmail Drafts →\${esc(gmailLabel)}</a>
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>
  \`;
  openModal();

  const fd = new FormData();
  fd.append('buyer_ids', JSON.stringify(buyerIds));
  fd.append('brand', brand || '');
  fd.append('model', model || '');
  fd.append('item_type', itemType || '');
  fd.append('quantity', quantity || 1);
  fd.append('condition', condition || '');
  fd.append('notes', notes || '');
  if (currentSearchId) fd.append('search_id', currentSearchId);
  photos.forEach(f => fd.append('photos', f));

  // Show pending items
  const pList = document.getElementById('progressList');

  // Load buyer names for display
  const db = await fetch('/api/buyers').then(r => r.json());
  const buyerMap = {};
  (db.buyers || []).forEach(b => { buyerMap[b.id] = b.company_name; });

  pList.innerHTML = buyerIds.map((id, i) =>
    \`<div class="progress-item" id="pi_\${i}">
      <span class="loader"></span>
      <span class="pi-pending">Creating draft \${i + 1} of \${total} — \${esc(buyerMap[id] || id)}...</span>
    </div>\`
  ).join('');

  try {
    const r = await fetch('/api/outreach', { method: 'POST', body: fd }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    pollOutreachJob(r.outreach_id, r.total, gmailLabel, buyerMap);
  } catch(err) {
    pList.innerHTML = '<div style="color:#f66">Error: ' + esc(err.message) + '</div>';
    document.getElementById('progressActions').style.display = 'flex';
  }
}

// ── Outreach job polling ───────────────────────────────────────────────────
let outreachPollTimer = null;

function pollOutreachJob(outreachId, total, gmailLabel, buyerMap) {
  if (outreachPollTimer) clearInterval(outreachPollTimer);
  const seenResults = new Set();

  outreachPollTimer = setInterval(async () => {
    try {
      const job = await fetch('/api/outreach/' + outreachId).then(r => r.json());
      if (job.error) throw new Error(job.error);

      // Render any new per-buyer results
      const pList = document.getElementById('progressList');
      if (pList) {
        (job.results || []).forEach((res, i) => {
          if (seenResults.has(i)) return;
          seenResults.add(i);
          const name = (buyerMap && buyerMap[res.buyer_id]) ? buyerMap[res.buyer_id] : res.company_name;
          // Replace or append progress item
          let el = document.getElementById('pi_' + i);
          if (!el) {
            el = document.createElement('div');
            el.className = 'progress-item';
            el.id = 'pi_' + i;
            pList.appendChild(el);
          }
          if (res.success) {
            el.innerHTML = '<span class="pi-ok">✓</span> <span class="pi-ok">Draft created — ' + esc(name) + '</span>';
          } else {
            el.innerHTML = '<span class="pi-fail">✗</span> <span class="pi-fail">Failed — ' + esc(name) + ': ' + esc(res.error || 'unknown') + '</span>';
          }
        });

        // Show in-progress count while running
        if (job.status === 'processing') {
          const summEl = document.getElementById('progressSummary');
          if (summEl) summEl.textContent = (job.results || []).length + ' of ' + total + ' processed…';
        }
      }

      if (job.status === 'complete' || job.status === 'failed') {
        clearInterval(outreachPollTimer);
        outreachPollTimer = null;

        const succeeded = (job.results || []).filter(r => r.success).length;
        const failed = (job.results || []).filter(r => !r.success).length;
        const failedIds = (job.results || []).filter(r => !r.success).map(r => r.buyer_id);

        const summEl = document.getElementById('progressSummary');
        if (summEl) summEl.textContent = job.status === 'failed'
          ? 'Job failed: ' + (job.error || 'unknown error')
          : 'Complete: ' + succeeded + ' of ' + total + ' drafts created.' + (failed > 0 ? ' ' + failed + ' failed.' : '');

        const actEl = document.getElementById('progressActions');
        if (actEl) {
          actEl.style.display = 'flex';
          actEl.innerHTML = \`
            <a href="https://mail.google.com/mail/u/kendall@xtremeelectronicrecycling.com/#drafts" target="_blank" class="btn btn-green">Open Gmail Drafts →\${esc(gmailLabel)}</a>
            \${failed > 0 ? '<button class="btn btn-gold" onclick="retryFailedDrafts(' + JSON.stringify(failedIds) + ')">Retry Failed (' + failed + ')</button>' : ''}
            <button class="btn btn-outline" onclick="closeModal()">Close</button>
          \`;
        }
      }
    } catch (err) {
      clearInterval(outreachPollTimer);
      outreachPollTimer = null;
      const pList = document.getElementById('progressList');
      if (pList) pList.innerHTML += '<div style="color:#f66;font-size:.82rem">Poll error: ' + esc(err.message) + '</div>';
      const actEl = document.getElementById('progressActions');
      if (actEl) actEl.style.display = 'flex';
    }
  }, 3000);
}

async function retryFailedDrafts(failedBuyerIds) {
  if (!failedBuyerIds || !failedBuyerIds.length) return;
  // Re-open progress modal and kick off new outreach job for failed buyers
  const gmailLabel = connectedEmail ? \` (\${connectedEmail})\` : '';
  document.getElementById('modalContent').innerHTML = \`
    <h3>Retrying Failed Drafts</h3>
    <div id="progressList" style="margin:16px 0;max-height:300px;overflow-y:auto">
      <div class="progress-item"><span class="loader"></span><span class="pi-pending">Starting retry for \${failedBuyerIds.length} buyer(s)...</span></div>
    </div>
    <div id="progressSummary" style="font-size:.85rem;color:#aaa;margin-top:8px"></div>
    <div class="modal-actions" id="progressActions" style="display:none">
      <a href="https://mail.google.com/mail/u/kendall@xtremeelectronicrecycling.com/#drafts" target="_blank" class="btn btn-green">Open Gmail Drafts →\${esc(gmailLabel)}</a>
      <button class="btn btn-outline" onclick="closeModal()">Close</button>
    </div>
  \`;
  openModal();
  try {
    const meta = currentSearchMeta || {};
    const fd = new FormData();
    fd.append('buyer_ids', JSON.stringify(failedBuyerIds));
    fd.append('brand', meta.brand || '');
    fd.append('model', meta.model || '');
    fd.append('item_type', meta.itemType || '');
    fd.append('quantity', meta.quantity || 1);
    fd.append('condition', meta.condition || '');
    fd.append('notes', meta.notes || '');
    if (currentSearchId) fd.append('search_id', currentSearchId);
    const r = await fetch('/api/outreach', { method: 'POST', body: fd }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    pollOutreachJob(r.outreach_id, r.total, gmailLabel);
  } catch (err) {
    document.getElementById('progressList').innerHTML = '<div style="color:#f66">Retry error: ' + esc(err.message) + '</div>';
    document.getElementById('progressActions').style.display = 'flex';
  }
}

// ── Buyer Database ─────────────────────────────────────────────────────────
async function loadBuyerDb() {
  dbSelectedIds.clear();
  updateDbBulkBar(); // resets header button
  const q = document.getElementById('db-search').value.trim();
  const status = document.getElementById('db-status').value;
  const r = await fetch('/api/buyers?' + new URLSearchParams({ status })).then(r => r.json());
  let buyers = r.buyers || [];

  if (q) {
    const lq = q.toLowerCase();
    buyers = buyers.filter(b =>
      b.company_name.toLowerCase().includes(lq) ||
      (b.email || '').toLowerCase().includes(lq) ||
      (b.categories || []).some(c => c.brand.toLowerCase().includes(lq) || c.item_type.toLowerCase().includes(lq))
    );
  }

  const el = document.getElementById('buyerDbList');
  if (!buyers.length) {
    el.innerHTML = '<div class="empty-state"><div style="font-size:2rem">📋</div><div style="margin-top:8px;color:#666">No buyers found.</div></div>';
    return;
  }

  el.innerHTML = buyers.map(b => {
    const deals = (b.deal_history || []).length;
    const cats = (b.categories || []).map(c => '<span class="tag">' + esc(c.brand) + ' · ' + esc(c.item_type) + '</span>').join('');
    return \`<div class="buyer-card" id="dbcard_\${b.id}">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <input type="checkbox" class="buyer-check db-check" data-id="\${b.id}" onchange="toggleDbBuyer(this)" style="margin-top:4px;width:18px;height:18px;accent-color:var(--green);flex-shrink:0;cursor:pointer">
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <div class="buyer-name">\${esc(b.company_name)}</div>
            <span class="pill \${b.status === 'active' ? 'active' : 'inactive'}">\${b.status}</span>
            \${deals ? '<span class="tag deal">' + deals + ' deal' + (deals !== 1 ? 's' : '') + '</span>' : ''}
          </div>
          <div class="buyer-meta" style="margin-top:4px">
            \${b.email ? esc(b.email) : ''}
            \${b.phone ? (b.email ? ' · ' : '') + esc(b.phone) : ''}
            \${b.website ? ' · <a href="' + esc(b.website) + '" target="_blank">' + esc(b.website) + '</a>' : ''}
          </div>
          <div style="margin-top:8px">\${cats}</div>
          \${b.last_contacted ? '<div style="font-size:.75rem;color:#666;margin-top:6px">Last contacted: ' + b.last_contacted.slice(0,10) + '</div>' : ''}
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;flex-shrink:0">
          <button class="btn btn-outline" style="padding:5px 10px;font-size:.75rem" onclick='openEditBuyer(\${JSON.stringify(b).replace(/'/g,"&apos;")})'>Edit</button>
          <button class="btn btn-gold" style="padding:5px 10px;font-size:.75rem" onclick='openDealModal("\${b.id}")'>Mark Deal</button>
          <button class="btn \${b.status === 'active' ? 'btn-red' : 'btn-green'}" style="padding:5px 10px;font-size:.75rem" onclick='toggleBuyerStatus("\${b.id}","\${b.status}")'>
            \${b.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>
    </div>\`;
  }).join('');
}

function toggleDbBuyer(cb) {
  const id = cb.dataset.id;
  if (cb.checked) dbSelectedIds.add(id);
  else dbSelectedIds.delete(id);
  document.getElementById('dbcard_' + id).classList.toggle('selected', cb.checked);
  updateDbBulkBar();
}

function updateDbBulkBar() {
  const n = dbSelectedIds.size;
  const btn = document.getElementById('contactSelectedBtn');
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? \`Contact Selected (\${n})\` : 'Contact Selected';
  }
}

async function toggleBuyerStatus(id, current) {
  const newStatus = current === 'active' ? 'inactive' : 'active';
  await fetch('/api/buyers/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ status: newStatus }) });
  loadBuyerDb();
}

// ─── Bulk contact lookup ─────────────────────────────────────────────────────
let lookupPollInterval = null;

async function startBulkContactLookup() {
  const modal = document.getElementById('lookupModal');
  document.getElementById('lookupProgress').textContent = 'Starting...';
  document.getElementById('lookupBar').style.width = '0%';
  document.getElementById('lookupResults').innerHTML = '';
  document.getElementById('lookupCloseBtn').style.display = 'none';
  modal.style.display = 'flex';
  document.getElementById('lookupContactsBtn').disabled = true;
  try {
    const r = await fetch('/api/buyers/lookup-contacts', { method: 'POST' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed to start');
    if (data.total === 0) {
      document.getElementById('lookupProgress').textContent = 'No buyers with missing contacts found.';
      document.getElementById('lookupCloseBtn').style.display = 'block';
      return;
    }
    pollLookupStatus();
  } catch (err) {
    document.getElementById('lookupProgress').textContent = 'Error: ' + err.message;
    document.getElementById('lookupCloseBtn').style.display = 'block';
    document.getElementById('lookupContactsBtn').disabled = false;
  }
}

function pollLookupStatus() {
  if (lookupPollInterval) clearInterval(lookupPollInterval);
  lookupPollInterval = setInterval(async () => {
    try {
      const r = await fetch('/api/buyers/lookup-contacts/status');
      const job = await r.json();
      const pct = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
      document.getElementById('lookupBar').style.width = pct + '%';
      document.getElementById('lookupProgress').textContent =
        job.status === 'complete'
          ? \`Done — found contact info for \${job.found} of \${job.total} buyers.\`
          : \`Checking \${job.completed} of \${job.total}...\`;
      const resultsEl = document.getElementById('lookupResults');
      resultsEl.innerHTML = (job.results || []).map(r =>
        \`<div style="display:flex;align-items:center;gap:8px">
          <span>\${r.found ? '✅' : '❌'}</span>
          <span style="color:#ddd">\${r.company_name}</span>
          \${r.found ? '<span style="color:#aaa;font-size:.8rem">— contact found</span>' : ''}
        </div>\`
      ).join('');
      if (job.status === 'complete') {
        clearInterval(lookupPollInterval);
        lookupPollInterval = null;
        document.getElementById('lookupCloseBtn').style.display = 'block';
        document.getElementById('lookupContactsBtn').disabled = false;
      }
    } catch (err) {
      clearInterval(lookupPollInterval);
      lookupPollInterval = null;
      document.getElementById('lookupProgress').textContent = 'Poll error: ' + err.message;
      document.getElementById('lookupCloseBtn').style.display = 'block';
      document.getElementById('lookupContactsBtn').disabled = false;
    }
  }, 2000);
}

function closeLookupModal() {
  if (lookupPollInterval) { clearInterval(lookupPollInterval); lookupPollInterval = null; }
  document.getElementById('lookupModal').style.display = 'none';
  loadBuyerDb();
}

function openAddBuyer() {
  document.getElementById('modalContent').innerHTML = \`
    <h3>Add Buyer Manually</h3>
    <div class="form-group"><label>Company Name *</label><input id="m-company" type="text"></div>
    <div class="form-row">
      <div class="form-group"><label>Email</label><input id="m-email" type="email"></div>
      <div class="form-group"><label>Phone</label><input id="m-phone" type="tel"></div>
    </div>
    <div class="form-group"><label>Website</label><input id="m-website" type="url"></div>
    <div class="form-row">
      <div class="form-group"><label>Buys Brand</label><input id="m-cat-brand" type="text"></div>
      <div class="form-group"><label>Buys Item Type</label><input id="m-cat-type" type="text"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-green" onclick="saveBuyer()">Save Buyer</button>
    </div>
  \`;
  openModal();
}

async function saveBuyer() {
  const company = document.getElementById('m-company').value.trim();
  if (!company) return;
  const cats = [];
  const cb = document.getElementById('m-cat-brand').value.trim();
  const ct = document.getElementById('m-cat-type').value.trim();
  if (cb || ct) cats.push({ brand: cb, item_type: ct });
  await fetch('/api/buyers', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ company_name: company, email: document.getElementById('m-email').value, phone: document.getElementById('m-phone').value, website: document.getElementById('m-website').value, categories: cats }),
  });
  closeModal();
  loadBuyerDb();
}

function openEditBuyer(b) {
  document.getElementById('modalContent').innerHTML = \`
    <h3>Edit Buyer</h3>
    <div class="form-group"><label>Company Name</label><input id="e-company" type="text" value="\${esc(b.company_name)}"></div>
    <div class="form-row">
      <div class="form-group"><label>Email</label><input id="e-email" type="email" value="\${esc(b.email||'')}"></div>
      <div class="form-group"><label>Phone</label><input id="e-phone" type="tel" value="\${esc(b.phone||'')}"></div>
    </div>
    <div class="form-group"><label>Website</label><input id="e-website" type="url" value="\${esc(b.website||'')}"></div>
    <div class="form-group"><label>Contact Name</label><input id="e-contact" type="text" value="\${esc(b.contact_name||'')}"></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-green" onclick='updateBuyer("\${b.id}")'>Save Changes</button>
    </div>
  \`;
  openModal();
}

async function updateBuyer(id) {
  await fetch('/api/buyers/' + id, {
    method: 'PATCH',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ company_name: document.getElementById('e-company').value, email: document.getElementById('e-email').value, phone: document.getElementById('e-phone').value, website: document.getElementById('e-website').value, contact_name: document.getElementById('e-contact').value }),
  });
  closeModal();
  loadBuyerDb();
}

function openDealModal(id) {
  document.getElementById('modalContent').innerHTML = \`
    <h3>Record Deal</h3>
    <div class="form-group"><label>Item / Description</label><input id="d-item" type="text" placeholder="e.g. Nova Biomedical pHOx Ultra x12"></div>
    <div class="form-row">
      <div class="form-group"><label>Outcome</label>
        <select id="d-outcome">
          <option value="completed">Completed Sale</option>
          <option value="passed">Passed / No Interest</option>
          <option value="pending">Pending / Negotiating</option>
          <option value="no_response">No Response</option>
        </select>
      </div>
      <div class="form-group"><label>Amount ($)</label><input id="d-amount" type="text" placeholder="Optional"></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="d-notes" style="min-height:60px"></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
      <button class="btn btn-gold" onclick='saveDeal("\${id}")'>Save Deal</button>
    </div>
  \`;
  openModal();
}

async function saveDeal(id) {
  await fetch('/api/buyers/' + id + '/deal', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ item: document.getElementById('d-item').value, outcome: document.getElementById('d-outcome').value, amount: document.getElementById('d-amount').value, notes: document.getElementById('d-notes').value }),
  });
  closeModal();
  loadBuyerDb();
  flash('Deal recorded.');
}

// ── Outreach ───────────────────────────────────────────────────────────────
async function loadOutreach() {
  const r = await fetch('/api/outreach').then(r => r.json());
  const list = document.getElementById('outreachList');
  const records = r.outreach || [];
  if (!records.length) {
    list.innerHTML = '<div class="empty-state"><div style="font-size:2rem">📬</div><div style="margin-top:8px;color:#666">No outreach records yet.</div></div>';
    return;
  }
  list.innerHTML = records.map(o => {
    const dateStr = (o.date || o.created_at || '').slice(0, 10);
    const draftCount = (o.gmail_draft_ids || []).length;
    const failedCount = (o.results || []).filter(r => !r.success).length;
    const statusBadge = o.status === 'processing'
      ? '<span style="color:var(--gold);font-size:.75rem">⏳ Processing…</span>'
      : o.status === 'failed' ? '<span style="color:#f66;font-size:.75rem">✗ Failed</span>'
      : '';
    return \`<div class="outreach-card">
      <h4>\${esc(o.brand)} \${esc(o.model||'')} — \${o.quantity} unit\${o.quantity !== 1 ? 's' : ''} \${statusBadge}</h4>
      <div class="outreach-meta">
        \${dateStr} · \${esc(o.item_type||'')} · \${esc(o.condition||'')} · \${(o.buyer_ids||[]).length} buyer(s) contacted
      </div>
      \${draftCount > 0
        ? '<div style="margin-top:8px;font-size:.8rem"><span style="color:var(--green)">✓ ' + draftCount + ' Gmail draft(s)</span> · <a href="https://mail.google.com/mail/u/kendall@xtremeelectronicrecycling.com/#drafts" target="_blank">Open Drafts →</a>' + (connectedEmail ? ' <span style="color:#555">(' + esc(connectedEmail) + ')</span>' : '') + '</div>'
        : '<div style="margin-top:8px;font-size:.8rem;color:#666">No drafts created</div>'}
      \${failedCount > 0 ? '<div style="margin-top:4px;font-size:.78rem;color:#f66">' + failedCount + ' draft(s) failed</div>' : ''}
      \${o.notes ? '<div style="margin-top:8px;font-size:.8rem;color:#aaa">' + esc(o.notes) + '</div>' : ''}
    </div>\`;
  }).join('');
}

// ── Settings ───────────────────────────────────────────────────────────────
async function loadSettings() {
  checkGmailStatus();
  const r = await fetch('/api/settings').then(r => r.json());
  const thresholds = r.thresholds || [];
  const br = await fetch('/api/buyers').then(r => r.json());
  const buyers = br.buyers || [];
  const combos = new Map();
  for (const b of buyers) {
    for (const c of (b.categories || [])) {
      const key = c.brand + '|' + c.item_type;
      if (!combos.has(key)) combos.set(key, { brand: c.brand, item_type: c.item_type });
    }
  }
  for (const t of thresholds) {
    if (!combos.has(t.key)) combos.set(t.key, { brand: t.brand || '', item_type: t.item_type || '' });
  }
  const tMap = {};
  thresholds.forEach(t => tMap[t.key] = t.value);
  const el = document.getElementById('thresholdsTable');
  if (!combos.size) {
    el.innerHTML = '<p style="color:#666;font-size:.85rem">No categories yet — run a search to populate.</p>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Brand</th><th>Item Type</th><th>Min. Buyers</th></tr></thead><tbody>' +
    Array.from(combos.values()).map(c => {
      const key = c.brand + '|' + c.item_type;
      const val = tMap[key] !== undefined ? tMap[key] : 3;
      return \`<tr><td>\${esc(c.brand)}</td><td>\${esc(c.item_type)}</td><td><input class="inline-edit" type="number" min="1" max="50" data-key="\${esc(key)}" value="\${val}"></td></tr>\`;
    }).join('') + '</tbody></table>';
}

async function saveThresholds() {
  const inputs = document.querySelectorAll('.inline-edit');
  const thresholds = Array.from(inputs).map(inp => {
    const [brand, item_type] = inp.dataset.key.split('|');
    return { key: inp.dataset.key, brand, item_type, value: parseInt(inp.value) || 3 };
  });
  await fetch('/api/settings', { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ thresholds }) });
  flash('Thresholds saved.');
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openModal() { document.getElementById('modalOverlay').classList.add('show'); }
function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
  const m = document.querySelector('#modalOverlay .modal');
  if (m) m.style.maxWidth = '';
}

// ── Utility ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Init ───────────────────────────────────────────────────────────────────
checkGmailStatus();
${gmailConnected ? "flash('Gmail connected successfully! You can now create email drafts.');" : ''}
${authError ? "flash('OAuth error: " + authError + "', 'error');" : ''}
</script>
</body>
</html>`);
});

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[BUYER FINDER] Running at http://localhost:${PORT}`);
  console.log(`[BUYER FINDER] Data dir: ${DATA_DIR}`);
});
