import type { SVGProps } from "react";
const paths = {
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  space: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  back: "M19 12H5m5-5-5 5 5 5",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8",
  note: "M6 3h9l4 4v14H5V3h1m8 0v5h5M8 12h8m-8 4h5",
  check: "m5 12 4 4L19 6",
  search: "M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0m-2 4 6 6",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2",
  bell: "M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3V9m4 12h4",
  link: "m10 14 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0",
  sliders: "M4 7h16M4 17h16M8 4v6m8 4v6",
  history: "M3 11a9 9 0 1 1 3 8M3 4v7h7m2-5v6l4 3",
  tool: "M4 3h16v18H4zM7 7h10m-10 5h2m4 0h4m-10 5h2m4 0h4",
  close: "m6 6 12 12M6 18 18 6",
  help: "M12 17v.1M9 8a3 3 0 1 1 4 3c-1 1-1 2-1 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
};
export type IconName = keyof typeof paths;
export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
