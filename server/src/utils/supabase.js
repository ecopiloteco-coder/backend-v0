require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
if (supabaseUrl && supabaseServiceKey) {
  supabase = createClient(supabaseUrl, supabaseServiceKey);
} else {
  console.warn('Supabase server env missing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
}

async function uploadBufferToBucket(buffer, filename, { bucket = 'upload', prefix = 'backend-uploads', contentType = 'application/octet-stream' } = {}) {
  if (!supabase) throw new Error('Supabase client not initialized');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(path, buffer, { contentType, upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { path, publicUrl: data.publicUrl };
}

module.exports = { supabase, uploadBufferToBucket };
// Helper: convert a signed upload URL to a public URL (same object path)
function signedUploadUrlToPublicUrl(signedUrl) {
  try {
    if (!signedUrl || !supabaseUrl) return signedUrl;
    const u = new URL(signedUrl);
    // Expect path like /storage/v1/object/upload/sign/<bucket>/<path>
    // Convert to /storage/v1/object/public/<bucket>/<path>
    const replaced = u.pathname.replace('/storage/v1/object/upload/sign/', '/storage/v1/object/public/');
    return supabaseUrl.replace(/\/$/, '') + replaced;
  } catch {
    return signedUrl;
  }
}

module.exports.signedUploadUrlToPublicUrl = signedUploadUrlToPublicUrl;
module.exports.supabaseUrl = supabaseUrl;

// Extracts the path inside a bucket from a public URL like
// https://<project>.supabase.co/storage/v1/object/public/upload/pending-articles/abc.png
function extractBucketAndPathFromPublicUrl(publicUrl) {
  try {
    if (!publicUrl) return null;
    const u = new URL(publicUrl);
    const parts = u.pathname.split('/');
    // ['', 'storage', 'v1', 'object', 'public', '<bucket>', ...pathParts]
    const bucketIdx = parts.indexOf('public') + 1;
    const bucket = parts[bucketIdx];
    const path = parts.slice(bucketIdx + 1).join('/');
    if (!bucket || !path) return null;
    return { bucket, path };
  } catch {
    return null;
  }
}

async function moveObjectWithinBucket(bucket, fromPath, toPath) {
  if (!supabase) throw new Error('Supabase client not initialized');
  if (fromPath === toPath) return { success: true };
  const { data, error } = await supabase.storage.from(bucket).move(fromPath, toPath);
  if (error) throw error;
  return { success: true };
}

// Move files listed in JSON (array of {url, filename, size}) from pending-articles to articles
// Returns new JSON string with updated urls; skips entries that cannot be parsed/moved
async function moveFilesFromPendingToArticles(filesJsonString) {
  if (!filesJsonString || typeof filesJsonString !== 'string') return filesJsonString;
  let arr;
  try {
    arr = JSON.parse(filesJsonString);
  } catch {
    return filesJsonString;
  }
  if (!Array.isArray(arr)) return filesJsonString;

  const updated = [];
  for (const item of arr) {
    if (!item || !item.url) { updated.push(item); continue; }
    const parsed = extractBucketAndPathFromPublicUrl(item.url);
    if (!parsed) { updated.push(item); continue; }
    const { bucket, path } = parsed;
    if (bucket !== 'upload' || !path.startsWith('pending-articles/')) { updated.push(item); continue; }
    const tail = path.replace(/^pending-articles\//, '');
    const destPath = `articles/${tail}`;
    try {
      await moveObjectWithinBucket(bucket, path, destPath);
      // Build new public URL
      const newPublic = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${bucket}/${destPath}`;
      updated.push({ ...item, url: newPublic });
    } catch (e) {
      // If move fails, keep original
      updated.push(item);
    }
  }
  return JSON.stringify(updated);
}

module.exports.extractBucketAndPathFromPublicUrl = extractBucketAndPathFromPublicUrl;
module.exports.moveObjectWithinBucket = moveObjectWithinBucket;
module.exports.moveFilesFromPendingToArticles = moveFilesFromPendingToArticles;



