"use client";
import { useState } from "react";
import {
  IconArchive,
  IconCopy,
  IconDots,
  IconPencil,
} from "@tabler/icons-react";
import { Button } from "@counted/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@counted/ui/components/dropdown-menu";
import { toast } from "@counted/ui/components/toast";
export default function DropdownMenuExample({
  variant = "actions",
}: {
  variant?: string;
}) {
  const [checked, setChecked] = useState(true);
  const [view, setView] = useState("overview");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Record options
        <IconDots data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        {variant === "checkboxes" ? (
          <DropdownMenuGroup>
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={checked}
              onCheckedChange={setChecked}
            >
              Environment
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem defaultChecked>
              Created date
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        ) : variant === "radio" ? (
          <DropdownMenuRadioGroup value={view} onValueChange={setView}>
            <DropdownMenuRadioItem value="overview">
              Overview
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="details">
              Details
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        ) : variant === "submenu" ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Export records</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem
                onClick={() => toast.add({ title: "CSV export selected" })}
              >
                CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => toast.add({ title: "JSON export selected" })}
              >
                JSON
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>acme-web</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => toast.add({ title: "Edit selected" })}
              >
                <IconPencil />
                Edit record
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast.add({ title: "Record duplicated", type: "success" })
                }
              >
                <IconCopy />
                Duplicate
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => toast.add({ title: "Record archived" })}
            >
              <IconArchive />
              Archive record
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
