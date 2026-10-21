// Tiny shared helpers for components. `cn` merges Tailwind class names
// (clsx + tailwind-merge) so conditional classes never fight each other.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
