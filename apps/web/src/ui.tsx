import { useEffect, useId, useRef, type ReactNode } from "react";
export type IconName =
  | "feed"
  | "bike"
  | "user"
  | "route"
  | "arrow"
  | "plus"
  | "lock"
  | "message"
  | "edit"
  | "close"
  | "mountain"
  | "shop"
  | "book"
  | "wrench"
  | "check";
const paths: Record<IconName, ReactNode> = {
  feed: (
    <>
      <path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" />
    </>
  ),
  bike: (
    <>
      <circle cx="5" cy="17" r="4" />
      <circle cx="19" cy="17" r="4" />
      <path d="m5 17 5-8 5 8H5l8-12h4l2 12M7 8h5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 22v-3a8 8 0 0 1 16 0v3" />
    </>
  ),
  route: (
    <>
      <path d="M6 20c0-7 12-3 12-10M6 8V4m0 0H3m3 0h3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="20" r="2" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4M12 15v2" />
    </>
  ),
  message: <path d="M3 4h18v13H9l-6 4V4Z" />,
  edit: <path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  mountain: <path d="m2 20 8-15 5 9 3-6 5 12H2Zm6-11 2 3 2-3" />,
  shop: (
    <>
      <path d="M3 8h18l-2-5H5L3 8ZM5 8v13h14V8M9 21v-7h6v7" />
    </>
  ),
  book: (
    <path d="M12 5c-4-3-8-2-10-1v16c4-2 7-2 10 0 3-2 6-2 10 0V4c-2-1-6-2-10 1v15" />
  ),
  wrench: (
    <path d="M15 3a6 6 0 0 0-6 8L2 18l4 4 7-7a6 6 0 0 0 8-6l-4 3-4-4 3-5Z" />
  ),
  check: <path d="m4 12 5 5L20 6" />,
};
export const Icon = ({
  name,
  size = 20,
}: {
  name: IconName;
  size?: number;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {paths[name]}
  </svg>
);
export const Avatar = ({
  name,
  large = false,
}: {
  name: string;
  large?: boolean;
}) => (
  <span className={`avatar ${large ? "large" : ""}`} aria-hidden="true">
    {name.slice(0, 1).toUpperCase()}
  </span>
);
export function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2 id={id}>{title}</h2>
        <button
          className="icon-button"
          aria-label="Закрыть окно"
          onClick={close}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export const ErrorBox = ({ message }: { message: string }) =>
  message ? (
    <div className="error-box" role="alert">
      {message}
    </div>
  ) : null;
// A skeleton in the shape of content; the status text stays for screen readers.
export const Loading = () => (
  <div className="loading" role="status">
    <span className="sr-only">Загружаем…</span>
    <span className="skeleton wide" aria-hidden="true" />
    <span className="skeleton" aria-hidden="true" />
    <span className="skeleton" aria-hidden="true" />
    <span className="skeleton short" aria-hidden="true" />
  </div>
);
export const formatDate = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
export function Contours() {
  return (
    <svg
      className="contours"
      viewBox="0 0 650 450"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth="1.2">
        {Array.from({ length: 16 }, (_, i) => (
          <path
            key={i}
            d={`M${240 + i * 14} -40C${220 + i * 22} 60 ${190 - i * 8} 125 ${345 - i * 5} 205S${570 + i * 13} 335 ${420 + i * 21} 500`}
          />
        ))}
        <path
          strokeWidth="3"
          strokeDasharray="5 9"
          d="M490 30c-240 100 60 150-160 240S230 365 320 420"
        />
      </g>
      <circle cx="490" cy="30" r="8" fill="currentColor" />
      <circle cx="320" cy="420" r="8" fill="currentColor" />
    </svg>
  );
}
