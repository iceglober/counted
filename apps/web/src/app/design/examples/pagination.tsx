"use client";
import { useState } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@counted/ui/components/pagination";
export default function PaginationExample({
  variant = "default",
}: {
  variant?: string;
}) {
  const [page, setPage] = useState(
    variant === "middle-page" ? 2 : variant === "last-page" ? 3 : 1,
  );
  return (
    <div className="flex w-full max-w-sm flex-col gap-7">
      <p
        className="text-center text-sm text-muted-foreground"
        aria-live="polite"
      >
        Page {page} of 3
      </p>
      <Pagination>
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              aria-disabled={page === 1}
              onClick={(e) => {
                e.preventDefault();
                setPage(Math.max(1, page - 1));
              }}
            />
          </PaginationItem>
          {[1, 2, 3].map((n) => (
            <PaginationItem key={n}>
              <PaginationLink
                href="#"
                isActive={page === n}
                aria-label={`Page ${n}`}
                onClick={(e) => {
                  e.preventDefault();
                  setPage(n);
                }}
              >
                {n}
              </PaginationLink>
            </PaginationItem>
          ))}
          <PaginationItem>
            <PaginationNext
              href="#"
              aria-disabled={page === 3}
              onClick={(e) => {
                e.preventDefault();
                setPage(Math.min(3, page + 1));
              }}
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}
