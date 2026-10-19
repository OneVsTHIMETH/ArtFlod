/*
 ArtFlod Supabase connector — color/size pricing + employee login
 1) Paste your Supabase Project URL and anon/public key below.
 2) Include this file after the Supabase JS v2 CDN.
 3) Never put a service_role key in a browser file.
*/
(() => {
  'use strict';
  const CONFIG = {
    url: 'https://moyvghsucaqnekasuqei.supabase.co',
    anonKey: 'sb_publishable_DPsnymX67FlaprJJL6vbCw_HvBiDakw',
    bucket: 'artflod-images'
  };
  const ready = () => window.supabase &&
    CONFIG.url.startsWith('https://') &&
    !CONFIG.anonKey.includes('PASTE_');
  let client = null;
  function db() {
    if (!ready()) throw new Error('Add the Supabase Project URL and anon/public key in supabase.js first.');
    if (!client) client = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);
    return client;
  }
  async function uploadImage(file, folder='products') {
    if (!file) return null;
    const safeName = String(file.name || 'image').replace(/[^a-zA-Z0-9._-]/g, '-');
    const path = `${folder}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
    const { data, error } = await db().storage.from(CONFIG.bucket).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type || 'image/jpeg'
    });
    if (error) throw error;
    return db().storage.from(CONFIG.bucket).getPublicUrl(data.path).data.publicUrl;
  }

  async function uploadDataUrlIfNeeded(value, folder) {
    if (typeof value !== 'string' || !value.startsWith('data:')) return value || null;
    const response = await fetch(value);
    const blob = await response.blob();
    const mime = blob.type || 'image/jpeg';
    const ext = (mime.split('/')[1] || 'jpg').replace('jpeg','jpg');
    const file = new File([blob], `image.${ext}`, {type:mime});
    return await uploadImage(file, folder);
  }
  async function productWithHostedImages(product) {
    const p = JSON.parse(JSON.stringify(product || {}));
    p.img = await uploadDataUrlIfNeeded(p.img, 'products/main');
    p.gallery = await Promise.all((p.gallery || []).map((v)=>uploadDataUrlIfNeeded(v,'products/gallery')));
    p.colors = await Promise.all((p.colors || []).map(async (color, index) => {
      const c = {...color};
      c.image = await uploadDataUrlIfNeeded(c.image, `products/colors/${index+1}`);
      c.sizes = (Array.isArray(c.sizes) ? c.sizes : []).map((size, sizeIndex) => {
        const regular = Math.max(0, Number(size.price ?? size.regularPrice ?? size.originalPrice) || 0);
        const rawSale = Math.max(0, Number(size.salePrice) || 0);
        return { ...size, label: String(size.label || `Size ${sizeIndex+1}`), price: regular, salePrice: rawSale > 0 && rawSale < regular ? rawSale : 0 };
      });
      return c;
    }));
    return p;
  }
  const api = {
    client: db,
    // Employee accounts are created in Supabase Dashboard > Authentication.
    async signInEmployee(email, password) {
      const { data, error } = await db().auth.signInWithPassword({ email: String(email || '').trim(), password: String(password || '') });
      if (error) throw error;
      const { data: access, error: accessError } = await db().from('artflod_employee_access').select('user_id,is_active').eq('user_id', data.user.id).eq('is_active', true).maybeSingle();
      if (accessError || !access) {
        await db().auth.signOut();
        throw new Error('This account is not approved for Employee access. Ask the site owner to authorize it.');
      }
      return data;
    },
    async isEmployeeSession() {
      const { data, error } = await db().auth.getSession();
      if (error || !data.session?.user) return false;
      const { data: access, error: accessError } = await db().from('artflod_employee_access').select('user_id,is_active').eq('user_id', data.session.user.id).eq('is_active', true).maybeSingle();
      return !accessError && !!access;
    },
    async signOutEmployee() { const { error } = await db().auth.signOut(); if (error) throw error; },
    onAuthStateChange(callback) { return db().auth.onAuthStateChange(callback); },
    uploadImage,
    async listProducts() {
      const { data, error } = await db().from('artflod_products').select('*').eq('is_active', true).order('created_at', {ascending:false});
      if (error) throw error;
      return (data || []).map(row => row.product_data && Object.keys(row.product_data).length ? row.product_data : ({
        id:row.id, name:row.name, category:row.category, collection:row.collection,
        section:row.main_collection_section, rating:row.rating, reviews:row.review_count,
        description:row.description, img:row.main_image_url, gallery:row.gallery, tags:row.tags,
        qty:row.quantity, stock:{status:row.stock_status,qty:row.quantity}, colors:row.colors_size_pricing
      }));
    },
    async saveProduct(inputProduct) {
      const p = await productWithHostedImages(inputProduct);
      const firstColor = (p.colors || [])[0] || {};
      const firstSize = (firstColor.sizes || [])[0] || {};
      const row = {
        id:String(p.id), name:p.name || 'Untitled', category:p.category || null,
        collection:p.collection || null, main_collection_section:String(p.section || ''),
        rating:Number(p.rating || 0), review_count:Number(p.reviews || 0),
        description:p.description || '', main_image_url:p.img || null,
        gallery:p.gallery || [], tags:p.tags || [], custom_tag_label:(p.tags || []).find(t => !['limited','popular','new','sale','handmade','other'].includes(t)) || null,
        stock_status:p.stock?.status || (Number(p.qty)>0?'in':'out'), quantity:Number(p.stock?.qty ?? p.qty ?? 0),
        colors_size_pricing:p.colors || [], product_data:p, is_active:true, updated_at:new Date().toISOString()
      };
      const { error } = await db().from('artflod_products').upsert(row, {onConflict:'id'});
      if (error) throw error;
      return p;
    },
    async deleteProduct(id) {
      const { error } = await db().from('artflod_products').update({is_active:false,updated_at:new Date().toISOString()}).eq('id',String(id));
      if (error) throw error;
    },
    async listCategories() {
      const {data,error}=await db().from('artflod_categories').select('*').eq('is_active',true).order('name');
      if(error)throw error; return data||[];
    },
    async listCollections() {
      const {data,error}=await db().from('artflod_collections').select('*').eq('is_active',true).order('name');
      if(error)throw error; return data||[];
    },
    async listSections() {
      const {data,error}=await db().from('artflod_sections').select('*').eq('is_active',true).order('name');
      if(error)throw error; return data||[];
    },
    async saveSection(item) {
      const row={id:String(item.id),name:item.name||item.title||'Section',short_description:item.desc||'',section_data:item,is_active:true,updated_at:new Date().toISOString()};
      const {error}=await db().from('artflod_sections').upsert(row,{onConflict:'id'});if(error)throw error;
    },
    async saveCategory(item) {
      const hosted = {...item, image: await uploadDataUrlIfNeeded(item.image, 'categories')};
      const row={id:String(hosted.id),name:hosted.name||'Category',image_url:hosted.image||null,category_data:hosted,is_active:true,updated_at:new Date().toISOString()};
      const {error}=await db().from('artflod_categories').upsert(row,{onConflict:'id'});if(error)throw error;
    },
    async saveCollection(item) {
      const hosted = {...item, image: await uploadDataUrlIfNeeded(item.image, 'collections')};
      const row={id:String(hosted.id),name:hosted.title||hosted.name||'Collection',room_tag:hosted.tag||null,short_description:hosted.desc||'',category_id:hosted.category||null,image_url:hosted.image||null,collection_data:hosted,is_active:true,updated_at:new Date().toISOString()};
      const {error}=await db().from('artflod_collections').upsert(row,{onConflict:'id'});if(error)throw error;
    },
    async deleteRecord(table,id) {
      if (!['artflod_products','artflod_categories','artflod_collections','artflod_sections'].includes(table)) throw new Error('Unsupported table');
      const {error}=await db().from(table).update({is_active:false,updated_at:new Date().toISOString()}).eq('id',String(id));if(error)throw error;
    },
    async listReviews(productId=null) {
      let q=db().from('artflod_customer_reviews').select('*').eq('is_visible',true).order('created_at',{ascending:false});
      if(productId)q=q.eq('product_id',String(productId));
      const {data,error}=await q;if(error)throw error;return data||[];
    },
    async hideReview(id) {
      const {error}=await db().from('artflod_customer_reviews').update({is_visible:false}).eq('id',id);if(error)throw error;
    }
  };
  window.ArtFlodDB = api;
  window.dispatchEvent(new CustomEvent('artflod-db-ready'));
})();