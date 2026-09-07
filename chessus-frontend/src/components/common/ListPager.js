import React, { useEffect, useMemo, useState } from "react";
import styles from "./listpager.module.scss";

export const PAGE_SIZE = 20;

/**
 * Page a client-side list.
 *
 * Returns the current page's slice plus what ListPager needs to draw itself.
 * Filtering a list shorter than the page you were on would otherwise leave you
 * staring at an empty page with no obvious way back, so the page snaps into
 * range whenever the list changes size.
 */
export const usePagedList = (items, pageSize = PAGE_SIZE) => {
  const [page, setPage] = useState(0);
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount - 1) setPage(pageCount - 1);
  }, [page, pageCount]);

  const safePage = Math.min(page, pageCount - 1);
  const pageItems = useMemo(
    () => items.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [items, safePage, pageSize]
  );

  return { pageItems, page: safePage, setPage, total, pageSize, pageCount };
};

/** Previous / Next with a position readout. Draws nothing on a single page. */
const ListPager = ({ page, setPage, total, pageSize = PAGE_SIZE, label = "items", onNavigate }) => {
  if (total <= pageSize) return null;

  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  const go = (next) => {
    setPage(next);
    if (onNavigate) onNavigate();
  };

  return (
    <div className={styles["pager"]}>
      <button type="button" onClick={() => go(page - 1)} disabled={page === 0}>
        ← Previous
      </button>
      <span className={styles["pager-count"]}>
        {first}–{last} of {total} {label}
      </span>
      <button
        type="button"
        onClick={() => go(page + 1)}
        disabled={(page + 1) * pageSize >= total}
      >
        Next →
      </button>
    </div>
  );
};

export default ListPager;
