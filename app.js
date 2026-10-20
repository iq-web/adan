/* لوحة الإدارة والتوجيه والتخزين التجريبي المحلي. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
  const fmt = value => `${Math.round(Number(value) || 0).toLocaleString('en-US')} د.ع`;
  const nowIso = () => new Date().toISOString();
  const defaultLoginHash = 'ebc7c916268f5822c2c6b0128caaea10986edd37e58db908e02d9606882890e1';
  const DB_NAME = 'taj-aden-demo';
  const DB_STORE = 'website';
  const THEME_KEY = 'taj_theme';
  const SESSION_KEY = 'taj_admin_session';
  const SESSION_AT = 'taj_admin_activity';
  const LOCK_KEY = 'taj_login_lock';
  const $root = $('#adminRoot');
  const model = window.TajAden;
  if (!model) {
    console.error('تعذّر تحميل بيانات المتجر قبل لوحة الإدارة.');
    return;
  }

  let db;
  let offers = [];
  let settings = {
    whatsapp: model.config.contact.whatsapp,
    telegram: model.config.contact.telegram,
    instagram: model.config.contact.instagram,
    address: 'العراق',
    hours: 'يوميًا، بالتنسيق عبر الهاتف',
    theme: localStorage.getItem(THEME_KEY) || 'royal'
  };
  let tab = 'overview';
  let productQuery = '';
  let productFilter = 'all';
  let editingId = null;
  let formImages = [];
  let lastDeleted = null;
  let deleteTimer = 0;
  let idleTimer = 0;
  let routeTransition = null;
  let offerQuery = '';
  let categories = model.categories;

  function toast(message, action) {
    const wrap = $('#toasts');
    if (!wrap) return;
    const item = document.createElement('div');
    item.className = 'toast';
    item.innerHTML = `<span>${esc(message)}</span>${action ? `<button type="button" data-admin-action="${esc(action)}">${action === 'undo-delete' ? 'تراجع' : 'إغلاق'}</button>` : ''}`;
    wrap.appendChild(item);
    setTimeout(() => {
      item.classList.add('out');
      setTimeout(() => item.remove(), 380);
    }, 3500);
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('هذا المتصفح لا يدعم التخزين المحلي IndexedDB.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('تعذّر فتح قاعدة البيانات المحلية.'));
    });
  }

  function readState() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const request = tx.objectStore(DB_STORE).get('site');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error('تعذّرت قراءة بيانات الموقع.'));
    });
  }

  function saveState() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({
        products: model.products,
        categories,
        offers,
        settings,
        savedAt: nowIso()
      }, 'site');
      tx.oncomplete = () => { scheduleOfferRefresh();resolve(); };
      tx.onerror = () => reject(tx.error || new Error('تعذّر حفظ البيانات. قد تكون مساحة المتصفح ممتلئة.'));
      tx.onabort = () => reject(tx.error || new Error('أُلغِي حفظ البيانات.'));
    });
  }

  function showError(error) {
    console.error(error);
    toast(error?.message || 'حدث خطأ غير متوقع.');
  }

  function prepareProduct(product) {
    if (!product.stock) product.stock = { status: 'available', qty: 0 };
    if (!Array.isArray(product.images)) product.images = product.photo ? [product.photo] : [];
    if (!Array.isArray(product.specs)) product.specs = [];
    if (product.published === undefined) product.published = true;
    if (product.basePrice === undefined) product.basePrice = Number(product.old) || Number(product.price) || 0;
    if (!product.sub) product.sub = '';
    return product;
  }

  function loadSeedOffers() {
    const endsAt = model.config.offers.endsAt;
    model.products.forEach(product => {
      prepareProduct(product);
      if (product.old && !product.offerId) {
        product.offerId = `seed-${product.id}`;
        product.offerEndsAt = endsAt;
        offers.push({
          id: product.offerId,
          name: `عرض ${product.name}`,
          type: 'new-price',
          reason: 'عرض تأسيسي',
          value: Number(product.price),
          startsAt: new Date(Date.now() - 86400000).toISOString(),
          endsAt,
          productIds: [product.id]
        });
      }
    });
  }

  function offerStatus(offer) {
    const start = Date.parse(offer.startsAt || 0);
    const end = Date.parse(offer.endsAt || 0);
    if (end <= Date.now()) return 'منتهي';
    if (start > Date.now()) return 'مجدول';
    return 'فعّال';
  }

  function calculateOffer(base, offer) {
    const value = Math.max(0, Number(offer.value) || 0);
    if (offer.type === 'percent') return Math.max(0, Math.round(base * (1 - Math.min(value, 100) / 100)));
    if (offer.type === 'amount') return Math.max(0, Math.round(base - value));
    return Math.max(0, Math.round(value));
  }

  function syncOffers() {
    model.products.forEach(product => {
      prepareProduct(product);
      const offer = offers.find(item => item.id === product.offerId && item.productIds.includes(product.id));
      if (!offer || offerStatus(offer) === 'منتهي') {
        if (product.offerId) {
          product.price = Number(product.basePrice) || product.price;
          product.old = null;
          product.offerId = '';
          product.offerEndsAt = '';
        }
        return;
      }
      if (offerStatus(offer) === 'فعّال') {
        const base = Number(product.basePrice) || Number(product.old) || Number(product.price);
        product.old = base > Number(product.price) ? base : Math.max(base, Number(product.price));
        product.price = calculateOffer(base, offer);
        product.offerEndsAt = offer.endsAt;
      }
    });
    const nextExpiry = offers.filter(item => offerStatus(item) === 'فعّال').sort((a,b) => Date.parse(a.endsAt)-Date.parse(b.endsAt))[0];
    if (nextExpiry) model.config.offers.endsAt = nextExpiry.endsAt;
    model.refresh();
  }

  let offerRefreshTimer = 0;
  function scheduleOfferRefresh() {
    clearTimeout(offerRefreshTimer);
    if (!offers.length) return;
    const nextChange = offers.flatMap(offer => [Date.parse(offer.startsAt||0),Date.parse(offer.endsAt||0)])
      .filter(time => Number.isFinite(time) && time > Date.now()).sort((a,b)=>a-b)[0];
    if (!nextChange) return;
    offerRefreshTimer=setTimeout(async()=>{
      const expired=offers.some(offer=>offerStatus(offer)==='منتهي'&&offer.productIds.some(id=>model.products.some(product=>product.offerId===offer.id)));
      syncOffers();
      try { await saveState(); } catch(error) { showError(error); }
      if(expired)toast('انتهى عرض. عادت الأسعار الأصلية تلقائيًا.');
      if(location.hash.startsWith('#/offers')&&!activeOffers().length)location.hash='#home';
      if(document.body.classList.contains('route-admin'))renderAdminTab();
    },Math.min(Math.max(50,nextChange-Date.now()+100),24*60*60*1000));
  }

  function activeOffers() {
    return offers.filter(item => offerStatus(item) === 'فعّال');
  }

  function adminAuthenticated() {
    const token = localStorage.getItem(SESSION_KEY);
    const activity = Number(localStorage.getItem(SESSION_AT) || 0);
    return Boolean(token && activity && Date.now() - activity < 15 * 60 * 1000);
  }

  function logout(showMessage = false) {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_AT);
    clearTimeout(idleTimer);
    document.body.classList.remove('route-admin');
    if (location.hash.startsWith('#/admin')) location.hash = '#home';
    if (showMessage) toast('تم تسجيل الخروج.');
  }

  function refreshIdle() {
    if (!adminAuthenticated()) return;
    localStorage.setItem(SESSION_AT, String(Date.now()));
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => logout(true), 15 * 60 * 1000);
  }

  function applyTheme(theme, transitionEvent) {
    const themes = { royal: 'royal', ivory: 'ivory', night: 'night' };
    settings.theme = themes[theme] || 'royal';
    const updateTheme = () => {
      if (settings.theme === 'royal') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.dataset.theme = settings.theme;
    };
    if (transitionEvent && !matchMedia('(prefers-reduced-motion: reduce)').matches && document.startViewTransition) {
      document.documentElement.style.setProperty('--theme-x', `${transitionEvent.clientX || innerWidth / 2}px`);
      document.documentElement.style.setProperty('--theme-y', `${transitionEvent.clientY || innerHeight / 2}px`);
      document.startViewTransition(updateTheme);
    } else updateTheme();
    localStorage.setItem(THEME_KEY, settings.theme);
  }

  function routeView() {
    const hash = location.hash || '#home';
    const route = hash.slice(1);
    document.body.classList.remove('route-browse', 'route-offers', 'route-admin');
    if (route.startsWith('/admin')) {
      if (!adminAuthenticated()) {
        location.hash = '#home';
        $('#menuBtn')?.click();
        toast('سجّل الدخول بحساب الإدارة أولًا.');
        return;
      }
      document.body.classList.add('route-admin');
      refreshIdle();
      renderAdmin();
      document.title = 'لوحة الإدارة — تاج عدن';
      return;
    }
    if (route.startsWith('/browse')) {
      document.body.classList.add('route-browse');
      const [, , cat = 'all', ...subParts] = route.split('/');
      let sub = '';
      try { sub = subParts.length ? decodeURIComponent(subParts.join('/')) : ''; }
      catch { location.hash='#/browse';return; }
      const validCat = cat === 'all' || categories.some(item => item.id === cat) ? cat : 'all';
      model.filter(validCat, sub);
      const search = $('#search');
      if (search) search.value = '';
      const title = validCat === 'all' ? 'كل المنتجات' : categories.find(item => item.id === validCat)?.name || 'المنتجات';
      const heading = $('#productTitle');
      if (heading) heading.textContent = title;
      document.title = `${title} — تاج عدن`;
      if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    if (route.startsWith('/offers')) {
      if (!activeOffers().length) {
        location.hash = '#home';
        toast('لا توجد عروض فعّالة حاليًا.');
        return;
      }
      document.body.classList.add('route-offers');
      document.title = 'العروض — تاج عدن';
      return;
    }
    document.title = 'تاج عدن — تجهيز المطاعم والكوفيات';
  }

  function routeChanged() {
    const change = () => routeView();
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      change();
      return;
    }
    const previous = routeTransition;
    routeTransition = null;
    try {
      if (previous?.skipTransition) {
        try {
          previous.skipTransition();
        } catch (error) {
          if (error.name !== 'InvalidStateError') throw error;
        }
      }
      const transition = document.startViewTransition(change);
      routeTransition = transition;
      transition.ready.catch(error => {
        if (error.name === 'TimeoutError') {
          try {
            transition.skipTransition();
            console.warn('استمر التنقل دون حركة انتقال الصفحة بسبب تأخر تحديث المحتوى.');
          } catch (skipError) {
            if (skipError.name !== 'InvalidStateError') {
              console.warn('تعذّر تجاوز حركة انتقال الصفحة؛ سيبقى المسار الحالي ظاهرًا.',skipError);
            }
          }
        } else if (error.name !== 'AbortError' && error.name !== 'InvalidStateError') {
          console.error('تعذّر تهيئة انتقال الصفحة.',error);
        }
      });
      transition.finished.catch(error => {
        if (error.name !== 'AbortError' && error.name !== 'InvalidStateError' && error.name !== 'TimeoutError') {
          console.error('تعذّر إنهاء انتقال الصفحة.',error);
        }
      }).finally(() => {
        if (routeTransition === transition) routeTransition = null;
      });
    } catch (error) {
      if (error.name !== 'InvalidStateError' && error.name !== 'AbortError') {
        console.error('تعذّر تشغيل انتقال الصفحة؛ سيُعرض المسار مباشرةً.',error);
      }
      change();
    }
  }

  function renderAdmin() {
    if (!$root || !adminAuthenticated()) return;
    $root.innerHTML = `<div class="admin-shell">
      <header class="admin-head"><div><h1>لوحة تاج عدن</h1><p>إدارة المتجر والعروض والإعدادات.</p></div><button class="btn btn-ghost" type="button" data-admin-action="logout">تسجيل الخروج</button></header>
      <div class="admin-warning">وضع تجريبي محلي: البيانات محفوظة في هذا المتصفح فقط، وتسجيل الدخول ليس حماية إنتاجية. لا ترفع هذه النسخة مباشرةً لموقع حقيقي.</div>
      <nav class="admin-tabs" aria-label="أقسام الإدارة" role="tablist">
        ${[['overview','نظرة عامة'],['products','المنتجات'],['offers','العروض'],['settings','الفئات والإعدادات']].map(([id,label]) => `<button class="admin-tab" type="button" role="tab" aria-selected="${tab === id}" data-admin-tab="${id}">${label}</button>`).join('')}
      </nav><section id="adminContent" aria-live="polite"></section></div>`;
    renderAdminTab();
  }

  function renderAdminTab() {
    const content = $('#adminContent');
    if (!content) return;
    if (tab === 'overview') {
      const out = model.products.filter(item => item.stock?.status === 'out').length;
      content.innerHTML = `<div class="admin-stats">
        ${[['المنتجات',model.products.length],['العروض الفعّالة',activeOffers().length],['نفدت كميتها',out],['الفئات',categories.length]].map(([label,value]) => `<article class="admin-card"><small>${label}</small><strong data-counter="${value}">0</strong></article>`).join('')}
      </div><div class="admin-card" style="margin-top:16px"><h2>ابدأ من هنا</h2><p>انشر منتجًا جديدًا، أضف صورًا متعددة، أو أنشئ عرضًا مؤقتًا. كل تغييراتك محفوظة محليًا في هذا المتصفح.</p><button class="btn btn-primary" type="button" data-admin-action="new-product">إضافة منتج</button></div>`;
      content.querySelectorAll('[data-counter]').forEach(el => {
        const end = Number(el.dataset.counter);
        const start = performance.now();
        const step = time => {
          const progress = Math.min(1, (time - start) / 650);
          el.textContent = String(Math.round(end * (1 - Math.pow(1 - progress, 3))));
          if (progress < 1) requestAnimationFrame(step);
        };
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) el.textContent = String(end);
        else requestAnimationFrame(step);
      });
    } else if (tab === 'products') renderProductsAdmin(content);
    else if (tab === 'offers') renderOffersAdmin(content);
    else if (tab === 'settings') renderSettings(content);
  }

  function renderProductsAdmin(content) {
    const list = model.products.filter(product => {
      const query = productQuery.trim().toLowerCase();
      const matchText = !query || `${product.name} ${product.desc}`.toLowerCase().includes(query);
      const matchFilter = productFilter === 'all' || (productFilter === 'hidden' ? product.published === false : product.stock?.status === productFilter);
      return matchText && matchFilter;
    });
    content.innerHTML = `<div class="admin-toolbar">
      <input id="adminProductSearch" type="search" placeholder="بحث بالاسم والوصف..." value="${esc(productQuery)}" aria-label="بحث المنتجات">
      <select id="adminProductFilter" aria-label="فلترة المنتجات"><option value="all">كل الحالات</option><option value="available">متوفر</option><option value="limited">كمية محدودة</option><option value="out">نفدت الكمية</option><option value="hidden">مخفي</option></select>
      <button class="btn btn-primary" type="button" data-admin-action="new-product">نشر منتج</button>
      <button class="admin-chip" type="button" data-admin-action="bulk-hide">إخفاء المحدد</button><button class="admin-chip" type="button" data-admin-action="bulk-delete">حذف المحدد</button>
    </div><div class="admin-list">${list.length ? list.map((product, index) => `<article class="admin-row" style="animation-delay:${Math.min(index,12)*35}ms">
      <div><label><input type="checkbox" data-product-select="${esc(product.id)}" aria-label="تحديد ${esc(product.name)}"> <strong>${esc(product.name)}</strong></label>
      <p>${esc(categories.find(item => item.id === product.cat)?.name || 'فئة غير معروفة')} · ${fmt(product.price)} · ${product.published === false ? 'مخفي' : product.stock?.status === 'out' ? 'نفدت الكمية' : product.stock?.status === 'limited' ? `كمية محدودة (${Number(product.stock.qty)||0})` : 'متوفر'}</p></div>
      <div class="admin-actions"><button type="button" data-admin-action="edit-product" data-id="${esc(product.id)}">تعديل</button><button type="button" data-admin-action="copy-product" data-id="${esc(product.id)}">نسخ</button><button type="button" data-admin-action="stock-out" data-id="${esc(product.id)}">نفدت الكمية</button><button type="button" data-admin-action="delete-product" data-id="${esc(product.id)}">حذف</button></div>
    </article>`).join('') : '<div class="admin-empty">لا توجد منتجات مطابقة.</div>'}</div>`;
    $('#adminProductFilter').value = productFilter;
  }

  function renderProductForm(product) {
    editingId = product?.id || null;
    const item = product ? prepareProduct(product) : {
      id: '', cat: categories[0]?.id || '', sub: '', name: '', desc: '', specs: [],
      price: 0, old: null, basePrice: 0, images: [], featured: 0,
      stock: { status: 'available', qty: 0 }, published: true
    };
    formImages = [...(item.images || [])];
    const offer = offers.find(candidate => candidate.productIds.includes(item.id) && offerStatus(candidate) !== 'منتهي');
    const cats = categories.map(category => `<option value="${esc(category.id)}" ${item.cat === category.id ? 'selected' : ''}>${esc(category.name)}</option>`).join('');
    const endLocal = offer?.endsAt ? new Date(offer.endsAt).toISOString().slice(0,16) : new Date(Date.now()+7*86400000).toISOString().slice(0,16);
    $('#adminContent').innerHTML = `<form id="productForm" class="admin-form" novalidate>
      <h2 class="wide">${editingId ? 'تعديل المنتج' : 'نشر منتج جديد'}</h2>
      <label>الفئة<select name="cat" required>${cats}</select></label>
      <label>التصنيف الفرعي<input name="sub" value="${esc(item.sub)}" maxlength="70"></label>
      <label>اسم المنتج<input name="name" value="${esc(item.name)}" required maxlength="100"></label>
      <label>السعر بالدينار العراقي<input name="price" type="number" min="1" step="1" value="${Number(offer?.type ? item.basePrice : item.price)||''}" required inputmode="numeric"></label>
      <label class="wide">الوصف<textarea name="desc" maxlength="500" required>${esc(item.desc)}</textarea></label>
      <label class="wide">المواصفات — ميزة واحدة في كل سطر<textarea name="specs" maxlength="1500">${esc((item.specs||[]).join('\n'))}</textarea></label>
      <label>حالة المخزون<select name="stockStatus"><option value="available" ${item.stock.status==='available'?'selected':''}>متوفر</option><option value="limited" ${item.stock.status==='limited'?'selected':''}>كمية محدودة</option><option value="out" ${item.stock.status==='out'?'selected':''}>نفدت الكمية</option></select></label>
      <label>الكمية المتاحة<input name="stockQty" type="number" min="0" step="1" value="${Number(item.stock.qty)||0}"></label>
      <label class="inline"><input name="published" type="checkbox" ${item.published!==false?'checked':''}> نشر المنتج للزوار</label>
      <label class="inline"><input name="offerEnabled" id="offerEnabled" type="checkbox" ${offer?'checked':''}> إدخال المنتج في العروض</label>
      <div class="wide" id="offerFields" ${offer?'':'hidden'}><div class="admin-form">
        <label>اسم العرض<input name="offerName" value="${esc(offer?.name||'عرض خاص')}"></label>
        <label>نوع الخصم<select name="offerType"><option value="percent" ${offer?.type==='percent'?'selected':''}>نسبة مئوية (%)</option><option value="amount" ${offer?.type==='amount'?'selected':''}>مبلغ ثابت</option><option value="new-price" ${!offer||offer.type==='new-price'?'selected':''}>سعر جديد</option></select></label>
        <label>قيمة الخصم أو السعر<input name="offerValue" type="number" min="0" value="${Number(offer?.value)||''}"></label>
        <label>سبب العرض<input name="offerReason" value="${esc(offer?.reason||'')}"></label>
        <label class="wide">ينتهي في<input name="offerEnds" type="datetime-local" value="${esc(endLocal)}"></label>
        <p class="wide" id="offerPreview" aria-live="polite">معاينة السعر بعد الخصم: ${fmt(item.price)}</p>
      </div></div>
      <div class="image-drop" id="imageDrop"><label>اسحب الصور إلى هنا أو اختر عدة صور<input id="imageFiles" type="file" accept="image/*" multiple></label><small>تُضغط الصور إلى WebP قدر الإمكان، مع حفظها محليًا في المتصفح.</small></div>
      <div class="image-thumbs" id="imageThumbs"></div>
      <div class="admin-preview"><strong>معاينة المنتج</strong><div id="productPreview">${previewCard(item)}</div></div>
      <div class="wide admin-actions"><button class="btn btn-primary" type="submit">${editingId?'حفظ التعديلات':'نشر المنتج'}</button><button class="admin-chip" type="button" data-admin-action="cancel-form">إلغاء</button></div>
      <p class="wide login-error" id="productFormError" role="alert"></p></form>`;
    $('#productForm').dataset.featured = String(Number(item.featured)||0);
    renderImageThumbs();
  }

  function previewCard(product) {
    return `<article class="pcard"><span class="art">${product.images?.[product.featured||0] ? `<img class="pimg" src="${esc(product.images[product.featured||0])}" alt="">` : '<span class="wm">ج</span>'}</span><div class="pc-body"><span class="pc-cat">${esc(categories.find(category => category.id === product.cat)?.name || '')}</span><h3>${esc(product.name || 'اسم المنتج')}</h3><p>${esc(product.desc || 'وصف المنتج')}</p><div class="price"><b>${fmt(product.price)}</b></div></div></article>`;
  }

  function renderImageThumbs() {
    const target = $('#imageThumbs');
    if (!target) return;
    target.innerHTML = formImages.map((image, index) => `<div class="image-thumb"><img src="${esc(image)}" alt="صورة ${index+1}"><button type="button" class="${index === Number($('#productForm')?.dataset.featured||0) ? 'featured' : ''}" data-image-action="feature" data-index="${index}">${index === Number($('#productForm')?.dataset.featured||0) ? 'الصورة الرئيسية' : 'اجعلها رئيسية'}</button><button type="button" data-image-action="up" data-index="${index}" ${index===0?'disabled':''}>↑ ترتيب</button><button type="button" data-image-action="down" data-index="${index}" ${index===formImages.length-1?'disabled':''}>↓ ترتيب</button><button type="button" data-image-action="delete" data-index="${index}">حذف الصورة</button></div>`).join('');
  }

  function updatePreview() {
    const form = $('#productForm');
    if (!form) return;
    const data = new FormData(form);
    const card = $('#productPreview');
    if (card) card.innerHTML = previewCard({
      cat: data.get('cat'), name: data.get('name'), desc: data.get('desc'),
      price: Number(data.get('price')), images: formImages,
      featured: Number(form.dataset.featured||0)
    });
    const fields = $('#offerFields');
    if (fields) fields.hidden = !data.get('offerEnabled');
    const preview = $('#offerPreview');
    if (preview) {
      const base = Number(data.get('price')) || 0;
      const val = Number(data.get('offerValue')) || 0;
      preview.textContent = `معاينة السعر بعد الخصم: ${fmt(calculateOffer(base,{type:data.get('offerType'),value:val}))}`;
    }
  }

  async function imageToWebp(file) {
    if (!file.type.startsWith('image/')) throw new Error(`الملف ${file.name} ليس صورة.`);
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('تعذّر تجهيز مساحة ضغط الصور.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .82));
    if (!blob) throw new Error(`تعذّر ضغط الصورة ${file.name}.`);
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`تعذّرت قراءة الصورة ${file.name}.`));
      reader.readAsDataURL(blob);
    });
  }

  function findOrCreateOffer(product, data) {
    const offerName = String(data.get('offerName') || '').trim();
    const endsAt = new Date(String(data.get('offerEnds') || '')).toISOString();
    const value = Number(data.get('offerValue'));
    if (!offerName || !Number.isFinite(value) || value < 0 || Date.parse(endsAt) <= Date.now()) {
      throw new Error('أدخل اسم العرض وقيمة صحيحة وموعد انتهاء مستقبليًا.');
    }
    let offer = offers.find(item => item.id === product.offerId && offerStatus(item) !== 'منتهي');
    if (offer && offer.productIds.length > 1) {
      offer.productIds = offer.productIds.filter(id => id !== product.id);
      offer = null;
    }
    if (!offer) {
      offer = { id: `offer-${crypto.randomUUID()}`, productIds: [], startsAt: nowIso() };
      offers.push(offer);
    }
    Object.assign(offer, {
      name: offerName,
      type: data.get('offerType'),
      reason: String(data.get('offerReason') || '').trim(),
      value,
      endsAt,
      productIds: [...new Set([...(offer.productIds || []), product.id])]
    });
    product.offerId = offer.id;
    product.offerEndsAt = offer.endsAt;
    product.price = calculateOffer(product.basePrice, offer);
    product.old = product.basePrice;
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const error = $('#productFormError');
    error.textContent = '';
    const name = String(data.get('name') || '').trim();
    const price = Number(data.get('price'));
    if (name.length < 2 || !categories.some(item => item.id === data.get('cat')) || !Number.isFinite(price) || price <= 0) {
      error.textContent = 'تحقق من الاسم والفئة والسعر (يجب أن يكون أكبر من صفر).';
      return;
    }
    const previous = model.products.find(item => item.id === editingId);
    const product = previous || { id: `p-${crypto.randomUUID()}`, images: [], specs: [], stock: { status:'available',qty:0 } };
    const wasOfferPrice = Boolean(product.offerId);
    Object.assign(product, {
      cat: String(data.get('cat')),
      sub: String(data.get('sub') || '').trim(),
      name,
      desc: String(data.get('desc') || '').trim(),
      specs: String(data.get('specs') || '').split('\n').map(value => value.trim()).filter(Boolean),
      stock: { status: String(data.get('stockStatus')), qty: Math.max(0,Math.floor(Number(data.get('stockQty'))||0)) },
      published: Boolean(data.get('published')),
      images: formImages,
      featured: Math.max(0,Number(form.dataset.featured)||0),
      basePrice: wasOfferPrice ? Number(product.basePrice) : price,
      price
    });
    if (!data.get('offerEnabled') && product.offerId) {
      offers = offers.filter(offer => {
        offer.productIds = offer.productIds.filter(id => id !== product.id);
        return offer.productIds.length > 0;
      });
      product.offerId = '';
      product.offerEndsAt = '';
      product.old = null;
      product.price = price;
      product.basePrice = price;
    }
    if (data.get('offerEnabled')) {
      try { findOrCreateOffer(product,data); }
      catch (caught) { error.textContent = caught.message; return; }
    } else if (!product.offerId) {
      product.old = null;
      product.basePrice = price;
    }
    if (previous) Object.assign(previous, product);
    else model.products.unshift(product);
    try {
      await saveState();
      model.refresh();
      toast(previous ? 'تم حفظ تعديلات المنتج.' : 'تم نشر المنتج.');
      tab = 'products';
      renderAdminTab();
    } catch (caught) { showError(caught); }
  }

  function renderOffersAdmin(content) {
    const filtered = offers.filter(offer => !offerQuery || `${offer.name} ${offer.reason}`.toLowerCase().includes(offerQuery.toLowerCase()));
    const end = new Date(Date.now()+7*86400000).toISOString().slice(0,16);
    content.innerHTML = `<form class="admin-form" id="bulkOfferForm">
      <h2 class="wide">إنشاء عرض وتطبيقه على منتجات متعددة</h2>
      <label>اسم العرض<input name="name" required></label>
      <label>نوع الخصم<select name="type"><option value="percent">نسبة مئوية (%)</option><option value="amount">مبلغ ثابت</option><option value="new-price">سعر جديد</option></select></label>
      <label>قيمة العرض<input name="value" type="number" min="0" required></label>
      <label>سبب العرض<input name="reason"></label>
      <label>يبدأ في<input name="startsAt" type="datetime-local" value="${esc(new Date().toISOString().slice(0,16))}" required></label>
      <label>ينتهي في<input name="endsAt" type="datetime-local" value="${esc(end)}" required></label>
      <div class="wide"><p>المنتجات المشمولة</p><div class="settings-grid">${model.products.map(product => `<label class="inline"><input type="checkbox" name="productIds" value="${esc(product.id)}">${esc(product.name)}</label>`).join('')}</div></div>
      <button class="btn btn-primary wide" type="submit">تطبيق العرض المحدد</button><p class="wide login-error" id="bulkOfferError" role="alert"></p>
    </form>
    <div class="admin-toolbar"><input id="adminOfferSearch" type="search" value="${esc(offerQuery)}" placeholder="بحث في العروض" aria-label="بحث العروض"></div>
      <div class="admin-list">${filtered.length ? filtered.map((offer,index) => `<article class="admin-row" style="animation-delay:${Math.min(index,12)*35}ms"><div><h3>${esc(offer.name)}</h3><p><span class="offer-badge">${offerStatus(offer)}</span> · ${esc(offer.reason||'دون سبب')} · ينتهي ${new Date(offer.endsAt).toLocaleString('ar-IQ')} · ${offer.productIds.length} منتج</p></div><div class="admin-actions"><button type="button" data-admin-action="extend-offer" data-id="${esc(offer.id)}">تمديد 7 أيام</button><button type="button" data-admin-action="end-offer" data-id="${esc(offer.id)}">إنهاء الآن</button><button type="button" data-admin-action="delete-offer" data-id="${esc(offer.id)}">حذف العرض</button></div></article>`).join('') : '<div class="admin-empty">لا توجد عروض مسجلة.</div>'}</div>`;
  }

  async function saveBulkOffer(event) {
    event.preventDefault();
    const data = new FormData(event.target);
    const ids = data.getAll('productIds').map(String);
    const startText = String(data.get('startsAt')||'');
    const endText = String(data.get('endsAt')||'');
    const startsAt = Date.parse(startText);
    const endsAt = Date.parse(endText);
    const value = Number(data.get('value'));
    if (!ids.length || !String(data.get('name')||'').trim() || !Number.isFinite(value) || value < 0 || !Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt) {
      $('#bulkOfferError').textContent='أدخل اسمًا وقيمة ومدة صحيحة، وحدد منتجًا واحدًا على الأقل.';
      return;
    }
    const offer = {
      id:`offer-${crypto.randomUUID()}`,
      name:String(data.get('name')).trim(),
      type:String(data.get('type')),
      value,
      reason:String(data.get('reason')||'').trim(),
      startsAt:new Date(startsAt).toISOString(),
      endsAt:new Date(endsAt).toISOString(),
      productIds:ids
    };
    offers.push(offer);
    ids.forEach(id => {
      const product=model.products.find(item=>item.id===id);
      if (!product) return;
      if (product.offerId) offers.forEach(old => { old.productIds=old.productIds.filter(productId=>productId!==id); });
      if (product.offerId) {
        product.price=Number(product.basePrice)||Number(product.price);
        product.old=null;
      }
      product.basePrice=Number(product.basePrice)||Number(product.price);
      product.offerId=offer.id;
      product.offerEndsAt=offer.endsAt;
      if (offerStatus(offer)==='فعّال') {
        product.old=product.basePrice;
        product.price=calculateOffer(product.basePrice,offer);
      }
    });
    offers=offers.filter(item=>item.productIds.length);
    syncOffers();
    await saveState();
    renderAdminTab();
    toast(offerStatus(offer)==='مجدول'?'تمت جدولة العرض.':'تم تطبيق العرض على المنتجات المحددة.');
  }

  function renderSettings(content) {
    content.innerHTML = `<form class="admin-form" id="settingsForm">
      <h2 class="wide">الفئات وبيانات المتجر</h2>
      <p class="wide">سمِّ فئات المتجر وأضف الأنواع الفرعية التي تظهر للزبائن عند تصفح المنتجات.</p>
      <div class="category-admin-list wide">${categories.map((category,index) => `<section class="category-admin-card">
        <div class="category-admin-heading"><strong>الفئة ${index+1}</strong><span>${category.items.length} أنواع فرعية</span></div>
        <label>اسم الفئة<input data-category-name="${esc(category.id)}" value="${esc(category.name)}" maxlength="60" required></label>
        <label>الاسم بالإنجليزية<input data-category-en="${esc(category.id)}" value="${esc(category.en||'')}" maxlength="40" placeholder="مثال: KITCHEN"></label>
        <label class="wide">الأنواع الفرعية — كل نوع في سطر<textarea data-category-items="${esc(category.id)}" maxlength="1200" rows="3">${esc(category.items.join('\n'))}</textarea></label>
        <div class="category-admin-actions"><button type="button" data-admin-action="cat-up" data-index="${index}" aria-label="رفع الفئة" ${index===0?'disabled':''}>↑ ترتيب</button><button type="button" data-admin-action="cat-down" data-index="${index}" aria-label="خفض الفئة" ${index===categories.length-1?'disabled':''}>↓ ترتيب</button><button type="button" class="category-delete" data-admin-action="delete-category" data-id="${esc(category.id)}">حذف الفئة</button></div>
      </section>`).join('')}</div>
      <section class="category-create wide">
        <h3>إضافة فئة جديدة</h3>
        <p>اكتب اسم الفئة، وأضف الأنواع الفرعية إن وجدت. تقدر تعدّلها لاحقًا.</p>
        <div class="category-create-fields">
          <label>اسم الفئة<input id="newCategoryName" maxlength="60" placeholder="مثال: معدات التنظيف"></label>
          <label>الاسم بالإنجليزية <small>(اختياري)</small><input id="newCategoryEn" maxlength="40" placeholder="مثال: CLEANING"></label>
          <label class="wide">الأنواع الفرعية <small>(اختياري — كل نوع في سطر)</small><textarea id="newCategoryItems" maxlength="1200" rows="3" placeholder="مثال: مكانس تجارية&#10;معدات تعقيم"></textarea></label>
        </div>
        <button type="button" class="btn btn-ghost" data-admin-action="create-category">إضافة الفئة</button>
      </section>
      <label>رقم واتساب<input name="whatsapp" dir="ltr" value="${esc(settings.whatsapp)}"></label>
      <label>حساب تلغرام<input name="telegram" value="${esc(settings.telegram)}"></label>
      <label>حساب إنستغرام<input name="instagram" value="${esc(settings.instagram)}"></label>
      <label>العنوان<input name="address" value="${esc(settings.address)}"></label>
      <label>ساعات العمل<input name="hours" value="${esc(settings.hours)}"></label>
      <div class="wide"><h3>قالب الموقع</h3><div class="theme-options">
        <button type="button" data-theme-choice="royal">تاج ملكي</button><button type="button" data-theme-choice="ivory">عاج وذهب</button><button type="button" data-theme-choice="night">ليل حديث</button>
      </div></div>
      <div class="wide admin-actions"><button class="btn btn-primary" type="submit">حفظ الإعدادات</button><button class="admin-chip" type="button" data-admin-action="export">تصدير JSON</button><label class="admin-chip">استيراد JSON<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
      <p class="wide">تغيير كلمة المرور المحلية (تجزئة فقط؛ لا تعتبرها مصادقة آمنة):</p>
      <label>كلمة المرور الحالية<input name="oldPassword" type="password" autocomplete="current-password"></label>
      <label>كلمة المرور الجديدة<input name="newPassword" type="password" autocomplete="new-password"></label>
      <button class="btn btn-ghost wide" type="button" data-admin-action="change-password">تغيير كلمة المرور</button>
    </form>`;
    content.querySelectorAll('[data-theme-choice]').forEach(button => {
      if (button.dataset.themeChoice === settings.theme) button.setAttribute('aria-pressed','true');
    });
  }

  async function sha256(value) {
    if (!crypto.subtle) throw new Error('يتطلب التحقق Web Crypto. افتح الموقع عبر HTTPS أو localhost.');
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256',bytes);
    return Array.from(new Uint8Array(digest),byte => byte.toString(16).padStart(2,'0')).join('');
  }

  async function verifyLogin(user, password) {
    const expected = localStorage.getItem('taj_admin_hash') || defaultLoginHash;
    const actual = await sha256(`${user}:${password}`);
    return actual === expected;
  }

  function readSelected() {
    return [...document.querySelectorAll('[data-product-select]:checked')].map(input => input.dataset.productSelect);
  }

  async function deleteProducts(ids) {
    const targets = model.products.filter(item => ids.includes(item.id));
    if (!targets.length) return;
    if (!confirm(`حذف ${targets.length} منتج؟ يمكنك التراجع خلال 6 ثوانٍ.`)) return;
    lastDeleted = targets.map(item => ({...item,images:[...(item.images||[])]}));
    offers.forEach(offer => { offer.productIds = offer.productIds.filter(id => !ids.includes(id)); });
    offers = offers.filter(offer => offer.productIds.length > 0);
    model.products.splice(0,model.products.length,...model.products.filter(item => !ids.includes(item.id)));
    clearTimeout(deleteTimer);
    await saveState();
    model.refresh();
    toast('حُذفت المنتجات. التراجع متاح 6 ثوانٍ.', 'undo-delete');
    deleteTimer = setTimeout(() => { lastDeleted = null; },6000);
    renderAdminTab();
  }

  async function restoreDelete() {
    if (!lastDeleted) return;
    model.products.unshift(...lastDeleted);
    lastDeleted = null;
    clearTimeout(deleteTimer);
    await saveState();
    model.refresh();
    renderAdminTab();
    toast('تم التراجع عن الحذف.');
  }

  async function exportData() {
    const file = new Blob([JSON.stringify({products:model.products,categories,offers,settings},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'taj-aden-backup.json';
    link.click();
    URL.revokeObjectURL(url);
    toast('تم تصدير نسخة JSON.');
  }

  async function importData(file) {
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); }
    catch { throw new Error('ملف JSON غير صالح.'); }
    if (!Array.isArray(data.products) || !Array.isArray(data.categories) || !Array.isArray(data.offers) || !data.categories.length) {
      throw new Error('يجب أن يحتوي الملف على قوائم منتجات وفئات وعروض صالحة.');
    }
    const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
    const uniqueIds = items => {
      const ids = items.map(item => item?.id);
      return ids.every(validId) && new Set(ids).size === ids.length;
    };
    const validCategories = uniqueIds(data.categories) && data.categories.every(item =>
      typeof item.name === 'string' && Array.isArray(item.items) && item.items.every(value => typeof value === 'string')
    );
    const validProducts = uniqueIds(data.products) && data.products.every(item =>
      item && typeof item.name === 'string' && Number.isFinite(Number(item.price)) && Number(item.price) >= 0 &&
      data.categories.some(category => category.id === item.cat)
    );
    const validProductIds = new Set(data.products.map(item => item?.id));
    const validOffers = uniqueIds(data.offers) && data.offers.every(item =>
      typeof item.name === 'string' && ['percent','amount','new-price'].includes(item.type) &&
      Array.isArray(item.productIds) && item.productIds.every(id => validId(id) && validProductIds.has(id)) &&
      Number.isFinite(Date.parse(item.startsAt)) && Number.isFinite(Date.parse(item.endsAt))
    );
    if (!validCategories || !validProducts || !validOffers || !confirm('سيستبدل الاستيراد المنتجات والفئات والعروض الحالية. هل تتابع؟')) {
      if (!validCategories || !validProducts || !validOffers) throw new Error('يتضمن الملف بيانات فئات أو منتجات أو عروض غير صالحة.');
      return;
    }
    model.products.splice(0,model.products.length,...data.products.map(prepareProduct));
    categories = data.categories;
    model.categories.splice(0,model.categories.length,...categories);
    offers = data.offers;
    settings = {...settings,...(data.settings||{})};
    syncOffers();
    await saveState();
    model.refresh();
    toast('تم استيراد نسخة JSON.');
    renderAdminTab();
  }

  function updateContact() {
    model.config.contact.whatsapp = settings.whatsapp;
    model.config.contact.telegram = settings.telegram.replace(/^@/,'');
    model.config.contact.instagram = settings.instagram.replace(/^@/,'');
    model.refresh();
  }

  async function changePassword() {
    const form = $('#settingsForm');
    const oldPassword = String(new FormData(form).get('oldPassword') || '');
    const newPassword = String(new FormData(form).get('newPassword') || '');
    if (newPassword.length < 8) throw new Error('كلمة المرور الجديدة يجب ألا تقل عن 8 محارف.');
    const username = $('#loginUser').value.trim();
    const valid = await verifyLogin(username,oldPassword);
    if (!valid) throw new Error('كلمة المرور الحالية غير صحيحة.');
    localStorage.setItem('taj_admin_hash',await sha256(`${username}:${newPassword}`));
    toast('تم تغيير كلمة المرور على هذا المتصفح.');
    form.elements.oldPassword.value = '';
    form.elements.newPassword.value = '';
  }

  function parseCategoryItems(value) {
    const items = String(value || '').split(/[\n,]/).map(item => item.trim()).filter(Boolean);
    if (items.length > 30 || items.some(item => item.length > 70)) {
      throw new Error('أضف 30 نوعًا فرعيًا كحد أقصى، وبحد أقصى 70 حرفًا لكل نوع.');
    }
    return [...new Map(items.map(item => [item.toLocaleLowerCase('ar-IQ'), item])).values()];
  }

  function syncCategories() {
    model.categories.splice(0,model.categories.length,...categories);
    model.refresh();
  }

  async function createCategory() {
    const nameInput = $('#newCategoryName');
    const name = nameInput.value.trim();
    const en = $('#newCategoryEn').value.trim();
    if (name.length < 2) {
      nameInput.focus();
      throw new Error('اكتب اسمًا للفئة من حرفين على الأقل.');
    }
    if (categories.some(category => category.name.trim().toLocaleLowerCase('ar-IQ') === name.toLocaleLowerCase('ar-IQ'))) {
      nameInput.focus();
      throw new Error('هذا الاسم موجود مسبقًا. اختر اسمًا آخر.');
    }
    if (en.length > 40) throw new Error('الاسم الإنجليزي يجب ألا يتجاوز 40 حرفًا.');
    const category = {
      id: `category-${crypto.randomUUID()}`,
      name,
      en,
      items: parseCategoryItems($('#newCategoryItems').value)
    };
    categories.push(category);
    syncCategories();
    await saveState();
    renderAdminTab();
    toast('تمت إضافة الفئة. تقدر الآن تختارها عند نشر منتج.');
  }

  async function deleteCategory(id) {
    const category = categories.find(item => item.id === id);
    if (!category) throw new Error('الفئة المطلوبة غير موجودة.');
    if (categories.length <= 1) throw new Error('لا يمكن حذف آخر فئة في المتجر.');
    const productCount = model.products.filter(product => product.cat === id).length;
    if (productCount) {
      throw new Error(`لا يمكن حذف هذه الفئة؛ فيها ${productCount} منتج. انقل المنتجات إلى فئة أخرى أو احذفها أولًا.`);
    }
    if (!confirm(`حذف فئة «${category.name}»؟`)) return;
    categories = categories.filter(item => item.id !== id);
    syncCategories();
    await saveState();
    renderAdminTab();
    toast('تم حذف الفئة.');
  }

  window.addEventListener('hashchange',routeChanged);
  document.addEventListener('click', async event => {
    const target = event.target;
    const action = target.closest('[data-admin-action]');
    const actionName = action?.dataset.adminAction;
    if (target.closest('#menuBtn') && !document.body.classList.contains('route-admin')) {
      setTimeout(() => $('#loginUser')?.focus(),80);
    }
    if (actionName === 'undo-delete') {
      try { await restoreDelete(); } catch (error) { showError(error); }
      return;
    }
    if (target.closest('[data-theme-choice]')) {
      settings.theme = target.closest('[data-theme-choice]').dataset.themeChoice;
      applyTheme(settings.theme, event);
      saveState().catch(showError);
      if (tab === 'settings') renderAdminTab();
      return;
    }
    if (!actionName) {
      const imageAction = target.closest('[data-image-action]');
      if (imageAction) {
        const index = Number(imageAction.dataset.index);
        const form=$('#productForm');
        let featured=Number(form?.dataset.featured||0);
        if (imageAction.dataset.imageAction === 'delete') {
          formImages.splice(index,1);
          if(index<featured)featured--;
          else if(index===featured)featured=Math.min(featured,formImages.length-1);
        }
        if (imageAction.dataset.imageAction === 'up' && index > 0) {
          [formImages[index-1],formImages[index]] = [formImages[index],formImages[index-1]];
          if(featured===index)featured--;
          else if(featured===index-1)featured++;
        }
        if (imageAction.dataset.imageAction === 'down' && index < formImages.length-1) {
          [formImages[index+1],formImages[index]] = [formImages[index],formImages[index+1]];
          if(featured===index)featured++;
          else if(featured===index+1)featured--;
        }
        if (imageAction.dataset.imageAction === 'feature') {
          featured=index;
        }
        if(form)form.dataset.featured=String(Math.max(0,featured));
        renderImageThumbs();
        updatePreview();
      }
      const adminTab = target.closest('[data-admin-tab]');
      if (adminTab) { tab = adminTab.dataset.adminTab; renderAdminTab(); }
      const adminAction = target.closest('[data-admin-action]');
      if (adminAction) event.stopPropagation();
      if (target.closest('#offerEnabled')) updatePreview();
      return;
    }
    event.preventDefault();
    if (document.body.classList.contains('route-admin')) refreshIdle();
    try {
      if (actionName === 'logout') logout(true);
      else if (actionName === 'new-product') renderProductForm(null);
      else if (actionName === 'edit-product') renderProductForm(model.products.find(item => item.id === action.dataset.id));
      else if (actionName === 'cancel-form') { tab = 'products'; renderAdminTab(); }
      else if (actionName === 'copy-product') {
        const original = model.products.find(item => item.id === action.dataset.id);
        if (original) {
          const copy = {...original,id:`p-${crypto.randomUUID()}`,name:`${original.name} — نسخة`,images:[...(original.images||[])],specs:[...(original.specs||[])],offerId:'',old:null,basePrice:original.price,price:original.price};
          model.products.unshift(copy);await saveState();model.refresh();renderAdminTab();toast('تم نسخ المنتج.');
        }
      } else if (actionName === 'stock-out') {
        const product = model.products.find(item => item.id === action.dataset.id);
        if (product) {
          product.stock = {...product.stock,status:'out'};
          model.removeFromCart(product.id);
          await saveState();model.refresh();renderAdminTab();toast('تم تحديث المخزون.');
        }
      } else if (actionName === 'delete-product') await deleteProducts([action.dataset.id]);
      else if (actionName === 'bulk-delete') await deleteProducts(readSelected());
      else if (actionName === 'bulk-hide') {
        readSelected().forEach(id => {const product=model.products.find(item=>item.id===id);if(product)product.published=false;});
        await saveState();model.refresh();renderAdminTab();toast('تم إخفاء المنتجات المحددة.');
      } else if (actionName === 'extend-offer') {
        const offer = offers.find(item => item.id === action.dataset.id);
        if (offer) { offer.endsAt = new Date(Math.max(Date.now(),Date.parse(offer.endsAt))+7*86400000).toISOString();syncOffers();await saveState();renderAdminTab();toast('تم تمديد العرض 7 أيام.'); }
      } else if (actionName === 'end-offer') {
        const offer = offers.find(item => item.id === action.dataset.id);
        if (offer && confirm('إنهاء العرض الآن وإعادة الأسعار الأصلية؟')) { offer.endsAt=nowIso();syncOffers();await saveState();renderAdminTab();toast('انتهى العرض وعادت الأسعار الأصلية.'); }
      } else if (actionName === 'delete-offer') {
        const offer=offers.find(item=>item.id===action.dataset.id);
        if(offer&&confirm('حذف هذا العرض وإعادة الأسعار الأصلية؟')){offer.productIds.forEach(id=>{const p=model.products.find(item=>item.id===id);if(p){p.price=p.basePrice;p.old=null;p.offerId='';p.offerEndsAt='';}});offers=offers.filter(item=>item.id!==offer.id);await saveState();model.refresh();renderAdminTab();toast('تم حذف العرض.');}
      } else if (actionName === 'create-category') await createCategory();
      else if (actionName === 'delete-category') await deleteCategory(action.dataset.id);
      else if (actionName === 'cat-up' || actionName === 'cat-down') {
        const index=Number(action.dataset.index),step=actionName==='cat-up'?-1:1,next=index+step;
        if(next>=0&&next<categories.length){[categories[index],categories[next]]=[categories[next],categories[index]];syncCategories();await saveState();renderAdminTab();}
      } else if (actionName === 'export') await exportData();
      else if (actionName === 'change-password') await changePassword();
    } catch (error) { showError(error); }
  });

  document.addEventListener('submit', async event => {
    if (event.target.id === 'loginForm') {
      event.preventDefault();
      const user = $('#loginUser').value.trim();
      const password = $('#loginPass').value;
      const error = $('#loginError');
      const panel = $('#menuPanel');
      const lockUntil = Number(localStorage.getItem(LOCK_KEY)||0);
      if (Date.now() < lockUntil) {
        error.textContent = `محاولات كثيرة. أعد المحاولة بعد ${Math.ceil((lockUntil-Date.now())/1000)} ثانية.`;
        return;
      }
      try {
        if (await verifyLogin(user,password)) {
          localStorage.removeItem(LOCK_KEY);
          localStorage.setItem(SESSION_KEY,crypto.randomUUID());
          localStorage.setItem(SESSION_AT,String(Date.now()));
          $('#loginPass').value='';
          error.textContent = 'صح ✓';
          setTimeout(() => { panel.classList.remove('open');$('#menuBtn').setAttribute('aria-expanded','false');location.hash='#/admin'; },400);
        } else {
          const count = Number(sessionStorage.getItem('taj_failed_logins')||0)+1;
          sessionStorage.setItem('taj_failed_logins',String(count));
          error.textContent = 'البيانات غير صحيحة';
          panel.classList.remove('shake');void panel.offsetWidth;panel.classList.add('shake');
          if (count >= 5) {
            localStorage.setItem(LOCK_KEY,String(Date.now()+30000));
            sessionStorage.removeItem('taj_failed_logins');
            error.textContent = 'محاولات كثيرة. تم قفل الدخول 30 ثانية.';
          }
        }
      } catch (caught) { error.textContent = caught.message; }
    } else if (event.target.id === 'productForm') {
      await saveProduct(event);
    } else if (event.target.id === 'settingsForm') {
      event.preventDefault();
      const data = new FormData(event.target);
      let categoryEdits;
      try {
        categoryEdits = categories.map(category => {
          const name = [...event.target.querySelectorAll('[data-category-name]')].find(input => input.dataset.categoryName === category.id)?.value.trim();
          const en = [...event.target.querySelectorAll('[data-category-en]')].find(input => input.dataset.categoryEn === category.id)?.value.trim();
          const items = [...event.target.querySelectorAll('[data-category-items]')].find(input => input.dataset.categoryItems === category.id)?.value;
          return {...category,name:name||'',en:en||'',items:parseCategoryItems(items)};
        });
      } catch (error) {
        showError(error);
        return;
      }
      if (categoryEdits.some(category => category.name.length < 2 || category.name.length > 60 || category.en.length > 40)) {
        showError(new Error('تحقق من أسماء الفئات: الاسم العربي من حرفين إلى 60 حرفًا، والإنجليزي 40 حرفًا كحد أقصى.'));
        return;
      }
      const categoryNames = categoryEdits.map(category => category.name.toLocaleLowerCase('ar-IQ'));
      if (new Set(categoryNames).size !== categoryNames.length) {
        showError(new Error('توجد فئات تحمل الاسم نفسه. اجعل أسماء الفئات مختلفة.'));
        return;
      }
      categoryEdits.forEach((edited,index) => Object.assign(categories[index],edited));
      syncCategories();
      settings = {...settings,whatsapp:String(data.get('whatsapp')||'').trim(),telegram:String(data.get('telegram')||'').trim(),instagram:String(data.get('instagram')||'').trim(),address:String(data.get('address')||'').trim(),hours:String(data.get('hours')||'').trim()};
      updateContact();
      await saveState();
      renderAdminTab();
      toast('تم حفظ الإعدادات والفئات.');
    } else if (event.target.id === 'bulkOfferForm') {
      try { await saveBulkOffer(event); } catch (error) { showError(error); }
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'adminProductSearch') { productQuery=event.target.value;renderAdminTab();$('#adminProductSearch')?.focus(); }
    else if (event.target.id === 'adminOfferSearch') { offerQuery=event.target.value;renderAdminTab();$('#adminOfferSearch')?.focus(); }
    else if (event.target.matches('[data-category-name]')) return;
    else if (event.target.closest('#productForm')) updatePreview();
  });

  document.addEventListener('change', async event => {
    if (event.target.id === 'adminProductFilter') { productFilter=event.target.value;renderAdminTab(); }
    else if (event.target.id === 'imageFiles') {
      const files = [...event.target.files];
      if (!files.length) return;
      const input = event.target;
      input.disabled = true;
      try {
        for (const file of files) formImages.push(await imageToWebp(file));
        renderImageThumbs();updatePreview();
      } catch (error) { showError(error); }
      finally { input.disabled=false;input.value=''; }
    } else if (event.target.id === 'importFile') {
      try { await importData(event.target.files[0]); } catch (error) { showError(error); }
      event.target.value='';
    }
  });

  document.addEventListener('dragover', event => {
    if (event.target.closest('#imageDrop')) event.preventDefault();
  });
  document.addEventListener('drop', async event => {
    if (!event.target.closest('#imageDrop')) return;
    event.preventDefault();
    try {
      for (const file of [...event.dataTransfer.files]) formImages.push(await imageToWebp(file));
      renderImageThumbs();updatePreview();
    } catch (error) { showError(error); }
  });

  document.addEventListener('pointerdown', refreshIdle, {passive:true});
  document.addEventListener('keydown', refreshIdle);

  $('#passToggle')?.addEventListener('click', event => {
    const input = $('#loginPass');
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    event.currentTarget.setAttribute('aria-pressed',String(visible));
    event.currentTarget.setAttribute('aria-label',visible?'إخفاء كلمة المرور':'إظهار كلمة المرور');
  });

  openDatabase().then(async connection => {
    db = connection;
    const saved = await readState();
    if (saved) {
      model.products.splice(0,model.products.length,...saved.products.map(prepareProduct));
      categories = saved.categories;
      model.categories.splice(0,model.categories.length,...categories);
      offers = saved.offers || [];
      settings = {...settings,...(saved.settings||{})};
    } else {
      loadSeedOffers();
      await saveState();
    }
    applyTheme(settings.theme);
    syncOffers();
    model.refresh();
    updateContact();
    routeChanged();
    scheduleOfferRefresh();
  }).catch(error => {
    showError(error);
    routeChanged();
  });

  window.addEventListener('taj-order-sent',() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const colors=['#D3A18C','#E8C2B1','#FFE08A','#800020'];
    for(let index=0;index<26;index++){
      const piece=document.createElement('i');
      piece.className='confetti-piece';
      piece.style.setProperty('--x',`${40+Math.random()*20}vw`);
      piece.style.setProperty('--y',`${36+Math.random()*20}vh`);
      piece.style.setProperty('--dx',`${Math.random()*240-120}px`);
      piece.style.setProperty('--dy',`${150+Math.random()*220}px`);
      piece.style.setProperty('--rot',`${Math.random()*720-360}deg`);
      piece.style.setProperty('--c',colors[index%colors.length]);
      document.body.appendChild(piece);
      setTimeout(()=>piece.remove(),1400);
    }
  });
})();
