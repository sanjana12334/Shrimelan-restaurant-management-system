import type { MenuItem } from "../types";

interface ItemCardProps {
  item: MenuItem;
  quantityInCart: number;
  onOpen: () => void;
}

export function ItemCard({ item, quantityInCart, onOpen }: ItemCardProps) {
  return (
    <button type="button" className="item-card" onClick={onOpen}>
      <div className="item-card-info">
        <div className="item-top-row">
          <span className={`veg-dot${item.isVeg ? "" : " non-veg"}`} aria-hidden="true" />
          {item.isBestseller && <span className="bestseller-badge">Bestseller</span>}
        </div>
        <span className="item-name">{item.name}</span>
        <span className="item-price">₹{Number(item.price).toFixed(0)}</span>
        <span className="item-desc">{item.description}</span>
        <span className="item-rating">★ {Number(item.rating).toFixed(1)}</span>
      </div>
      <div className="item-media">
        <img src={item.imageUrl} alt="" loading="lazy" />
        <span className={`item-add-btn${quantityInCart > 0 ? " in-cart" : ""}`}>
          {quantityInCart > 0 ? `${quantityInCart} added` : "Add"}
        </span>
      </div>
    </button>
  );
}
