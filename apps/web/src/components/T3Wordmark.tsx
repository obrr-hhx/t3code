import type { SVGProps } from "react";

export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 15.5C6.2 8.5 8.6 7.7 11.3 10.1C15.3 3.1 18.5 2.1 22 9.5C18.8 9.4 17.5 6.7 15.4 8.3L12.1 13C8.9 11.4 7 12.8 2 15.5Z"
        fill="currentColor"
      />
      <path
        d="M4 21C8.3 14.3 10.3 13.7 12.6 15.4C15.8 11.4 18.2 11.1 21.2 16.4C18.6 17.1 17 14.8 15.4 15.8L12.4 19.1C9.3 17.4 7.1 19.5 4 21Z"
        fill="currentColor"
      />
      <path
        d="M15.4 8.3C17.5 6.7 18.8 9.4 22 9.5C20.4 6.2 19.6 5 18.6 5.1C17.3 5.2 16.4 6.7 15.4 8.3Z"
        fill="var(--color-orange-600)"
      />
    </svg>
  );
}
