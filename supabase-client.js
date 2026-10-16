/* ArtFlod Supabase browser adapter.
   1) Replace SUPABASE_URL and SUPABASE_ANON_KEY below.
   2) Use only the public anon/publishable key. Never use service_role here.
*/
(function () {
  'use strict';
  const SUPABASE_URL = 'https://jlufegxvuadqfmpydykg.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_FTqxJnjg8qCBPS3jlnG-bw_cTIlweVl';
  const BUCKET = 'artflod-images';
  const STATE_KEYS = [
    'nordic_living_employee_products_v1',
    'nordic_living_employee_meta_v2'
  ];
  const REVIEW_KEY = 'nordic_furniture_reviews_v1';
  if (!window.supabase || SUPABASE_URL.includes('YOUR_PROJECT_ID') || SUPABASE_ANON_KEY.includes('YOUR_SUPABASE')) {
    console.warn('[ArtFlod] Supabase not configured. Edit supabase-client.js first. Local browser mode remains available.');
    return;
  }
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.artflodSupabase = sb;
  let suppressMirror = false;
  let saveTimer = null;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  function safeParse(value) { try { return JSON.parse(value); } catch (_) { return null; } }
  function isDataImage(value) { return typeof value === 'string' && /^data:image\/(png|jpe?g|webp|gif);base64,/i.test(value); }
  async function dataImageToStorage(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[blob.type] || 'jpg';
    const path = `products/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
  async function externalizeImages(value) {
    if (isDataImage(value)) return dataImageToStorage(value);
    if (Array.isArray(value)) return Promise.all(value.map(externalizeImages));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = await externalizeImages(child);
      return out;
    }
    return value;
  }
  async function saveState(key, raw) {
    if (!STATE_KEYS.includes(key)) return;
    const parsed = safeParse(raw);
    if (parsed === null) return;
    const stateValue = await externalizeImages(parsed);
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return; // local edits are not treated as cloud-saved unless an employee is signed in
    const { error } = await sb.from('artflod_app_state').upsert({ state_key: key, state_value: stateValue, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'state_key' });
    if (error) console.error('[ArtFlod] Cloud save failed for', key, error.message);
    else console.info('[ArtFlod] Saved', key, 'to Supabase.');
  }
  function scheduleSave(key, value) {
    if (suppressMirror || !STATE_KEYS.includes(key)) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState(key, value).catch(e => console.error('[ArtFlod] Save error:', e)), 700);
  }
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (this === window.localStorage) scheduleSave(String(key), String(value));
  };

  async function hydrateState() {
    const { data, error } = await sb.from('artflod_app_state').select('state_key,state_value').in('state_key', STATE_KEYS);
    if (error) { console.warn('[ArtFlod] Could not load cloud state:', error.message); return; }
    if (!data || !data.length) return;
    let changed = false;
    suppressMirror = true;
    try {
      for (const row of data) {
        const serialized = JSON.stringify(row.state_value);
        if (localStorage.getItem(row.state_key) !== serialized) {
          originalSetItem.call(localStorage, row.state_key, serialized);
          changed = true;
        }
      }
      // A single reload lets the existing page's current localStorage-backed renderers read cloud state at startup.
      if (changed && !sessionStorage.getItem('artflod_cloud_hydrated_once')) {
        sessionStorage.setItem('artflod_cloud_hydrated_once', '1');
        location.reload();
      }
    } finally { suppressMirror = false; }
  }
  async function syncLocalReviews() {
    const local = safeParse(localStorage.getItem(REVIEW_KEY) || '{}') || {};
    const rows = [];
    for (const [productId, reviews] of Object.entries(local)) {
      if (!Array.isArray(reviews)) continue;
      for (const review of reviews) {
        rows.push({
          client_review_id: String(review.id || crypto.randomUUID()), product_id: String(productId),
          customer_name: String(review.name || 'Customer').slice(0,80), rating: Math.max(1,Math.min(5,Number(review.rating)||5)),
          comment: String(review.comment || '').slice(0,1000), approved: true,
          created_at: review.createdAt || review.date || new Date().toISOString()
        });
      }
    }
    if (!rows.length) return;
    // This runs only for logged-in employees; visitor review submissions are sent directly by submitCustomerReview().
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return;
    const { error } = await sb.from('artflod_reviews').upsert(rows, { onConflict: 'client_review_id', ignoreDuplicates: true });
    if (error) console.warn('[ArtFlod] Existing local reviews were not imported:', error.message);
  }
  async function loadCloudReviews() {
    const { data, error } = await sb.from('artflod_reviews').select('id,client_review_id,product_id,customer_name,rating,comment,created_at').eq('approved', true).order('created_at', { ascending: true }).limit(2000);
    if (error) { console.warn('[ArtFlod] Reviews load failed:', error.message); return; }
    const byProduct = {};
    for (const r of (data || [])) {
      const key = String(r.product_id);
      (byProduct[key] ||= []).push({ id: r.client_review_id || r.id, name: r.customer_name, rating: r.rating, comment: r.comment, date: new Date(r.created_at).toLocaleDateString() });
    }
    suppressMirror = true;
    try { originalSetItem.call(localStorage, REVIEW_KEY, JSON.stringify(byProduct)); }
    finally { suppressMirror = false; }
    // Refresh the open review panel if its renderer exists.
    const product = window.PRODUCTS && window.PRODUCTS.find(p => String(p.id) === String(window.currentFurnitureProductId));
    if (product && typeof window.nlRenderReviews === 'function') window.nlRenderReviews(product);
  }
  window.artflodUploadImage = async function(file) {
    if (!(file instanceof File) || !file.type.startsWith('image/')) throw new Error('Choose an image file.');
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Sign in as an authorized employee before uploading images.');
    const ext = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi,'').toLowerCase();
    const path = `uploads/${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  };
  window.artflodSubmitCustomerReview = async function({ productId, name, rating, comment }) {
    const cleanName = String(name || '').trim().slice(0,80);
    const cleanComment = String(comment || '').trim().slice(0,1000);
    const cleanRating = Math.round(Number(rating));
    if (!String(productId || '').trim() || !cleanName || !cleanComment || cleanRating < 1 || cleanRating > 5) throw new Error('Enter your name, a 1–5 star rating, and a review.');
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from('artflod_reviews').insert({ product_id: String(productId), customer_name: cleanName, rating: cleanRating, comment: cleanComment, approved: true, user_id: user ? user.id : null });
    if (error) throw error;
    await loadCloudReviews();
    return true;
  };
  window.artflodSignOutEmployee = async function() { await sb.auth.signOut(); location.reload(); };
  window.addEventListener('load', async function() {
    await hydrateState();
    await loadCloudReviews();
    await syncLocalReviews();
    // Re-check role and cloud availability on each page load; RLS remains the security boundary.
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const { data: role } = await sb.from('artflod_employee_roles').select('role').eq('user_id', user.id).maybeSingle();
      if (role && ['admin','employee'].includes(role.role)) {
        console.info('[ArtFlod] Employee session active.');
        // First signed-in employee visit: seed missing cloud state from the existing browser's saved product/meta data.
        const { data: existing, error: stateError } = await sb.from('artflod_app_state').select('state_key').in('state_key', STATE_KEYS);
        if (!stateError) {
          const existingKeys = new Set((existing || []).map(row => row.state_key));
          for (const key of STATE_KEYS) {
            const localValue = localStorage.getItem(key);
            if (!existingKeys.has(key) && localValue && safeParse(localValue) !== null) {
              try { await saveState(key, localValue); } catch (e) { console.warn('[ArtFlod] Could not seed cloud state for', key, e.message); }
            }
          }
        }
      }
    }
  });
})();
