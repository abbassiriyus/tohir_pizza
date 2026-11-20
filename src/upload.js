const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const UPLOAD_PREFIX = '/uploads/';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const MAX_MB = 5;

const badRequest = (msg) => Object.assign(new Error(msg), { status: 400 });

// multipart/form-data bo'lmasa, multer hech narsa qilmaydi (oddiy JSON so'rovlar o'zgarishsiz o'tadi)
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + IMAGE_TYPES[file.mimetype]),
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) =>
    IMAGE_TYPES[file.mimetype] ? cb(null, true) : cb(badRequest('Faqat JPG, PNG, WEBP yoki GIF rasm yuklash mumkin')),
});

const isLocal = (v) => typeof v === 'string' && v.startsWith(UPLOAD_PREFIX);

// Yuklangan faylni o'chirish (faqat bizning uploads papkadagi fayllar; tashqi linklarga tegmaydi)
function removeLocal(v) {
  if (!isLocal(v)) return;
  const file = path.join(UPLOAD_DIR, path.basename(v));
  fs.unlink(file, () => {});
}

/**
 * Rasm qiymatini aniqlaydi: avval yuklangan fayl, bo'lmasa body'dagi link.
 * Qaytaradi: { value } | { error } | {} (maydon umuman yuborilmagan bo'lsa).
 */
function resolveImage(req, field) {
  if (req.file) return { value: UPLOAD_PREFIX + req.file.filename };
  const raw = req.body?.[field] ?? req.body?.[`${field}_url`];
  if (raw === undefined || raw === null) return raw === null ? { value: '' } : {};
  const s = String(raw).trim();
  if (s === '') return { value: '' };
  if (isLocal(s)) return LOCAL_RE.test(s) ? { value: s } : { error: `${field}: noto'g'ri fayl yo'li` };
  let url;
  try { url = new URL(s); } catch { url = null; }
  if (!url || !['http:', 'https:'].includes(url.protocol))
    return { error: `${field}: http(s) havola yoki rasm fayli bo'lishi kerak` };
  // Frontend GET'da olgan to'liq URL'ni qaytarib yuborsa — uni yana lokal yo'lga aylantiramiz
  if (LOCAL_RE.test(url.pathname) && ownHosts(req).includes(url.host)) return { value: url.pathname };
  return { value: s };
}

const LOCAL_RE = /^\/uploads\/[\w-]+\.(jpg|png|webp|gif)$/;

function ownHosts(req) {
  const hosts = [req.get('host')];
  try { if (process.env.PUBLIC_URL) hosts.push(new URL(process.env.PUBLIC_URL).host); } catch {}
  return hosts;
}

// Bazada /uploads/... saqlanadi; javobda to'liq URL qaytariladi (frontend boshqa domenda bo'lsa ham ishlashi uchun)
function publicUrl(req, v) {
  if (!isLocal(v)) return v;
  const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  return base + v;
}

module.exports = { upload, UPLOAD_DIR, MAX_MB, resolveImage, removeLocal, publicUrl };
