"use client";
import { useState } from "react";
import { IconArchive, IconDots, IconSearch } from "@tabler/icons-react";
import { Badge } from "@counted/ui/components/badge";
import { Button } from "@counted/ui/components/button";
import { Checkbox } from "@counted/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@counted/ui/components/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@counted/ui/components/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@counted/ui/components/input-group";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@counted/ui/components/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@counted/ui/components/table";
import { toast } from "@counted/ui/components/toast";
const initial = [
  "acme-web",
  "acme-api",
  "acme-docs",
  "atlas-web",
  "atlas-api",
  "studio-web",
].map((name, i) => ({
  name,
  status: i % 3 === 2 ? "Draft" : "Active",
  readings: [12840, 8256, 240, 1840, 526, 85][i]!,
}));
export default function CollectionTableExample() {
  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const filtered = rows.filter((row) => row.name.includes(query.toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 3));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * 3, currentPage * 3);
  const allSelected =
    shown.length > 0 && shown.every((r) => selected.includes(r.name));
  function archive(names: string[]) {
    setRows(rows.filter((r) => !names.includes(r.name)));
    setSelected(selected.filter((n) => !names.includes(n)));
    toast.add({
      title: `${names.length} record${names.length === 1 ? "" : "s"} archived`,
      description: "This change only affects the example.",
    });
  }
  return (
    <div className="@container/collection w-full border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <InputGroup className="w-full max-w-64">
          <InputGroupInput
            aria-label="Filter table records"
            placeholder="Search the collection…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
        </InputGroup>
        {selected.length ? (
          <Button variant="outline" size="sm" onClick={() => archive(selected)}>
            Archive {selected.length}
          </Button>
        ) : (
          <Badge variant="outline">{filtered.length} records</Badge>
        )}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 pl-5">
              <Checkbox
                aria-label="Select visible records"
                checked={allSelected}
                indeterminate={
                  !allSelected && shown.some((r) => selected.includes(r.name))
                }
                disabled={!shown.length}
                onCheckedChange={(checked) =>
                  setSelected(
                    checked
                      ? [...new Set([...selected, ...shown.map((r) => r.name)])]
                      : selected.filter(
                          (n) => !shown.some((r) => r.name === n),
                        ),
                  )
                }
              />
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden text-right @min-[480px]/collection:table-cell">
              Readings
            </TableHead>
            <TableHead className="w-12">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((row) => (
            <TableRow
              key={row.name}
              data-state={selected.includes(row.name) ? "selected" : undefined}
            >
              <TableCell className="pl-5">
                <Checkbox
                  aria-label={`Select ${row.name}`}
                  checked={selected.includes(row.name)}
                  onCheckedChange={(checked) =>
                    setSelected(
                      checked
                        ? [...selected, row.name]
                        : selected.filter((n) => n !== row.name),
                    )
                  }
                />
              </TableCell>
              <TableCell className="font-medium">{row.name}</TableCell>
              <TableCell>
                <Badge
                  variant={row.status === "Active" ? "success" : "secondary"}
                >
                  {row.status}
                </Badge>
              </TableCell>
              <TableCell className="hidden text-right tabular-nums @min-[480px]/collection:table-cell">
                {row.readings.toLocaleString("en-US")}
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${row.name}`}
                      />
                    }
                  >
                    <IconDots />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuGroup>
                      <DropdownMenuItem onClick={() => archive([row.name])}>
                        <IconArchive />
                        Archive record
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!shown.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No matching records</EmptyTitle>
            <EmptyDescription>
              {rows.length
                ? "Try another search to find a record."
                : "All example records have been archived."}
            </EmptyDescription>
          </EmptyHeader>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRows(initial);
              setQuery("");
              setPage(1);
            }}
          >
            Reset collection
          </Button>
        </Empty>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {selected.length} selected · Page {currentPage} of {pageCount}
        </span>
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href="#"
                aria-disabled={currentPage === 1}
                onClick={(e) => {
                  e.preventDefault();
                  setPage(Math.max(1, currentPage - 1));
                }}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                href="#"
                aria-disabled={currentPage === pageCount}
                onClick={(e) => {
                  e.preventDefault();
                  setPage(Math.min(pageCount, currentPage + 1));
                }}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </div>
  );
}
