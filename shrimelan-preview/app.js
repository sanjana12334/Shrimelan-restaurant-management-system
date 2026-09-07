/* ==========================================================
   ShriMelan — Front-end demo application
   This is a self-contained UI/UX demo. In production, menu data,
   pricing, tax, order numbers and status all come from the
   server (see ARCHITECTURE.md) — never trust the browser for these.
   ========================================================== */
(function () {
  "use strict";

  const DATA = JSON.parse(document.getElementById("menu-data").textContent);
  const RESTAURANT = DATA.restaurant;
  const CATEGORIES = DATA.categories;
  const ITEMS = DATA.items;
  const TAX_RATE = 0.05;

  const CATEGORY_EMOJI = {
    "South Indian": "🥞",
    "Snacks": "🍢",
    "Burgers and Sandwiches": "🍔",
    "Chinese": "🥡",
    "Fried Rice and Noodles": "🍜",
    "Drinks (Beverages)": "🥤",
    "Main Course": "🍛",
    "Rice and Biryani": "🍚",
    "Breads": "🫓",
    "Tandoor Se": "🔥",
    "Combos": "🍱",
    "Accompaniments": "🥗",
    "Thali": "🍽️",
  };

  const ADDON_LIBRARY = {
    "Main Course": [{ name: "Extra Gravy", price: 20 }, { name: "Extra Paneer", price: 40 }],
    "South Indian": [{ name: "Extra Chutney", price: 10 }, { name: "Extra Sambar", price: 15 }],
    "Rice and Biryani": [{ name: "Raita", price: 25 }, { name: "Papad", price: 15 }],
    "Fried Rice and Noodles": [{ name: "Extra Schezwan Sauce", price: 15 }],
    "Breads": [{ name: "Extra Butter", price: 10 }],
    "Tandoor Se": [{ name: "Extra Butter", price: 10 }],
    "Burgers and Sandwiches": [{ name: "Extra Cheese", price: 20 }],
    default: [{ name: "Extra Spicy", price: 0 }],
  };

  const fmt = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $all = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

  /* ---------------- STATE ---------------- */
  let cart = loadCart();
  let currentModalItem = null;
  let modalQty = 1;
  let modalAddons = {};
  let lastOrder = null;

  function loadCart() {
    try {
      const raw = localStorage.getItem("shrimelan_cart");
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveCart() {
    try { localStorage.setItem("shrimelan_cart", JSON.stringify(cart)); } catch (e) {}
  }

  /* ---------------- NAV / VIEW ROUTER ---------------- */
  let currentViewName = "home";
  function showView(name) {
    currentViewName = name;
    $all(".view").forEach((v) => (v.style.display = v.dataset.view === name ? "" : "none"));
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    updateStickyCart();
  }
  $all("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      const target = el.dataset.nav;
      if (target === "menu" || target === "home" || target === "staff") {
        // allow default anchor jump on home in-page links, but still switch views
      }
      showView(target);
      closeMobileNav();
    });
  });

  function closeMobileNav() { $("#mobile-nav").classList.remove("open"); }
  $("#hamburger").addEventListener("click", () => $("#mobile-nav").classList.toggle("open"));

  /* ---------------- RENDER: RESTAURANT INFO ---------------- */
  function renderRestaurantInfo() {
    $("#visit-address").textContent = RESTAURANT.address;
    $("#visit-hours").textContent = RESTAURANT.hours;
    $("#visit-phone").textContent = RESTAURANT.phones.join("  /  ");
    $("#visit-email").textContent = RESTAURANT.email;
    $("#footer-address").textContent = RESTAURANT.address;
    $("#footer-phone").textContent = RESTAURANT.phones[0];
    $("#footer-email").textContent = RESTAURANT.email;
    $("#topbar-hours").textContent = "Open " + RESTAURANT.hours;
    $("#whatsapp-btn").href = "https://wa.me/" + RESTAURANT.whatsapp.replace("+", "") + "?text=" + encodeURIComponent("Hi ShriMelan! I'd like to know more about your menu.");
    $("#call-btn").href = "tel:" + RESTAURANT.phones[0].replace(/\s/g, "");
  }

  /* ---------------- RENDER: DISH CARD ---------------- */
  function dishCardHTML(item) {
    const inCart = cart.find((c) => c.id === item.id && !c.addons?.length && !c.instructions);
    return `
    <div class="dish-card" data-id="${item.id}">
      <div class="dish-card-img">
        <img src="${item.image}" alt="${escapeHTML(item.name)}" loading="lazy" onerror="this.src='images/gourmet_plate.png'">
        ${item.bestseller ? `<span class="badge badge-bestseller">🔥 Bestseller</span>` : ""}
        <span class="badge badge-veg"><span class="veg-dot"></span></span>
      </div>
      <div class="dish-card-body">
        <div class="dish-card-title-row">
          <h3>${escapeHTML(item.name)}</h3>
        </div>
        <p class="dish-card-desc">${escapeHTML(item.description)}</p>
        <div class="dish-card-meta"><span class="rating">⭐ ${item.rating}</span><span>·</span><span>${escapeHTML(item.category)}</span></div>
        <div class="dish-card-footer">
          <span class="dish-price">${fmt(item.price)}</span>
          <div class="add-slot" data-id="${item.id}">
            ${inCart ? stepperMiniHTML(inCart) : `<button class="btn-add" data-quickadd="${item.id}">Add</button>`}
          </div>
        </div>
      </div>
    </div>`;
  }
  function stepperMiniHTML(cartLine) {
    return `<div class="stepper-mini" data-line="${cartLine.lineId}">
      <button data-step="-1">−</button><span>${cartLine.qty}</span><button data-step="1">+</button>
    </div>`;
  }
  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  /* ---------------- RENDER: HOME ---------------- */
  function renderBestsellers() {
    const row = $("#bestseller-row");
    row.innerHTML = ITEMS.filter((i) => i.bestseller).map(dishCardHTML).join("");
  }
  function renderCategoryGrid() {
    const grid = $("#category-grid");
    grid.innerHTML = CATEGORIES.map((cat) => {
      const count = ITEMS.filter((i) => i.category === cat).length;
      return `<a class="category-tile" href="#menu" data-nav="menu" data-jump-cat="${escapeHTML(cat)}">
        <span class="cat-emoji">${CATEGORY_EMOJI[cat] || "🍴"}</span>
        <span class="cat-name">${escapeHTML(cat)}</span>
        <span class="cat-count">${count} items</span>
      </a>`;
    }).join("");
  }
  function renderGallery() {
    const imgs = [
      "images/Melan-special-paneer.webp","images/Special-thali.avif","images/butter-paneer-masala.avif",
      "images/paneer-tikka-masala.avif","images/Malai-kofta.avif","images/Veg-kolhapuri.webp",
      "images/kadhai-paneer.avif","images/Veg-thali.avif"
    ];
    $("#gallery-grid").innerHTML = imgs.map((src) => `<div><img src="${src}" loading="lazy" alt="ShriMelan dish"></div>`).join("");
  }

  /* ---------------- RENDER: MENU PAGE ---------------- */
  let activeCategory = "All";
  let searchTerm = "";

  function renderCategoryTabs() {
    const tabs = ["All", ...CATEGORIES];
    $("#category-tabs").innerHTML = tabs.map((cat) =>
      `<button class="cat-tab${cat === activeCategory ? " active" : ""}" data-cat="${escapeHTML(cat)}">${escapeHTML(cat)}</button>`
    ).join("");
  }

  function renderMenuGrid() {
    let filtered = ITEMS.filter((i) => {
      const matchesCat = activeCategory === "All" || i.category === activeCategory;
      const matchesSearch = !searchTerm || i.name.toLowerCase().includes(searchTerm) || i.category.toLowerCase().includes(searchTerm);
      return matchesCat && matchesSearch;
    });

    const grid = $("#menu-grid");
    $("#empty-search").style.display = filtered.length ? "none" : "";

    if (activeCategory !== "All" || searchTerm) {
      grid.innerHTML = filtered.map(dishCardHTML).join("");
    } else {
      // grouped by category when browsing "All"
      let html = "";
      CATEGORIES.forEach((cat) => {
        const items = filtered.filter((i) => i.category === cat);
        if (!items.length) return;
        html += `<h3 class="menu-category-heading" id="cat-${slug(cat)}">${CATEGORY_EMOJI[cat] || ""} ${escapeHTML(cat)}</h3>`;
        html += items.map(dishCardHTML).join("");
      });
      grid.innerHTML = html;
    }
  }
  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }

  $("#menu-search").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim().toLowerCase();
    renderMenuGrid();
  });
  $("#category-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".cat-tab");
    if (!btn) return;
    activeCategory = btn.dataset.cat;
    renderCategoryTabs();
    renderMenuGrid();
  });

  // Jump from home category tiles straight into a filtered menu view
  document.body.addEventListener("click", (e) => {
    const tile = e.target.closest("[data-jump-cat]");
    if (!tile) return;
    activeCategory = tile.dataset.jumpCat;
    searchTerm = "";
    $("#menu-search").value = "";
    renderCategoryTabs();
    renderMenuGrid();
  });

  /* ---------------- ADD-TO-CART: quick add & stepper ---------------- */
  document.body.addEventListener("click", (e) => {
    const quickBtn = e.target.closest("[data-quickadd]");
    if (quickBtn) {
      const item = ITEMS.find((i) => i.id === quickBtn.dataset.quickadd);
      openDishModal(item);
      return;
    }
    const stepBtn = e.target.closest(".stepper-mini [data-step]");
    if (stepBtn) {
      const wrap = stepBtn.closest(".stepper-mini");
      const lineId = wrap.dataset.line;
      changeLineQty(lineId, parseInt(stepBtn.dataset.step, 10));
      return;
    }
    // opening dish modal by clicking card image/title (not the add button itself)
    const card = e.target.closest(".dish-card");
    if (card && !e.target.closest(".add-slot")) {
      const item = ITEMS.find((i) => i.id === card.dataset.id);
      if (item) openDishModal(item);
    }
  });

  /* ---------------- DISH MODAL ---------------- */
  function openDishModal(item) {
    currentModalItem = item;
    modalQty = 1;
    modalAddons = {};
    $("#dm-image").src = item.image;
    $("#dm-image").onerror = function(){ this.src = "images/gourmet_plate.png"; };
    $("#dm-bestseller").style.display = item.bestseller ? "" : "none";
    $("#dm-name").textContent = item.name;
    $("#dm-rating").textContent = item.rating;
    $("#dm-category").textContent = item.category;
    $("#dm-desc").textContent = item.description;
    $("#dm-price").textContent = fmt(item.price);
    $("#dm-instructions").value = "";
    $("#dm-qty").textContent = modalQty;

    const addons = ADDON_LIBRARY[item.category] || ADDON_LIBRARY.default;
    $("#dm-addons").innerHTML = addons.map((a, idx) => `
      <div class="addon-opt">
        <label><input type="checkbox" data-addon-idx="${idx}"> ${escapeHTML(a.name)}</label>
        <span>${a.price ? "+" + fmt(a.price) : "Free"}</span>
      </div>`).join("");
    $all("#dm-addons input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", (e) => {
        const idx = e.target.dataset.addonIdx;
        modalAddons[idx] = e.target.checked ? addons[idx] : null;
        updateModalPrice();
      });
    });

    updateModalPrice();
    $("#dish-modal-backdrop").classList.add("open");
  }
  function updateModalPrice() {
    const addonsTotal = Object.values(modalAddons).filter(Boolean).reduce((s, a) => s + a.price, 0);
    const unit = currentModalItem.price + addonsTotal;
    $("#dm-add-price").textContent = fmt(unit * modalQty);
  }
  $("#dm-qty-plus").addEventListener("click", () => { modalQty++; $("#dm-qty").textContent = modalQty; updateModalPrice(); });
  $("#dm-qty-minus").addEventListener("click", () => { if (modalQty > 1) modalQty--; $("#dm-qty").textContent = modalQty; updateModalPrice(); });
  function closeDishModal() { $("#dish-modal-backdrop").classList.remove("open"); }
  $("#dish-modal-close").addEventListener("click", closeDishModal);
  $("#dish-modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "dish-modal-backdrop") closeDishModal(); });

  $("#dm-add-btn").addEventListener("click", () => {
    const addons = Object.values(modalAddons).filter(Boolean);
    const instructions = $("#dm-instructions").value.trim();
    addToCart(currentModalItem, modalQty, addons, instructions);
    closeDishModal();
    showToast(`${currentModalItem.name} added to cart`);
  });

  /* ---------------- CART LOGIC ---------------- */
  function addToCart(item, qty, addons, instructions) {
    const addonsKey = addons.map((a) => a.name).sort().join("|");
    const existing = cart.find((c) => c.id === item.id && c.instructions === instructions &&
      c.addons.map((a) => a.name).sort().join("|") === addonsKey);
    if (existing) {
      existing.qty += qty;
    } else {
      cart.push({
        lineId: item.id + "-" + Date.now() + "-" + Math.floor(Math.random() * 999),
        id: item.id, name: item.name, price: item.price, image: item.image,
        qty, addons, instructions,
      });
    }
    saveCart();
    renderAll();
  }
  function changeLineQty(lineId, delta) {
    const line = cart.find((c) => c.lineId === lineId);
    if (!line) return;
    line.qty += delta;
    if (line.qty <= 0) cart = cart.filter((c) => c.lineId !== lineId);
    saveCart();
    renderAll();
  }
  function removeLine(lineId) {
    cart = cart.filter((c) => c.lineId !== lineId);
    saveCart();
    renderAll();
  }
  function lineUnitPrice(line) { return line.price + line.addons.reduce((s, a) => s + a.price, 0); }
  function cartSubtotal() { return cart.reduce((s, l) => s + lineUnitPrice(l) * l.qty, 0); }
  function cartCount() { return cart.reduce((s, l) => s + l.qty, 0); }

  /* ---------------- RENDER: CART DRAWER ---------------- */
  function renderCartDrawer() {
    const body = $("#cart-body");
    const footer = $("#cart-footer");
    if (!cart.length) {
      body.innerHTML = `<div class="cart-empty">
        <div class="cart-empty-emoji">🛒</div>
        <h3 style="margin-bottom:6px;">Your cart is empty</h3>
        <p class="muted">Add some delicious ShriMelan dishes to get started.</p>
        <button class="btn btn-primary" style="margin-top:16px;" data-nav="menu" id="cart-empty-browse">Browse Menu</button>
      </div>`;
      footer.style.display = "none";
      return;
    }
    footer.style.display = "";
    body.innerHTML = cart.map((line) => `
      <div class="cart-item" data-line="${line.lineId}">
        <img src="${line.image}" onerror="this.src='images/gourmet_plate.png'" alt="">
        <div class="cart-item-info">
          <div class="cart-item-top">
            <span class="cart-item-name">${escapeHTML(line.name)}</span>
            <button class="cart-item-remove" data-remove="${line.lineId}">Remove</button>
          </div>
          ${line.addons.length ? `<span class="cart-item-note">+ ${line.addons.map((a) => escapeHTML(a.name)).join(", ")}</span>` : ""}
          ${line.instructions ? `<span class="cart-item-note">"${escapeHTML(line.instructions)}"</span>` : ""}
          <div class="cart-item-bottom">
            <div class="mini-stepper"><button data-cartstep="-1">−</button><span>${line.qty}</span><button data-cartstep="1">+</button></div>
            <strong>${fmt(lineUnitPrice(line) * line.qty)}</strong>
          </div>
        </div>
      </div>`).join("");

    const sub = cartSubtotal();
    const tax = sub * TAX_RATE;
    $("#cart-subtotal").textContent = fmt(sub);
    $("#cart-tax").textContent = fmt(tax);
    $("#cart-total").textContent = fmt(sub + tax);
  }
  $("#cart-body").addEventListener("click", (e) => {
    const stepBtn = e.target.closest("[data-cartstep]");
    if (stepBtn) {
      const lineId = stepBtn.closest(".cart-item").dataset.line;
      changeLineQty(lineId, parseInt(stepBtn.dataset.cartstep, 10));
    }
    const removeBtn = e.target.closest("[data-remove]");
    if (removeBtn) removeLine(removeBtn.dataset.remove);
  });

  function openCart() { $("#cart-backdrop").classList.add("open"); }
  function closeCart() { $("#cart-backdrop").classList.remove("open"); }
  $("#cart-pill").addEventListener("click", openCart);
  $("#sticky-cart-btn").addEventListener("click", openCart);
  $("#cart-close").addEventListener("click", closeCart);
  $("#cart-backdrop").addEventListener("click", (e) => { if (e.target.id === "cart-backdrop") closeCart(); });
  $("#cart-checkout-btn").addEventListener("click", () => {
    closeCart();
    showView("checkout");
    renderCheckoutSummary();
  });

  /* ---------------- STICKY MOBILE CART BAR ---------------- */
  function updateStickyCart() {
    const shouldShow = cart.length > 0 && (currentViewName === "home" || currentViewName === "menu");
    $("#sticky-cart").style.display = shouldShow ? "" : "none";
    if (shouldShow) {
      $("#sticky-cart-count").textContent = `${cartCount()} item${cartCount() > 1 ? "s" : ""}`;
      $("#sticky-cart-total").textContent = fmt(cartSubtotal() * (1 + TAX_RATE));
    }
    $("#cart-pill-count").textContent = cartCount();
  }

  /* ---------------- CHECKOUT ---------------- */
  const orderTypeGroup = $("#order-type-group");
  orderTypeGroup.addEventListener("change", () => {
    const type = orderTypeGroup.querySelector("input:checked").value;
    $("#field-table").style.display = type === "Dine-in" ? "" : "none";
    $("#field-delivery").style.display = type === "Delivery" ? "" : "none";
  });

  function renderCheckoutSummary() {
    const wrap = $("#checkout-items");
    wrap.innerHTML = cart.map((l) => `<div class="checkout-mini-item"><span>${l.qty} × ${escapeHTML(l.name)}</span><span>${fmt(lineUnitPrice(l) * l.qty)}</span></div>`).join("");
    const sub = cartSubtotal();
    const tax = sub * TAX_RATE;
    $("#ck-subtotal").textContent = fmt(sub);
    $("#ck-tax").textContent = fmt(tax);
    $("#ck-total").textContent = fmt(sub + tax);
  }

  $("#checkout-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!cart.length) { showToast("Your cart is empty"); showView("menu"); return; }

    const name = $("#ck-name").value.trim();
    const mobile = $("#ck-mobile").value.trim();
    const orderType = orderTypeGroup.querySelector("input:checked").value;
    if (!name || !mobile) { showToast("Please fill in your name and mobile number"); return; }
    if (orderType === "Delivery" && !$("#ck-address").value.trim()) {
      showToast("Please add a delivery address"); return;
    }

    const sub = cartSubtotal();
    const tax = sub * TAX_RATE;
    const order = {
      orderNumber: generateOrderNumber(),
      name, mobile, orderType,
      table: $("#ck-table").value.trim(),
      address: $("#ck-address").value.trim(),
      landmark: $("#ck-landmark").value.trim(),
      note: $("#ck-note").value.trim(),
      items: JSON.parse(JSON.stringify(cart)),
      subtotal: sub, tax, total: sub + tax,
      placedAt: new Date().toISOString(),
    };
    lastOrder = order;
    cart = [];
    saveCart();
    renderConfirmation(order);
    showView("confirmation");
  });

  function generateOrderNumber() {
    const d = new Date();
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `SM-${y}${m}${day}-${rand}`;
  }

  /* ---------------- CONFIRMATION ---------------- */
  const STATUS_STEPS = ["Order Received", "Confirmed", "Preparing", "Ready / Served / Out for Delivery", "Completed"];
  function renderConfirmation(order) {
    $("#conf-order-number").textContent = order.orderNumber;
    $("#conf-order-type").textContent = order.orderType + (order.table ? ` · Table ${escapeHTML(order.table)}` : "");
    $("#conf-name").textContent = order.name;
    $("#conf-total").textContent = fmt(order.total);
    $("#conf-payment-status").textContent = "Pending Counter Payment";

    $("#conf-items").innerHTML = order.items.map((l) => `
      <div class="confirm-item-row">
        <span>${l.qty} × ${escapeHTML(l.name)}${l.addons.length ? " + " + l.addons.map(a=>escapeHTML(a.name)).join(", ") : ""}</span>
        <span>${fmt(lineUnitPrice(l) * l.qty)}</span>
      </div>`).join("");

    // simulate live progress for the demo: step 0 done, step 1 active
    $("#status-timeline").innerHTML = STATUS_STEPS.map((step, i) => {
      const cls = i === 0 ? "done" : i === 1 ? "active" : "";
      return `<div class="status-step ${cls}">
        <div class="status-dot">${i === 0 ? "✓" : ""}</div>
        <div><strong>${step}</strong><span>${i === 0 ? "Received by the kitchen" : i === 1 ? "Being confirmed by staff" : "Pending"}</span></div>
      </div>`;
    }).join("");
  }

  $("#reorder-btn").addEventListener("click", () => {
    if (!lastOrder) return;
    lastOrder.items.forEach((l) => {
      cart.push({ ...l, lineId: l.id + "-" + Date.now() + "-" + Math.floor(Math.random() * 999) });
    });
    saveCart();
    renderAll();
    showToast("Items added back to your cart");
    showView("menu");
  });

  /* ---------------- STAFF LOGIN TEASER ---------------- */
  /* ---------------- STAFF LOGIN ---------------- */

$("#staff-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.currentTarget;
  const email = form.querySelector('input[type="email"]').value.trim();
  const password = form.querySelector('input[type="password"]').value;

  const button = form.querySelector("button[type='submit']");
  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "Signing in...";

  try {
    const response = await fetch("http://localhost:4000/api/auth/staff/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({
        email,
        password
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Login failed");
    }

    showToast(`Welcome ${data.name || "Staff"}`);

    // Open staff dashboard
    showView("staff-dashboard");

  } catch (error) {
    console.error("Staff login error:", error);
    showToast(error.message || "Unable to sign in");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

  /* ---------------- POLICY MODAL ---------------- */
  const POLICIES = {
    privacy: `<h5>What we collect</h5><p>Your name, mobile number, and order/delivery details are collected only to process your order and contact you about it.</p>
      <h5>How it's used</h5><p>Order data is shared only with ShriMelan staff handling your order. We never sell your data to third parties.</p>
      <h5>Payment</h5><p>We do not process or store any online payment details — all payments are collected in person at the counter.</p>`,
    terms: `<h5>Placing an order</h5><p>By placing an order, you confirm the details provided (name, mobile number, order type, address) are accurate.</p>
      <h5>Pricing</h5><p>All prices are inclusive of applicable taxes shown at checkout and may change without prior notice.</p>
      <h5>Availability</h5><p>Items marked unavailable may be temporarily out of stock; our staff will inform you if a dish can't be prepared.</p>`,
    cancellation: `<h5>Before preparation begins</h5><p>Orders can be cancelled free of charge before the kitchen marks them "Preparing." Please call the restaurant directly to cancel.</p>
      <h5>After preparation begins</h5><p>Orders already being prepared may not be cancellable, since ingredients have already been used.</p>
      <h5>Refunds</h5><p>As payment is collected at the counter, no online refund is applicable.</p>`,
  };
  $all("[data-policy]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      $("#policy-title").textContent = el.textContent;
      $("#policy-body").innerHTML = POLICIES[el.dataset.policy];
      $("#policy-modal-backdrop").classList.add("open");
    });
  });
  $("#policy-modal-close").addEventListener("click", () => $("#policy-modal-backdrop").classList.remove("open"));
  $("#policy-modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "policy-modal-backdrop") $("#policy-modal-backdrop").classList.remove("open"); });

  /* ---------------- TOAST ---------------- */
  let toastTimer;
  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ---------------- INIT ---------------- */
  function renderAll() {
    renderBestsellers();
    renderMenuGrid();
    renderCartDrawer();
    updateStickyCart();
  }

  function init() {
    renderRestaurantInfo();
    renderCategoryTabs();
    renderCategoryGrid();
    renderGallery();
    renderAll();
    showView("home");
  }
  init();
})();
