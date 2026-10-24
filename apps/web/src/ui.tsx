import { useEffect, useId, useRef, useState, type ReactNode } from "react";
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
  | "check"
  | "bell"
  | "game"
  | "gear"
  | "share"
  | "users"
  | "user-heart"
  | "bookmark"
  | "user-circle"
  | "shield-check"
  | "chevron";
const paths: Record<IconName, ReactNode> = {
  share: (
    <>
      <path d="M12 3v12M7.5 7.5 12 3l4.5 4.5" />
      <path d="M5 12v7.5h14V12" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      <circle cx="12" cy="12" r="6.5" />
    </>
  ),
  // Navigation icons from Tabler Icons 3.24 (MIT, tabler.io/icons): users, route,
  // device-gamepad-2, motorbike, user-heart, bookmark, user-circle, lock, shield-check,
  // message, mountain — chosen by the owner on 16.10.2026 («Люди и путь»).
  users: (
    <>
      <path d="M9 7m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0" />
      <path d="M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0 -3 -3.85" />
    </>
  ),
  game: (
    <>
      <path d="M12 5h3.5a5 5 0 0 1 0 10h-5.5l-4.015 4.227a2.3 2.3 0 0 1 -3.923 -2.035l1.634 -8.173a5 5 0 0 1 4.904 -4.019h3.4z" />
      <path d="M14 15l4.07 4.284a2.3 2.3 0 0 0 3.925 -2.023l-1.6 -8.232" />
      <path d="M8 9v2" />
      <path d="M7 10h2" />
      <path d="M14 10h2" />
    </>
  ),
  "user-heart": (
    <>
      <path d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0" />
      <path d="M6 21v-2a4 4 0 0 1 4 -4h.5" />
      <path d="M18 22l3.35 -3.284a2.143 2.143 0 0 0 .005 -3.071a2.242 2.242 0 0 0 -3.129 -.006l-.224 .22l-.223 -.22a2.242 2.242 0 0 0 -3.128 -.006a2.143 2.143 0 0 0 -.006 3.071l3.355 3.296z" />
    </>
  ),
  bookmark: (
    <path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4z" />
  ),
  "user-circle": (
    <>
      <path d="M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0" />
      <path d="M12 10m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M6.168 18.849a4 4 0 0 1 3.832 -2.849h4a4 4 0 0 1 3.834 2.855" />
    </>
  ),
  "shield-check": (
    <>
      <path d="M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06" />
      <path d="M15 19l2 2l4 -4" />
    </>
  ),
  feed: (
    <>
      <path d="M4 4h16v16H4zM8 8h8M8 12h8M8 16h5" />
    </>
  ),
  bike: (
    <>
      <path d="M5 16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M19 16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
      <path d="M7.5 14h5l4 -4h-10.5m1.5 4l4 -4" />
      <path d="M13 6h2l1.5 3l2 4" />
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
      <path d="M3 19a2 2 0 1 0 4 0a2 2 0 0 0 -4 0" />
      <path d="M19 7a2 2 0 1 0 0 -4a2 2 0 0 0 0 4z" />
      <path d="M11 19h5.5a3.5 3.5 0 0 0 0 -7h-8a3.5 3.5 0 0 1 0 -7h4.5" />
    </>
  ),
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: (
    <>
      <path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
      <path d="M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0" />
      <path d="M8 11v-4a4 4 0 1 1 8 0v4" />
    </>
  ),
  message: (
    <>
      <path d="M8 9h8" />
      <path d="M8 13h6" />
      <path d="M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12z" />
    </>
  ),
  edit: <path d="m15 4 5 5-11 11H4v-5L15 4Zm-3 3 5 5" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  mountain: (
    <>
      <path d="M3 20h18l-6.921 -14.612a2.3 2.3 0 0 0 -4.158 0l-6.921 14.612z" />
      <path d="M7.5 11l2 2.5l2.5 -2.5l2 3l2.5 -2" />
    </>
  ),
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
  chevron: <path d="m9 6 6 6-6 6" />,
  bell: (
    <>
      <path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2Z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
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

// Deterministic pine silhouette: tiers narrow towards the top, a short trunk below.
const pine = (x: number, base: number, h: number) => {
  const w = h * 0.55;
  const p = (dx: number, dy: number) => `${x + dx * w},${base - dy * h}`;
  return [
    p(0, 1),
    p(0.28, 0.66),
    p(0.16, 0.66),
    p(0.4, 0.36),
    p(0.24, 0.36),
    p(0.5, 0.08),
    p(0.05, 0.08),
    p(0.05, 0),
    p(-0.05, 0),
    p(-0.05, 0.08),
    p(-0.5, 0.08),
    p(-0.24, 0.36),
    p(-0.4, 0.36),
    p(-0.16, 0.66),
    p(-0.28, 0.66),
  ].join(" ");
};
const row = (
  from: number,
  to: number,
  step: number,
  base: number,
  min: number,
  spread: number,
) =>
  Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => {
    const jitter = ((i * 37) % 11) / 10;
    return pine(
      from + i * step + jitter * step * 0.4,
      base + ((i * 13) % 5) * 3,
      min + jitter * spread,
    );
  });
// Forest and an airborne enduro bike: the hero and sign-in backdrop.
export function TrailScene() {
  return (
    <svg
      className="trail-scene"
      viewBox="0 0 800 420"
      preserveAspectRatio="xMaxYMax meet"
      aria-hidden="true"
    >
      <circle cx="596" cy="214" r="86" fill="#4d4f35" opacity="0.55" />
      <circle cx="596" cy="214" r="62" fill="#5c5e40" opacity="0.5" />
      <path
        className="scene-far"
        d="M-760 420 L-760 374 C-500 362 -260 352 -40 336 C100 324 180 302 300 274 C380 256 420 262 470 240 S650 200 820 230 L820 420Z"
        fill="#34361f"
      />
      <g className="scene-far" fill="#4a4c33" opacity="0.75">
        {[
          ...row(-150, 250, 27, 334, 16, 18),
          ...row(250, 820, 21, 312, 34, 30),
        ].map((d, i) => (
          <polygon key={i} points={d} />
        ))}
      </g>
      <g fill="#202216">
        {[
          ...row(110, 330, 42, 366, 30, 26),
          ...row(330, 820, 34, 352, 62, 52),
        ].map((d, i) => (
          <polygon key={i} points={d} />
        ))}
      </g>
      <path
        d="M-760 420 L-760 400 C-450 396 -150 392 100 389 C260 387 400 377 470 352 L512 340 L520 350 C600 360 700 372 820 380 L820 420Z"
        fill="#17180f"
      />
      <path
        d="M470 352 L512 340"
        stroke="#c2541f"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <g className="scene-dust" fill="#a8a27e">
        <circle cx="522" cy="344" r="6" />
        <circle cx="510" cy="350" r="4" />
        <circle cx="530" cy="338" r="3" />
        <circle cx="500" cy="342" r="2.5" />
      </g>
      <g transform="translate(548 323) rotate(-14) scale(0.86)">
        <g className="scene-bike">
          <g
            fill="#111209"
            stroke="#111209"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="0" y1="0" x2="62" y2="-30" strokeWidth="7" />
            <polygon points="-22,-66 40,-80 40,-72 -10,-60" />
            <polygon points="28,-78 100,-88 126,-86 100,-40 70,-26 52,-60" />
            <rect x="62" y="-54" width="38" height="28" rx="4" />
            <path d="M84 -30 Q 44 -40 18 -64" fill="none" strokeWidth="7" />
            <line x1="128" y1="-90" x2="150" y2="-6" strokeWidth="8" />
            <line x1="120" y1="-106" x2="140" y2="-113" strokeWidth="5" />
            <polyline
              points="74,-24 96,-56 62,-86"
              fill="none"
              strokeWidth="14"
            />
            <line x1="62" y1="-86" x2="86" y2="-124" strokeWidth="19" />
            <polyline
              points="86,-122 112,-118 134,-108"
              fill="none"
              strokeWidth="10"
            />
            <circle cx="96" cy="-142" r="15" />
            <path d="M100 -155 L126 -152 L110 -143Z" />
          </g>
          <path
            d="M118 -60 Q 150 -74 184 -54 L180 -47 Q 150 -63 122 -51Z"
            fill="#c2541f"
          />
          <polygon points="116,-106 140,-102 146,-80 122,-84" fill="#c2541f" />
          <line
            x1="83"
            y1="-144"
            x2="107"
            y2="-142"
            stroke="#c2541f"
            strokeWidth="3"
          />
          {[0, 150].map((cx) => (
            <g key={cx} transform={`translate(${cx} ${cx ? -6 : 0})`}>
              <circle r="33" fill="none" stroke="#111209" strokeWidth="9" />
              <circle
                className="scene-spin"
                r="38"
                fill="none"
                stroke="#111209"
                strokeWidth="5"
                strokeDasharray="3 6"
              />
              <circle r="23" fill="none" stroke="#4a4c33" strokeWidth="2.5" />
              <circle r="5" fill="#4a4c33" />
            </g>
          ))}
        </g>
      </g>
      <g fill="#111209">
        {[pine(772, 424, 300), pine(818, 424, 250), pine(742, 424, 210)].map(
          (d, i) => (
            <polygon key={i} points={d} />
          ),
        )}
      </g>
    </svg>
  );
}
/** «Поделиться»: a /s/… link whose preview in messengers shows this object's title. */
export function ShareButton({
  path,
  title,
  className = "text-button",
}: {
  path: string;
  title: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/s/${path}`;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      // Closing the system share sheet is not an error; otherwise let the rider copy by hand.
      if ((e as Error).name !== "AbortError")
        window.prompt("Скопируйте ссылку", url);
    }
  };
  return (
    <button
      type="button"
      className={`share-button ${className}`}
      onClick={share}
    >
      <Icon name="share" size={16} />
      {copied ? "Ссылка скопирована" : "Поделиться"}
    </button>
  );
}
