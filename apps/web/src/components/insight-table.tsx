"use client";

import { useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@counted/ui/components/table";

type Column = { key: string; label: string; numeric?: boolean };
type Row = { key: string; cells: readonly string[] };

/** Fit the available frame, keeping every result reachable without nested scrolling. */
export function InsightTable({
  columns,
  rows,
  fill = false,
}: {
  columns: readonly Column[];
  rows: readonly Row[];
  fill?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (!fill || !frame.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(entry?.contentRect.height ?? 0),
    );
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [fill]);
  const allRowsFit = height >= 48 + rows.length * 40;
  const pageSize = fill && !allRowsFit
    ? Math.max(1, Math.floor((height - 88) / 40))
    : Math.max(1, rows.length);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const start = current * pageSize;
  return (
    <div
      ref={frame}
      className={
        fill ? "flex h-full min-h-0 flex-col overflow-hidden" : undefined
      }
    >
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                scope="col"
                title={column.label}
                className={`truncate px-2 ${column.numeric ? "w-20 text-right tabular-nums" : ""}`}
              >
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(start, start + pageSize).map((row) => (
            <TableRow key={row.key} className="h-10">
              {row.cells.map((cell, index) => (
                <TableCell
                  key={columns[index]!.key}
                  title={cell}
                  className={`truncate px-2 py-2 ${columns[index]!.numeric ? "text-right tabular-nums" : ""}`}
                >
                  {cell}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {pages > 1 && (
        <div className="mt-auto flex min-h-10 shrink-0 items-center justify-between gap-2 pt-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {start + 1}–{Math.min(start + pageSize, rows.length)} of{" "}
            {rows.length}
          </span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous rows"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <IconChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next rows"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              <IconChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
