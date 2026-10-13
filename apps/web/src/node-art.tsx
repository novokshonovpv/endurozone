import type { ReactNode } from "react";
import type { PartNode } from "@enduro/contracts";
// Our own schematic drawings of motorcycle and engine nodes: simple line art in the site's style,
// not copies of anyone's parts diagrams. viewBox 0 0 120 90, stroke follows the text colour.
const art: Record<PartNode, ReactNode> = {
  // ---- motorcycle ----
  bodywork: (
    <>
      <path d="M18 62 C26 40 44 30 66 30 L94 30 C100 30 104 34 104 40 L104 48 L72 48 C60 48 52 54 48 62 Z" />
      <path d="M30 70 C38 64 50 62 62 64" />
      <path d="M74 36 h20 M74 42 h14" />
      <rect x="20" y="20" width="22" height="18" rx="3" />
      <text
        x="31"
        y="33"
        textAnchor="middle"
        fontSize="9"
        fill="currentColor"
        stroke="none"
      >
        67
      </text>
    </>
  ),
  frame: (
    <>
      <path d="M22 64 L46 30 L86 30 L98 58 L66 64 Z" />
      <path d="M46 30 L66 64 M86 30 L66 64" />
      <path d="M22 64 L14 74 M98 58 L108 66" />
      <circle cx="46" cy="30" r="3" />
      <circle cx="66" cy="64" r="3" />
    </>
  ),
  exhaust: (
    <>
      <path d="M14 30 C26 30 30 46 42 50 L64 54" />
      <rect x="62" y="44" width="40" height="20" rx="10" />
      <path d="M102 54 h8 M70 50 v8 M80 50 v8 M90 50 v8" />
    </>
  ),
  footpegs: (
    <>
      <rect x="24" y="30" width="40" height="10" rx="2" />
      <path d="M28 30 v-4 M36 30 v-4 M44 30 v-4 M52 30 v-4 M60 30 v-4" />
      <circle cx="68" cy="35" r="4" />
      <path d="M78 40 L96 74 M92 74 h10" />
      <circle cx="78" cy="40" r="3" />
    </>
  ),
  controls: (
    <>
      <path d="M14 26 C34 22 50 22 70 28" />
      <path d="M70 28 L74 22 L82 26" />
      <path d="M72 30 C80 46 70 56 82 70 L100 70" />
      <path d="M86 64 L104 58 L106 64 L92 70" />
      <circle cx="72" cy="30" r="3" />
    </>
  ),
  steering: (
    <>
      <rect x="22" y="22" width="76" height="12" rx="5" />
      <rect x="22" y="56" width="76" height="12" rx="5" />
      <path d="M60 34 V56" strokeWidth="5" />
      <circle cx="32" cy="28" r="4" />
      <circle cx="88" cy="28" r="4" />
      <circle cx="32" cy="62" r="4" />
      <circle cx="88" cy="62" r="4" />
    </>
  ),
  handlebar: (
    <>
      <path d="M12 40 C30 34 44 30 60 30 C76 30 90 34 108 40" />
      <rect x="10" y="38" width="16" height="8" rx="3" />
      <rect x="94" y="38" width="16" height="8" rx="3" />
      <path d="M90 34 L106 26 M30 34 L14 26" />
      <circle cx="74" cy="64" r="16" />
      <circle cx="74" cy="64" r="4" />
      <rect x="84" y="48" width="12" height="16" rx="3" />
    </>
  ),
  fork: (
    <>
      <rect x="36" y="10" width="12" height="44" rx="4" />
      <rect x="72" y="10" width="12" height="44" rx="4" />
      <rect x="34" y="50" width="16" height="28" rx="5" />
      <rect x="70" y="50" width="16" height="28" rx="5" />
      <path d="M30 20 h60" />
      <circle cx="42" cy="74" r="3" />
      <circle cx="78" cy="74" r="3" />
    </>
  ),
  shock: (
    <>
      <circle cx="60" cy="12" r="6" />
      <circle cx="60" cy="80" r="6" />
      <rect x="52" y="18" width="16" height="22" rx="3" />
      <path d="M44 42 L76 46 L44 50 L76 54 L44 58 L76 62 L44 66" />
      <path d="M60 40 V74" />
      <rect x="70" y="20" width="14" height="10" rx="3" />
    </>
  ),
  swingarm: (
    <>
      <path d="M16 40 L82 46 L82 56 L16 50 Z" />
      <circle cx="16" cy="45" r="5" />
      <circle cx="94" cy="51" r="16" strokeDasharray="4 3" />
      <circle cx="94" cy="51" r="5" />
      <circle cx="30" cy="70" r="8" strokeDasharray="3 2" />
      <path d="M30 62 L94 35 M30 78 L94 67" />
    </>
  ),
  wheel_front: (
    <>
      <circle cx="60" cy="45" r="36" />
      <circle cx="60" cy="45" r="30" />
      <circle cx="60" cy="45" r="5" />
      <circle cx="60" cy="45" r="14" strokeDasharray="6 4" />
      <path d="M60 15 V31 M60 59 V75 M30 45 H46 M74 45 H90 M39 24 L50 35 M70 55 L81 66 M81 24 L70 35 M50 55 L39 66" />
    </>
  ),
  wheel_rear: (
    <>
      <circle cx="60" cy="45" r="36" />
      <circle cx="60" cy="45" r="30" />
      <circle cx="60" cy="45" r="5" />
      <circle cx="60" cy="45" r="16" strokeDasharray="3 2" />
      <path d="M60 15 V29 M60 61 V75 M30 45 H44 M76 45 H90" />
    </>
  ),
  electrics: (
    <>
      <rect x="14" y="34" width="40" height="30" rx="3" />
      <path d="M22 34 v-6 h8 v6 M38 34 v-6 h8 v6 M24 48 h6 M40 48 h6 M43 45 v6" />
      <path d="M76 18 L66 46 H80 L70 74" />
      <circle cx="96" cy="36" r="12" />
      <path d="M90 36 h12 M96 30 v12" />
    </>
  ),
  tank_seat: (
    <>
      <path d="M16 52 C16 30 30 22 52 22 C66 22 72 30 72 40 L72 56 L22 60 Z" />
      <rect x="36" y="16" width="14" height="6" rx="2" />
      <path d="M72 46 C84 42 98 42 108 46 L106 54 L72 58" />
    </>
  ),
  // ---- engine ----
  head: (
    <>
      <rect x="20" y="40" width="80" height="34" rx="4" />
      <path d="M20 40 L30 24 H90 L100 40" />
      <circle cx="44" cy="30" r="6" />
      <circle cx="76" cy="30" r="6" />
      <path d="M44 50 V66 M76 50 V66 M38 66 h12 M70 66 h12" />
    </>
  ),
  cylinder: (
    <>
      <rect x="34" y="12" width="52" height="56" rx="3" />
      <path d="M26 20 h8 M26 30 h8 M26 40 h8 M86 20 h8 M86 30 h8 M86 40 h8" />
      <rect x="42" y="34" width="36" height="22" rx="2" />
      <path d="M42 40 h36 M42 45 h36 M60 56 V82" />
      <circle cx="60" cy="48" r="3" />
    </>
  ),
  crank: (
    <>
      <circle cx="60" cy="64" r="20" />
      <circle cx="60" cy="64" r="4" />
      <circle cx="66" cy="52" r="4" />
      <path d="M66 52 L54 14" strokeWidth="5" />
      <rect x="44" y="8" width="20" height="10" rx="3" />
      <path d="M14 64 H40 M80 64 H106" />
    </>
  ),
  clutch: (
    <>
      <circle cx="60" cy="45" r="34" />
      <circle cx="60" cy="45" r="26" />
      <circle cx="60" cy="45" r="18" />
      <circle cx="60" cy="45" r="6" />
      <circle cx="60" cy="27" r="3" />
      <circle cx="78" cy="45" r="3" />
      <circle cx="60" cy="63" r="3" />
      <circle cx="42" cy="45" r="3" />
    </>
  ),
  gearbox: (
    <>
      <circle cx="42" cy="46" r="22" strokeDasharray="5 3" />
      <circle cx="42" cy="46" r="17" />
      <circle cx="42" cy="46" r="4" />
      <circle cx="84" cy="40" r="16" strokeDasharray="4 3" />
      <circle cx="84" cy="40" r="12" />
      <circle cx="84" cy="40" r="3" />
      <path d="M12 46 H20 M100 40 H110" />
    </>
  ),
  ignition: (
    <>
      <circle cx="40" cy="48" r="26" />
      <circle cx="40" cy="48" r="8" />
      <path d="M40 22 V30 M40 66 V74 M14 48 H22 M58 48 H66 M22 30 L28 36 M52 60 L58 66 M58 30 L52 36 M28 60 L22 66" />
      <rect x="82" y="14" width="12" height="20" rx="3" />
      <path d="M84 34 h8 v18 h-8 Z M88 52 V62 M84 62 h8 M88 8 V14" />
    </>
  ),
  starter: (
    <>
      <rect x="14" y="34" width="46" height="26" rx="13" />
      <path d="M60 47 h14" />
      <circle cx="80" cy="47" r="6" strokeDasharray="3 2" />
      <path d="M28 34 V28 M44 34 V28" />
      <path d="M92 12 L84 50 L100 52" />
      <circle cx="84" cy="50" r="3" />
    </>
  ),
  intake: (
    <>
      <rect x="40" y="30" width="32" height="34" rx="4" />
      <path d="M16 40 H40 M16 54 H40 M72 44 H92 M72 52 H92" />
      <rect x="92" y="32" width="18" height="32" rx="6" />
      <path d="M48 64 V76 h16 V64" />
      <circle cx="56" cy="44" r="5" />
    </>
  ),
  lube: (
    <>
      <rect x="22" y="22" width="34" height="50" rx="8" />
      <path d="M22 34 H56 M22 60 H56 M30 40 v14 M38 40 v14 M46 40 v14" />
      <path d="M86 24 C86 24 72 44 72 54 A14 14 0 0 0 100 54 C100 44 86 24 86 24 Z" />
    </>
  ),
  cooling: (
    <>
      <rect x="20" y="16" width="64" height="58" rx="3" />
      <path d="M28 24 V66 M36 24 V66 M44 24 V66 M52 24 V66 M60 24 V66 M68 24 V66 M76 24 V66" />
      <path d="M84 26 C98 26 98 40 108 40 M84 62 C98 62 98 50 108 50" />
      <circle cx="92" cy="12" r="4" />
    </>
  ),
  covers: (
    <>
      <path d="M18 30 C18 18 34 12 50 16 L80 22 C100 26 106 40 102 56 C98 70 82 78 60 76 L30 72 C20 70 18 62 18 54 Z" />
      <circle cx="30" cy="24" r="2.5" />
      <circle cx="92" cy="34" r="2.5" />
      <circle cx="94" cy="62" r="2.5" />
      <circle cx="28" cy="66" r="2.5" />
      <circle cx="60" cy="46" r="12" />
      <circle cx="60" cy="46" r="4" />
    </>
  ),
};
export function NodeArt({
  node,
  size = 96,
}: {
  node: PartNode;
  size?: number;
}) {
  return (
    <svg
      className="node-art"
      viewBox="0 0 120 90"
      width={size}
      height={(size * 3) / 4}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {art[node]}
    </svg>
  );
}
