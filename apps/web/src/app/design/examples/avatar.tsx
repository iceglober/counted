"use client";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@counted/ui/components/avatar";
export default function AvatarExample({
  variant = "default",
}: {
  variant?: string;
}) {
  if (variant === "group")
    return (
      <AvatarGroup>
        {["AC", "AT", "ST"].map((name) => (
          <Avatar key={name}>
            <AvatarFallback>{name}</AvatarFallback>
          </Avatar>
        ))}
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>
    );
  return (
    <Avatar
      size={variant === "small" ? "sm" : variant === "large" ? "lg" : "default"}
    >
      <AvatarFallback>AC</AvatarFallback>
    </Avatar>
  );
}
