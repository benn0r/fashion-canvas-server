import type { FormEvent } from "react";
import type { Pagination } from "./types";

export function DirectorySearch({
  label,
  placeholder,
  value,
  activeSearch,
  onChange,
  onSearch,
}: {
  label: string;
  placeholder: string;
  value: string;
  activeSearch: string;
  onChange: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(value);
  }

  return (
    <form className="directory-search" role="search" onSubmit={submit}>
      <label>
        <span>{label}</span>
        <input
          type="search"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button type="submit">Search</button>
      {(activeSearch || value) && (
        <button
          className="secondary-action"
          type="button"
          onClick={() => {
            onChange("");
            onSearch("");
          }}
        >
          Clear
        </button>
      )}
    </form>
  );
}

export function PaginationControls({
  pagination,
  onPage,
}: {
  pagination: Pagination;
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, pagination.totalPages);
  return (
    <nav className="directory-pagination" aria-label="Pagination">
      <span>
        {pagination.total.toLocaleString()} {pagination.total === 1 ? "result" : "results"}
      </span>
      <div>
        <button
          type="button"
          disabled={pagination.page <= 1}
          onClick={() => onPage(pagination.page - 1)}
        >
          ← Previous
        </button>
        <span>
          Page {pagination.page} of {totalPages}
        </span>
        <button
          type="button"
          disabled={pagination.page >= totalPages}
          onClick={() => onPage(pagination.page + 1)}
        >
          Next →
        </button>
      </div>
    </nav>
  );
}
