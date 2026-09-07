import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type MenuItemInput } from "../api";
import type { AdminMenuCategory, AdminMenuItem } from "../types";
import { formatMoney } from "../lib/format";

type Modal = { kind: "create" } | { kind: "edit"; item: AdminMenuItem; categoryId: string };
type ItemForm = MenuItemInput;

const blankForm = (): ItemForm => ({
  categoryId: "", itemCode: "", name: "", description: "", price: 0, imageUrl: "", isVeg: true, isBestseller: false, isAvailable: true,
});

export function Menu() {
  const [categories, setCategories] = useState<AdminMenuCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [form, setForm] = useState<ItemForm>(blankForm);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);

  async function load() {
    try {
      const result = await api.getMenu();
      setCategories(result.categories);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the menu.");
    }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3_000);
    return () => clearTimeout(timer);
  }, [toast]);

  function openCreate() {
    setForm({ ...blankForm(), categoryId: categories?.[0]?.id ?? "" });
    setModal({ kind: "create" });
  }

  function openEdit(item: AdminMenuItem, categoryId: string) {
    setForm({
      categoryId, itemCode: item.itemCode, name: item.name, description: item.description,
      price: Number(item.price), imageUrl: item.imageUrl, isVeg: item.isVeg,
      isBestseller: item.isBestseller, isAvailable: item.isAvailable,
    });
    setModal({ kind: "edit", item, categoryId });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!modal) return;
    setSaving(true);
    try {
      if (modal.kind === "create") await api.createMenuItem(form);
      else await api.updateMenuItem(modal.item.id, form);
      setModal(null);
      await load();
      setToast({ message: modal.kind === "create" ? "Menu item created" : "Menu item updated" });
    } catch (err) {
      setToast({ message: err instanceof ApiError ? err.message : "Could not save the menu item.", error: true });
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: AdminMenuItem) {
    if (!window.confirm(`Delete “${item.name}”? Items with order history cannot be deleted.`)) return;
    try {
      await api.deleteMenuItem(item.id);
      await load();
      setToast({ message: "Menu item deleted" });
    } catch (err) {
      setToast({ message: err instanceof ApiError ? err.message : "Could not delete the menu item.", error: true });
    }
  }

  return (
    <div>
      <div className="page-header">
        <div><h1>Menu</h1><p>Create, edit, price, retire, or delete menu items.</p></div>
        <button className="btn btn-primary" onClick={openCreate} disabled={!categories?.length}>New item</button>
      </div>
      {error && <div className="card empty-state">{error}</div>}
      {!error && !categories && <div className="full-page-loading"><div className="spinner" /></div>}
      {!error && categories?.length === 0 && <div className="card empty-state">Create a category in Prisma Studio before adding items.</div>}
      {!error && categories?.map((category) => (
        <div key={category.id} className="card" style={{ marginBottom: 20 }}>
          <h2 style={{ margin: "0 0 12px", fontSize: 16 }}>{category.name}</h2>
          <table className="data-table"><thead><tr><th>Item</th><th>Price</th><th>Available</th><th /></tr></thead>
            <tbody>{category.items.map((item) => (
              <tr key={item.id}><td>{item.name}</td><td>{formatMoney(item.price)}</td>
                <td>{item.isAvailable ? "Available" : "Unavailable"}</td><td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => openEdit(item, category.id)}>Edit</button>
                    <button className="btn btn-sm btn-secondary" onClick={() => void remove(item)}>Delete</button>
                  </div>
                </td></tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {modal && <div className="modal-backdrop" onClick={() => !saving && setModal(null)}><form className="modal" onSubmit={save} onClick={(event) => event.stopPropagation()}>
        <h2>{modal.kind === "create" ? "New menu item" : "Edit menu item"}</h2>
        <div className="field"><label>Category</label><select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>{categories?.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>
        <div className="field"><label>Item code</label><input value={form.itemCode} onChange={(e) => setForm({ ...form, itemCode: e.target.value })} required /></div>
        <div className="field"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="field"><label>Description</label><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></div>
        <div className="field"><label>Price (₹)</label><input type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: Number(e.target.value) })} required /></div>
        <div className="field"><label>Image URL</label><input value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} /></div>
        <label><input type="checkbox" checked={form.isVeg} onChange={(e) => setForm({ ...form, isVeg: e.target.checked })} /> Vegetarian</label>{" "}
        <label><input type="checkbox" checked={form.isBestseller} onChange={(e) => setForm({ ...form, isBestseller: e.target.checked })} /> Bestseller</label>{" "}
        <label><input type="checkbox" checked={form.isAvailable} onChange={(e) => setForm({ ...form, isAvailable: e.target.checked })} /> Available</label>
        <div className="modal-actions"><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save"}</button></div>
      </form></div>}
      {toast && <div className={`toast ${toast.error ? "error" : ""}`}>{toast.message}</div>}
    </div>
  );
}
