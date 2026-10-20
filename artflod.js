/* ArtFlod combined Supabase JavaScript.
   1) Replace the URL and publishable/anon key below with your own Supabase project values.
   2) Never put a service_role/secret key in browser code.
*/
/* Fill these two values from Supabase Project Settings -> API. Use the publishable/anon key only. NEVER put service_role/secret keys in browser code. */
window.ARTFLOD_SUPABASE_URL = 'https://vyshsqekmkktxeuikoqf.supabase.co';
window.ARTFLOD_SUPABASE_ANON_KEY = 'sb_publishable_2JITxv8-C1-4smzXfAo0ug_Z04g3Tzo';


/* ---- ArtFlod Supabase integration ---- */
/* ArtFlod Supabase integration. Public catalogue + public customer reviews; employee writes require Supabase Auth AND artflod_employee_access membership. */
(function(){
 'use strict';
 const URL=window.ARTFLOD_SUPABASE_URL, KEY=window.ARTFLOD_SUPABASE_ANON_KEY;
 if(!URL || !KEY || URL.includes('PASTE-YOUR') || KEY.includes('PASTE-YOUR')) {
   console.warn('ArtFlod: add your Supabase project URL and anon/public key in artflod.js to enable secure employee authentication and cloud sync.');
   // Keep the Employee Sign In option visible even before Supabase credentials are configured.
   const $missing=id=>document.getElementById(id);
   const login=$missing('nlEmployeeLoginOverlay'), form=$missing('nlEmployeeLoginForm'), empBtn=$missing('nlEmployeeBtn');
   const show=()=>{if(login){login.classList.add('open');login.setAttribute('aria-hidden','false');}};
   const hide=()=>{if(login){login.classList.remove('open');login.setAttribute('aria-hidden','true');}};
   if(empBtn) empBtn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();show();},true);
   $missing('nlEmployeeLoginClose')?.addEventListener('click',hide);
   if(login) login.addEventListener('click',e=>{if(e.target===login)hide();});
   if(form) form.addEventListener('submit',function(e){e.preventDefault();const error=$missing('nlEmployeeLoginError');if(error)error.textContent='Setup required: add your Supabase Project URL and anon/publishable key in artflod.js, then reload this website.';});
   return;
 }
 if(!window.supabase?.createClient) { console.error('Supabase JS library failed to load.'); return; }
 const db=window.supabase.createClient(URL,KEY); window.artflodSupabase=db;
 const PRODUCT_KEY='nordic_living_employee_products_v1', META_KEY='nordic_living_employee_meta_v2', REVIEW_KEY='nordic_furniture_reviews_v1';
 let employee=false, syncing=false;
 const $=id=>document.getElementById(id);
 function msg(t){const e=$('nlEmployeeLoginError');if(e)e.textContent=t;}
 async function checkEmployee(){const {data:{user},error}=await db.auth.getUser(); if(error||!user){employee=false;return false;} const {data,error:e}=await db.from('artflod_employee_access').select('user_id').eq('user_id',user.id).maybeSingle(); employee=!e&&!!data; return employee;}
 async function saveProductsToCloud(){if(syncing)return;let products;try{products=JSON.parse(localStorage.getItem(PRODUCT_KEY)||'[]')}catch(e){return} if(!Array.isArray(products))return; const {error}=await db.from('artflod_products').upsert({id:'catalogue',products:products,updated_at:new Date().toISOString()},{onConflict:'id'}); if(error)console.error('Supabase product save failed:',error.message);}
 async function loadProducts(){const {data,error}=await db.from('artflod_products').select('products').eq('id','catalogue').maybeSingle();if(error){console.warn('Supabase product load:',error.message);return} if(data&&Array.isArray(data.products)&&data.products.length){syncing=true;localStorage.setItem(PRODUCT_KEY,JSON.stringify(data.products));syncing=false; try{if(typeof rerenderAll==='function')rerenderAll();}catch(e){} try{if(typeof nlRenderProductRows==='function')nlRenderProductRows();}catch(e){} }}
 // Store the catalogue AND category/outfit/section manager data in Supabase. Deletions are persisted as part of the full current JSON state.
 const nativeSet=Storage.prototype.setItem;
 async function saveSiteData(key,value){
   if(!await checkEmployee()){console.error('ArtFlod collection was not saved online: sign in with an authorized Supabase employee account.');return false;}
   let parsed;try{parsed=JSON.parse(value)}catch(e){console.error('ArtFlod metadata JSON is invalid:',e);return false;}
   const {error}=await db.from('artflod_site_data').upsert({key:key,value:parsed,updated_at:new Date().toISOString()},{onConflict:'key'});
   if(error){console.error('ArtFlod collection save failed:',error.message);return false;}
   console.info('ArtFlod collection/category saved to Supabase.');return true;
 }
 async function applyCloudSiteData(value){
   if(!value||typeof value!=='object')return;
   const next=JSON.stringify(value),prev=localStorage.getItem(META_KEY);
   if(prev!==next){syncing=true;try{nativeSet.call(localStorage,META_KEY,next);}finally{syncing=false;}}
   // Critical: the storefront manager caches metadata in a closure. Update that in-memory
   // object as well as localStorage, otherwise customer cards remain stale until reload.
   if(typeof window.applyArtFlodMetadata==='function')window.applyArtFlodMetadata(value);
   else {try{window.dispatchEvent(new CustomEvent('artflod:metadata-updated',{detail:value}));}catch(e){}}
 }
 async function loadSiteData(){
   const {data,error}=await db.from('artflod_site_data').select('key,value').eq('key',META_KEY).maybeSingle();
   if(error){console.error('ArtFlod collection data could not load:',error.message);return;}
   if(data&&data.value&&typeof data.value==='object')await applyCloudSiteData(data.value);
 }
 Storage.prototype.setItem=function(k,v){nativeSet.call(this,k,v);if(syncing)return;if(k===PRODUCT_KEY){checkEmployee().then(ok=>{if(ok)saveProductsToCloud();else console.warn('Product changes were not uploaded: sign in with an authorized employee account.');});}else if(k===META_KEY){saveSiteData(k,v);}};
 // Pull saved employee-created categories, outfit collections and section configuration from the live database.

 // Reviews are stored by product ID in the existing UI; migrate/read/write the shared database table.
 async function loadReviews(){const {data,error}=await db.from('artflod_reviews').select('id,product_id,name,comment,rating,created_at').order('created_at',{ascending:false});if(error){console.warn('Review load:',error.message);return} const all={};for(const r of data||[]){(all[r.product_id] ||= []).push({id:r.id,name:r.name,comment:r.comment,rating:r.rating,date:new Date(r.created_at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'})})} syncing=true;nativeSet.call(localStorage,REVIEW_KEY,JSON.stringify(all));syncing=false;try{if(typeof window.nlRenderReviews==='function'){const p=window.PRODUCTS||[];if(p.length)window.nlRenderReviews(p[0]);}}catch(e){}}
 // Submit review to database using the current form values. Public users can add reviews under RLS validation.
 const originalPost=window.nlPostReview;
 window.nlPostReview=async function(productId){const name=($('nlReviewName')?.value||'').trim(),comment=($('nlReviewComment')?.value||'').trim(),rating=Number($('nlReviewRating')?.value||0),error=$('nlReviewError');if(!name||!comment||rating<1||rating>5){if(error){error.textContent='Please choose a rating, enter your name and write a comment.';error.classList.add('show')}return false;} const {error:err}=await db.from('artflod_reviews').insert({product_id:String(productId),name:name.slice(0,80),comment:comment.slice(0,1000),rating:Math.round(rating)});if(err){if(error){error.textContent='Review could not be saved online. Please try again.';error.classList.add('show')}console.error(err.message);return false;}if($('nlReviewName'))$('nlReviewName').value='';if($('nlReviewComment'))$('nlReviewComment').value='';await loadReviews();try{if(typeof window.nlRenderReviews==='function'){const p=(window.PRODUCTS||[]).find(x=>String(x.id)===String(productId))||{id:productId};window.nlRenderReviews(p)}}catch(e){}if(typeof window.showToast==='function')window.showToast('Thank you! Your review was posted.');return false;};
 // Employee login gate: block the existing Employee button until an allow-listed user signs in.
 const loginOverlay=$('nlEmployeeLoginOverlay'), loginForm=$('nlEmployeeLoginForm'), employeeBtn=$('nlEmployeeBtn');
 function showLogin(){if(loginOverlay){loginOverlay.classList.add('open');loginOverlay.setAttribute('aria-hidden','false');setTimeout(()=>$('nlEmployeeLoginEmail')?.focus(),50);}}
 function hideLogin(){if(loginOverlay){loginOverlay.classList.remove('open');loginOverlay.setAttribute('aria-hidden','true');}}
 function closeEmployeeManager(){const panel=$('nlEmployeeOverlay');if(panel){panel.classList.remove('open');panel.setAttribute('aria-hidden','true');}}
 async function refreshEmployeeState(){employee=await checkEmployee();updateLogoutUi();return employee;}
 function updateLogoutUi(){
   const head=document.querySelector('#nlEmployeeOverlay .nl-employee-head');if(!head)return;
   let tools=head.querySelector('.artflod-auth-tools');
   if(!tools){tools=document.createElement('div');tools.className='artflod-auth-tools';tools.style.cssText='display:flex;align-items:center;gap:8px;margin-left:auto;margin-right:8px;';
     const status=document.createElement('span');status.className='artflod-auth-status';status.style.cssText='font-size:11px;color:#557064;font-weight:700;';status.textContent='Signed in';
     const logout=document.createElement('button');logout.type='button';logout.className='nl-emp-btn';logout.textContent='Log Out';logout.setAttribute('aria-label','Log out of employee account');logout.style.cssText='display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:7px 13px;border:1px solid #b8c9c0;border-radius:8px;background:#fff;color:#29483d;font-weight:700;cursor:pointer;';logout.addEventListener('click',async()=>{logout.disabled=true;try{await db.auth.signOut();employee=false;closeEmployeeManager();showLogin();msg('You have signed out.');}catch(err){console.error(err);msg('Could not sign out. Please try again.');}finally{logout.disabled=false;}});
     tools.append(status,logout);const close=$('nlEmployeeClose');head.insertBefore(tools,close||null);
   }
   tools.style.display=employee?'flex':'none';
 }
 if(employeeBtn){employeeBtn.addEventListener('click',async function(e){
   if(employee)return;
   e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();
   if(await refreshEmployeeState()) { employeeBtn.click(); return; }
   showLogin();
 },true);}
 if($('nlEmployeeLoginClose'))$('nlEmployeeLoginClose').addEventListener('click',hideLogin);
 if(loginOverlay)loginOverlay.addEventListener('click',e=>{if(e.target===loginOverlay)hideLogin();});
 if(loginForm)loginForm.addEventListener('submit',async function(e){
   e.preventDefault();const email=$('nlEmployeeLoginEmail')?.value.trim(),password=$('nlEmployeeLoginPassword')?.value,btn=$('nlEmployeeLoginSubmit');
   if(btn){btn.disabled=true;btn.textContent='Signing in…'}msg('');
   try{
     const {error}=await db.auth.signInWithPassword({email,password});
     if(error){msg('Sign-in failed. Check your email and password.');return;}
     if(!await checkEmployee()) {await db.auth.signOut();employee=false;msg('This account is not authorized. Add its Supabase user UUID to artflod_employee_access.');return;}
     employee=true;hideLogin();updateLogoutUi();
     // Trigger the original Employee Manager handler only after the authorization gate has passed.
     if(employeeBtn)employeeBtn.click();
   }catch(err){console.error(err);msg('Could not sign in. Check the Supabase URL/key and try again.');}
   finally{if(btn){btn.disabled=false;btn.textContent='Sign In'}}
 });
 const managerOverlay=$('nlEmployeeOverlay');
 if(managerOverlay){new MutationObserver(()=>{if(managerOverlay.classList.contains('open'))updateLogoutUi();}).observe(managerOverlay,{attributes:true,attributeFilter:['class']});}
 db.auth.onAuthStateChange((_event)=>{setTimeout(()=>refreshEmployeeState().catch(()=>{}),0);});
 // A signed-in Auth user without an allow-list row is not an employee.
 refreshEmployeeState().catch(()=>{});
 // Download uploads to Supabase Storage in future upload flow via this helper; return a public URL for saving in product JSON.
 window.artflodUploadImage=async function(file,folder='products'){if(!file)throw new Error('Choose an image first.');if(!await checkEmployee())throw new Error('Employee sign-in required.');if(!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type))throw new Error('Use JPG, PNG, WEBP, GIF or AVIF images.');if(file.size>8*1024*1024)throw new Error('Image must be 8 MB or smaller.');const ext=(file.name.split('.').pop()||'jpg').toLowerCase().replace(/[^a-z0-9]/g,'');const path=folder+'/'+crypto.randomUUID()+'.'+ext;const {error}=await db.storage.from('artflod-images').upload(path,file,{upsert:false,contentType:file.type});if(error)throw error;return db.storage.from('artflod-images').getPublicUrl(path).data.publicUrl;};
 // Initial load, then subscribe to administrator edits on other devices.
 db.auth.onAuthStateChange((_event)=>{checkEmployee().catch(()=>{});});
 Promise.all([loadProducts(),loadReviews(),loadSiteData()]).catch(console.error);
 db.channel('artflod-live-catalogue').on('postgres_changes',{event:'*',schema:'public',table:'artflod_products'},()=>loadProducts()).subscribe();
 db.channel('artflod-live-site-data').on('postgres_changes',{event:'*',schema:'public',table:'artflod_site_data',filter:'key=eq.'+META_KEY},payload=>{const row=payload.new;if(row&&row.key===META_KEY&&row.value)applyCloudSiteData(row.value).catch(err=>console.error('ArtFlod live collection update failed:',err));}).subscribe((status,error)=>{if(status==='CHANNEL_ERROR'||status==='TIMED_OUT')console.error('ArtFlod live collection subscription failed:',status,error||'');});
})();
