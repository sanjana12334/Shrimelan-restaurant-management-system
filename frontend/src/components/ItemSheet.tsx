import { useEffect, useState } from "react";
import type { MenuItem } from "../types";
import { QuantityStepper } from "./QuantityStepper";

interface ItemSheetProps {
  item: MenuItem;
  onClose: () => void;
  onAdd: (input: { variantId?: string; addonIds: string[]; quantity: number; instructions?: string }) => void;
}

export function ItemSheet({ item, onClose, onAdd }: ItemSheetProps) {
  const [variantId, setVariantId] = useState<string | undefined>(item.variants[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState("");

  // Reset local selections whenever a different item is opened.
  useEffect(() => {
    setVariantId(item.variants[0]?.id);
    setAddonIds([]);
    setQuantity(1);
    setInstructions("");
  }, [item.id]);

  const selectedVariant = item.variants.find((v) => v.id === variantId);
  const selectedAddons = item.addons.filter((a) => addonIds.includes(a.id));
  const unitPrice =
    Number(item.price) + (selectedVariant ? Number(selectedVariant.priceDelta) : 0) + selectedAddons.reduce((sum, a) => sum + Number(a.price), 0);
  const lineTotal = unitPrice * quantity;

  function toggleAddon(id: string) {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="sheet-handle" />
        <div className="sheet-scroll">
          <img className="sheet-media" src={item.imageUrl} alt="" />
          <div className="sheet-title-row">
            <div>
              <span className={`veg-dot${item.isVeg ? "" : " non-veg"}`} aria-hidden="true" />
            </div>
            <h2 className="sheet-title" style={{ flex: 1 }}>
              {item.name}
            </h2>
            <span className="item-price">₹{unitPrice.toFixed(0)}</span>
          </div>
          <p className="sheet-desc">{item.description}</p>

          {item.variants.length > 0 && (
            <div className="option-group">
              <div className="option-group-title">Choose an option</div>
              {item.variants.map((variant) => (
                <label className="option-row" key={variant.id}>
                  <span className="option-label">
                    <input
                      type="radio"
                      name="variant"
                      checked={variantId === variant.id}
                      onChange={() => setVariantId(variant.id)}
                    />
                    {variant.name}
                  </span>
                  <span className="option-price">
                    {Number(variant.priceDelta) > 0 ? `+₹${Number(variant.priceDelta).toFixed(0)}` : "Included"}
                  </span>
                </label>
              ))}
            </div>
          )}

          {item.addons.length > 0 && (
            <div className="option-group">
              <div className="option-group-title">Add-ons</div>
              {item.addons.map((addon) => (
                <label className="option-row" key={addon.id}>
                  <span className="option-label">
                    <input type="checkbox" checked={addonIds.includes(addon.id)} onChange={() => toggleAddon(addon.id)} />
                    {addon.name}
                  </span>
                  <span className="option-price">+₹{Number(addon.price).toFixed(0)}</span>
                </label>
              ))}
            </div>
          )}

          <div className="option-group">
            <div className="option-group-title">Cooking instructions (optional)</div>
            <textarea
              className="instructions-input"
              rows={2}
              maxLength={150}
              placeholder="e.g. less spicy, no onion"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
        </div>

        <div className="sheet-footer">
          <QuantityStepper value={quantity} onChange={setQuantity} />
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() =>
              onAdd({
                variantId,
                addonIds,
                quantity,
                instructions: instructions.trim() || undefined,
              })
            }
          >
            Add to cart · ₹{lineTotal.toFixed(0)}
          </button>
        </div>
      </div>
    </div>
  );
}
