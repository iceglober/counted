"use client";
import { Badge } from "@counted/ui/components/badge";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@counted/ui/components/table";
const records = [
  {
    name: "acme-web",
    status: "Active",
    environment: "Production",
    count: "12,840",
  },
  {
    name: "acme-api",
    status: "Active",
    environment: "Production",
    count: "8,256",
  },
  { name: "acme-docs", status: "Draft", environment: "Staging", count: "240" },
];
export default function TableExample({
  variant = "default",
}: {
  variant?: string;
}) {
  return (
    <div className="w-full bg-background p-2">
      <Table>
        <TableCaption>
          {variant === "empty"
            ? "An empty collection."
            : "Three example records in the current collection."}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead className="text-right">Readings</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(variant === "empty" ? [] : records).map((record, index) => (
            <TableRow
              key={record.name}
              data-state={
                variant === "selected-row" && index === 0
                  ? "selected"
                  : undefined
              }
            >
              <TableCell className="font-medium">{record.name}</TableCell>
              <TableCell>
                <Badge
                  variant={record.status === "Active" ? "success" : "secondary"}
                >
                  {record.status}
                </Badge>
              </TableCell>
              <TableCell>{record.environment}</TableCell>
              <TableCell className="text-right tabular-nums">
                {record.count}
              </TableCell>
            </TableRow>
          ))}
          {variant === "empty" && (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-12 text-center text-muted-foreground"
              >
                No records in this collection.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
