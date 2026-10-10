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
        d="M180 330 C300 250 380 280 470 240 S650 200 820 230 L820 420 L180 420Z"
        fill="#34361f"
      />
      <g className="scene-far" fill="#4a4c33" opacity="0.75">
        {row(250, 820, 21, 312, 34, 30).map((d, i) => (
          <polygon key={i} points={d} />
        ))}
      </g>
      <g fill="#202216">
        {row(330, 820, 34, 352, 62, 52).map((d, i) => (
          <polygon key={i} points={d} />
        ))}
      </g>
      <path
        d="M260 420 L260 382 C360 378 430 372 470 352 L512 340 L520 350 C600 360 700 372 820 380 L820 420Z"
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
