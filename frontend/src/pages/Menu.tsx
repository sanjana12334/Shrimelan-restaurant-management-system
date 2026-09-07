import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type { MenuCategory, MenuItem, MenuResponse } from "../types";
import { CategoryTabs } from "../components/CategoryTabs";
import { ItemCard } from "../components/ItemCard";
import { ItemSheet } from "../components/ItemSheet";
import { CartBar } from "../components/CartBar";
import { useCart } from "../context/CartContext";
import { useSession } from "../context/SessionContext";

export function Menu() {
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<MenuItem | null>(null);
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map());
  const cart = useCart();
  const { tableLabel } = useSession();

  useEffect(() => {
    let cancelled = false;
    api
      .getMenu()
      .then((res) => {
        if (cancelled) return;
        setMenu(res);
        const firstNonEmpty = res.categories.find((c) => c.items.length > 0);
        setActiveCategoryId(firstNonEmpty?.id ?? res.categories[0]?.id ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof ApiError ? err.message : "Couldn't load the menu. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleCategories = useMemo<MenuCategory[]>(() => (menu ? menu.categories.filter((c) => c.items.length > 0) : []), [menu]);

  useEffect(() => {
    if (visibleCategories.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const id = visible[0].target.getAttribute("data-category-id");
          if (id) setActiveCategoryId(id);
        }
      },
      { rootMargin: "-120px 0px -70% 0px", threshold: 0 },
    );
    sectionRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [visibleCategories]);

  function quantityInCartFor(itemId: string): number {
    return cart.lines.filter((l) => l.itemId === itemId).reduce((sum, l) => sum + l.quantity, 0);
  }

  function scrollToCategory(categoryId: string) {
    setActiveCategoryId(categoryId);
    sectionRefs.current.get(categoryId)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (loadError) {
    return (
      <div className="centered-state">
        <h1>Couldn't load the menu</h1>
        <p>{loadError}</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  if (!menu) {
    return (
      <div className="centered-state">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="page">
      <header className="top-bar">
        <div className="brand-mark">
          <span>
            Shri<em>Melan</em>
          </span>
        </div>
        {tableLabel && (
          <span className="table-chip">
            <span className="dot" />
            {tableLabel}
          </span>
        )}
      </header>

      {visibleCategories.length > 0 && (
        <CategoryTabs categories={visibleCategories} activeId={activeCategoryId} onSelect={scrollToCategory} />
      )}

      <div className="menu-scroll" style={{ ["--cart-bar-h" as string]: cart.itemCount > 0 ? "72px" : "0px" }}>
        {visibleCategories.length === 0 && (
          <div className="centered-state">
            <h1>Nothing on the menu right now</h1>
            <p>Please check with a staff member — the kitchen may be updating today's menu.</p>
          </div>
        )}

        {visibleCategories.map((category) => (
          <section
            key={category.id}
            className="category-section"
            data-category-id={category.id}
            ref={(el) => {
              if (el) sectionRefs.current.set(category.id, el);
              else sectionRefs.current.delete(category.id);
            }}
          >
            <h2 className="category-heading">{category.name}</h2>
            {category.items.map((item) => (
              <ItemCard key={item.id} item={item} quantityInCart={quantityInCartFor(item.id)} onOpen={() => setOpenItem(item)} />
            ))}
          </section>
        ))}
      </div>

      <CartBar />

      {openItem && (
        <ItemSheet
          item={openItem}
          onClose={() => setOpenItem(null)}
          onAdd={({ variantId, addonIds, quantity, instructions }) => {
            const variant = openItem.variants.find((v) => v.id === variantId);
            const addons = openItem.addons.filter((a) => addonIds.includes(a.id));
            cart.addToCart({ item: openItem, variant, addons, quantity, instructions });
            setOpenItem(null);
          }}
        />
      )}
    </div>
  );
}
