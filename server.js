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

const FILES = {
  buyers: path.join(DATA_DIR, 'buyers.json'),
  searches: path.join(DATA_DIR, 'searches.json'),
  outreach: path.join(DATA_DIR, 'outreach.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  tokens: path.join(DATA_DIR, 'gmail-tokens.json'),
};

function ensureDirs() {
  [DATA_DIR, PHOTOS_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
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

  // Step 1 — remove all existing Nova Biomedical buyers
  const before = db.buyers.length;
  db.buyers = db.buyers.filter(b =>
    !(b.categories || []).some(c => c.brand.toLowerCase() === 'nova biomedical')
  );
  const removed = before - db.buyers.length;
  console.log(`[SEED] Removed ${removed} existing Nova Biomedical buyers`);

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

// ─── Anthropic helper ────────────────────────────────────────────────────────
async function callAnthropic(messages, system, tools, maxTokens = 4096) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const body = { model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages };
  if (tools && tools.length) body.tools = tools;

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        console.log('[API] Status:', res.statusCode);
        if (res.statusCode !== 200) console.log('[API] Error body:', raw.slice(0, 300));
        try {
          const parsed = JSON.parse(raw);
          parsed._httpStatus = res.statusCode;
          resolve(parsed);
        } catch (e) { reject(new Error('Invalid JSON from Anthropic')); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function extractTextFromResponse(resp) {
  if (!resp || !resp.content) return '';
  return resp.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
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
      const hasCat = (existing.categories || []).some(c =>
        c.brand.toLowerCase() === brand.toLowerCase() &&
        c.item_type.toLowerCase() === itemType.toLowerCase()
      );
      if (!hasCat) {
        existing.categories = existing.categories || [];
        existing.categories.push({ brand, item_type: itemType, notes: nb.evidence || '' });
      }
    } else {
      db.buyers.push({
        id: `buyer_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        company_name: nb.company_name || 'Unknown',
        contact_name: nb.contact_name || '',
        email: nb.email || '',
        phone: nb.phone || '',
        website: nb.website || '',
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

// ─── Change 4: Contact info lookup ──────────────────────────────────────────
async function lookupBuyerContact(companyName, website) {
  try {
    const resp = await callAnthropic(
      [{ role: 'user', content: `Find the contact email and phone number for ${companyName} at ${website}. Look for a buying/selling equipment contact email, general contact email, and phone number. Return JSON only: { email, phone, contact_page }. Use null for fields not found.` }],
      `Find contact information for companies that buy used equipment. Search their website and any available sources.`,
      [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      512
    );
    const text = extractTextFromResponse(resp);
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

  // Change 3: improved system prompt that finds actual buyers, not marketplaces
  const system = `You are a researcher finding companies that PURCHASE used specialty equipment directly from sellers and resellers. You are finding BUYERS, not sellers.

TARGET companies that:
- Have a "We Buy" or "Sell Your Equipment" page
- Advertise they purchase used/surplus equipment
- Are surplus dealers that buy direct from businesses
- Are refurbishers that acquire used equipment
- Are equipment brokers that pay cash for equipment
- Explicitly state they buy ${brand} ${itemType}

DO NOT include any of these:
- eBay listings or eBay sellers
- DOTmed listings (unless the company itself buys equipment directly, not just lists on DOTmed)
- LabX listings
- Machinio listings
- Biomedis listings
- Any marketplace platform listing pages
- Companies that ONLY sell equipment, not buy
- Individual sellers listing single items

For website field: use the company's OWN website, never a marketplace listing URL like dotmed.com, labx.com, machinio.com, ebay.com, or similar.

For each qualifying buyer company return:
{ company_name, website (must be company's own domain), email or null, phone or null, evidence (specific proof they BUY equipment — quote their "we buy" page or explicit purchase statement) }

Return ONLY as a JSON array. If no qualifying buyers found for this search angle, return empty array []. Do not include any explanation text outside the JSON.`;

  const allBuyers = new Map();
  let consecutiveEmpty = 0;

  for (let i = 0; i < angles.length; i++) {
    if (consecutiveEmpty >= 3 || allBuyers.size >= 15) break;
    const angle = angles[i];
    console.log(`[SEARCH] Angle ${i + 1}: ${angle}`);

    try {
      const userMsg = `Search for companies that PURCHASE used ${brand} ${itemType} equipment. Search query: "${angle}". Return ONLY a JSON array of buyer companies with fields: company_name, website, email, phone, evidence.`;

      const resp = await callAnthropic(
        [{ role: 'user', content: userMsg }],
        system,
        [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        2048
      );

      console.log(`[SEARCH] Angle ${i + 1} — stop_reason: ${resp.stop_reason}, blocks: ${(resp.content || []).map(b => b.type).join(', ')}`);
      if (resp.error) console.log(`[SEARCH] Angle ${i + 1} API error:`, JSON.stringify(resp.error));

      const text = extractTextFromResponse(resp);
      console.log(`[SEARCH] Angle ${i + 1} raw text:\n---\n${text.slice(0, 600)}${text.length > 600 ? '\n…(truncated)' : ''}\n---`);

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
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') },
    }));
    const resp = await callAnthropic(
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
  const subject = `${opts.brand} ${opts.model || opts.itemType} Available — ${opts.quantity} Unit${opts.quantity > 1 ? 's' : ''} | Xtreme Electronic Recycling`;
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

// Change 5: Outreach / bulk Gmail drafts
app.post('/api/outreach', upload.array('photos', 5), async (req, res) => {
  try {
    const auth = await getAuthClient();
    if (!auth) return res.status(401).json({ error: 'Gmail not connected. Please connect at /auth' });

    const { buyer_ids, brand, model, item_type, quantity, condition, notes } = req.body;
    const ids = typeof buyer_ids === 'string' ? JSON.parse(buyer_ids) : buyer_ids || [];

    const db = readJSON(FILES.buyers, { buyers: [] });
    const photoBuffers = (req.files || []).map(f => f.buffer);

    const outreachId = `outreach_${Date.now()}`;
    const photoDir = path.join(PHOTOS_DIR, outreachId);
    fs.mkdirSync(photoDir, { recursive: true });
    const photoNames = [];
    for (let i = 0; i < photoBuffers.length; i++) {
      const name = `photo_${i + 1}.jpg`;
      fs.writeFileSync(path.join(photoDir, name), photoBuffers[i]);
      photoNames.push(name);
    }

    const opts = { brand, model: model || '', itemType: item_type, quantity: parseInt(quantity) || 1, condition: condition || '', notes: notes || '' };
    const perBuyerResults = [];
    const gmailDraftIds = [];

    for (const buyerId of ids) {
      const buyer = db.buyers.find(b => b.id === buyerId);
      if (!buyer) {
        perBuyerResults.push({ buyer_id: buyerId, company_name: 'Unknown', success: false, error: 'Buyer not found' });
        continue;
      }
      try {
        const draftId = await createGmailDraft(auth, buyer, opts, photoBuffers);
        gmailDraftIds.push(draftId);
        buyer.last_contacted = new Date().toISOString();
        buyer.contact_count = (buyer.contact_count || 0) + 1;
        perBuyerResults.push({ buyer_id: buyerId, company_name: buyer.company_name, success: true, draft_id: draftId });
        console.log(`[DRAFT] Created for ${buyer.company_name}: ${draftId}`);
      } catch (err) {
        console.error(`[DRAFT] Failed for ${buyer.company_name}:`, err.message);
        perBuyerResults.push({ buyer_id: buyerId, company_name: buyer.company_name, success: false, error: err.message });
      }
    }

    writeJSON(FILES.buyers, db);

    const outreachDb = readJSON(FILES.outreach, { outreach: [] });
    outreachDb.outreach.unshift({
      id: outreachId,
      brand,
      item_type,
      model: model || '',
      quantity: parseInt(quantity) || 1,
      condition: condition || '',
      buyer_ids: ids,
      draft_created: gmailDraftIds.length > 0,
      gmail_draft_ids: gmailDraftIds,
      date: new Date().toISOString(),
      photos: photoNames,
      notes: notes || '',
    });
    writeJSON(FILES.outreach, outreachDb);

    const succeeded = perBuyerResults.filter(r => r.success).length;
    res.json({
      success: true,
      outreach_id: outreachId,
      total: ids.length,
      succeeded,
      failed: ids.length - succeeded,
      results: perBuyerResults,
      gmail_draft_ids: gmailDraftIds,
    });
  } catch (err) {
    console.error('[OUTREACH] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/outreach', (_, res) => {
  try { res.json(readJSON(FILES.outreach, { outreach: [] })); }
  catch (err) { res.status(500).json({ error: err.message }); }
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
    <button class="btn btn-green" onclick="openAddBuyer()">+ Add Buyer</button>
  </div>
  <div id="dbBulkBar" style="display:none;margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <span id="dbSelCount" class="count-badge">0 selected</span>
    <button class="btn btn-gold" onclick="createDraftsFromDb()">Contact Selected Buyers</button>
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
let pollTimer = null;
let dbSelectedIds = new Set();

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
      badge.className = 'badge connected';
      badge.textContent = '✓ Gmail: ' + r.email;
      if (statusEl) statusEl.innerHTML = '<span style="color:var(--green)">✓ Connected as ' + r.email + '</span>';
    } else {
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
  await runBulkDrafts(Array.from(dbSelectedIds), []);
}

async function runBulkDrafts(buyerIds, photos) {
  const { brand, model, itemType, quantity, condition, notes } = currentSearchMeta;
  const total = buyerIds.length;

  // Show progress modal
  document.getElementById('modalContent').innerHTML = \`
    <h3>Creating Gmail Drafts</h3>
    <div id="progressList" style="margin:16px 0;max-height:300px;overflow-y:auto"></div>
    <div id="progressSummary" style="font-size:.85rem;color:#aaa;margin-top:8px"></div>
    <div class="modal-actions" id="progressActions" style="display:none">
      <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank" class="btn btn-green">Open Gmail Drafts →</a>
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

    // Update progress items with results
    (r.results || []).forEach((res, i) => {
      const el = document.getElementById('pi_' + i);
      if (!el) return;
      if (res.success) {
        el.innerHTML = '<span class="pi-ok">✓</span> <span class="pi-ok">Draft created — ' + esc(res.company_name) + '</span>';
      } else {
        el.innerHTML = '<span class="pi-fail">✗</span> <span class="pi-fail">Failed — ' + esc(res.company_name) + ': ' + esc(res.error || 'unknown error') + '</span>';
      }
    });

    document.getElementById('progressSummary').textContent = 'Complete: ' + r.succeeded + ' of ' + r.total + ' drafts created.';
    document.getElementById('progressActions').style.display = 'flex';
  } catch(err) {
    pList.innerHTML = '<div style="color:#f66">Error: ' + esc(err.message) + '</div>';
    document.getElementById('progressActions').style.display = 'flex';
  }
}

// ── Buyer Database ─────────────────────────────────────────────────────────
async function loadBuyerDb() {
  dbSelectedIds.clear();
  updateDbBulkBar();
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
  const bar = document.getElementById('dbBulkBar');
  const n = dbSelectedIds.size;
  bar.style.display = n > 0 ? 'flex' : 'none';
  document.getElementById('dbSelCount').textContent = n + ' selected';
}

async function toggleBuyerStatus(id, current) {
  const newStatus = current === 'active' ? 'inactive' : 'active';
  await fetch('/api/buyers/' + id, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ status: newStatus }) });
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
  list.innerHTML = records.map(o => \`
    <div class="outreach-card">
      <h4>\${esc(o.brand)} \${esc(o.model||'')} — \${o.quantity} unit\${o.quantity !== 1 ? 's' : ''}</h4>
      <div class="outreach-meta">
        \${o.date ? o.date.slice(0,10) : ''} · \${esc(o.item_type||'')} · \${esc(o.condition||'')} · \${(o.buyer_ids||[]).length} buyer(s) contacted
      </div>
      \${o.gmail_draft_ids && o.gmail_draft_ids.length
        ? '<div style="margin-top:8px;font-size:.8rem"><span style="color:var(--green)">✓ ' + o.gmail_draft_ids.length + ' Gmail draft(s)</span> · <a href="https://mail.google.com/mail/u/0/#drafts" target="_blank">Open Drafts →</a></div>'
        : '<div style="margin-top:8px;font-size:.8rem;color:#666">No drafts</div>'}
      \${o.notes ? '<div style="margin-top:8px;font-size:.8rem;color:#aaa">' + esc(o.notes) + '</div>' : ''}
    </div>
  \`).join('');
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
function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }

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
