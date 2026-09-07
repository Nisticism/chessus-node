import React from "react";
import styles from "./listfilterbar.module.scss";

/*
 * Search + filter for a long list.
 *
 * Renders NOTHING until the list is actually long enough to need it (default 20
 * items). A profile with six ongoing games does not want a search box above
 * them; one with sixty is unusable without. The threshold is measured against
 * the unfiltered total, so the bar cannot disappear once a search narrows the
 * list below it and strand the reader with no way back.
 */
const ListFilterBar = ({
  total,
  shown,
  threshold = 20,
  query,
  onQueryChange,
  placeholder = "Search…",
  filters = [],
  filter,
  onFilterChange,
  label = "items",
}) => {
  if (!Number.isFinite(total) || total <= threshold) return null;

  const filtered = shown !== total;

  return (
    <div className={styles["filter-bar"]}>
      <div className={styles["search-wrap"]}>
        <span className={styles["search-icon"]} aria-hidden="true">🔍</span>
        <input
          type="search"
          className={styles["search-input"]}
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {!!query && (
          <button
            type="button"
            className={styles["clear-btn"]}
            onClick={() => onQueryChange('')}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {filters.length > 0 && (
        <select
          className={styles["filter-select"]}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          aria-label="Filter"
        >
          {filters.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
      )}

      <span className={styles["count"]}>
        {filtered ? `${shown} of ${total} ${label}` : `${total} ${label}`}
      </span>
    </div>
  );
};

export default ListFilterBar;
