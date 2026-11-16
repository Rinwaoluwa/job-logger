import { memo, useEffect } from "react";

export const PAGE_SIZES = [25, 50, 100];

/**
 * Client-side pager for a list the API already returns in full. Shows
 * "1–25 of 248", page size, and Prev / Next; the parent slices with
 * `pageSlice`. Clamps the page when the list shrinks under it.
 */
function Pagination({ total, page, pageSize, onPage, onPageSize, noun = "jobs" }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > pages) onPage(pages);
  }, [page, pages, onPage]);
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span className="small muted">
        {from}–{to} of <strong>{total}</strong> {noun}
      </span>
      <select value={pageSize} onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }} aria-label="Rows per page">
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
      </select>
      <button type="button" className="btn-sm btn-muted" onClick={() => onPage(page - 1)} disabled={page <= 1}>‹ Prev</button>
      <span className="small muted">page {page} of {pages}</span>
      <button type="button" className="btn-sm btn-muted" onClick={() => onPage(page + 1)} disabled={page >= pages}>Next ›</button>
    </div>
  );
}

export function pageSlice(rows, page, pageSize) {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

export default memo(Pagination);
