import { useRef } from "react";
import type { MenuCategory } from "../types";

interface CategoryTabsProps {
  categories: MenuCategory[];
  activeId: string | null;
  onSelect: (categoryId: string) => void;
}

export function CategoryTabs({ categories, activeId, onSelect }: CategoryTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <nav className="category-tabs" ref={containerRef} aria-label="Menu categories">
      {categories.map((category) => (
        <button
          key={category.id}
          type="button"
          className={`category-tab${category.id === activeId ? " active" : ""}`}
          onClick={(e) => {
            onSelect(category.id);
            e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
          }}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
