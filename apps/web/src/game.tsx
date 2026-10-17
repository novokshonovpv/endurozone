import { useRef, useState } from "react";
import { Icon } from "./ui.tsx";
// «Moto Trials» — the owner's game (github.com/novokshonovpv/gggame on GitHub Pages), shown as is.
// Replaced «ГАЗГАЗ 67!» from 67moto.ru on 17.10.2026 at the owner's request.
// Turning the phone sideways hides our chrome (CSS); the button goes full screen and asks for landscape.
export const gameUrl = "https://novokshonovpv.github.io/gggame/";
export function Game() {
  const box = useRef<HTMLDivElement>(null),
    [hint, setHint] = useState("");
  async function fullscreen() {
    setHint("");
    try {
      await box.current?.requestFullscreen();
      // The Android app turns the screen sideways itself.
      if (navigator.userAgent.includes("EnduroZoneApp")) return;
      // Not every browser allows locking; a rotated phone works as well.
      await (
        screen.orientation as ScreenOrientation & {
          lock?: (o: string) => Promise<void>;
        }
      )
        .lock?.("landscape")
        .catch(() => setHint("Поверните телефон горизонтально."));
    } catch {
      setHint("Полный экран недоступен — поверните телефон горизонтально.");
    }
  }
  return (
    <>
      <div className="page-heading game-heading">
        <div>
          <p className="eyebrow">МИНИ-ИГРА</p>
          <h1>Moto Trials</h1>
          <p className="muted">
            Гонка на время против соперников: газ, тормоз и наклоны, чтобы не
            перевернуться. Лучше всего играть горизонтально.
          </p>
        </div>
        <button className="button" onClick={fullscreen}>
          <Icon name="game" />
          Играть на весь экран
        </button>
      </div>
      {hint && <p className="form-note card">{hint}</p>}
      <div className="game-frame" ref={box}>
        <iframe
          src={gameUrl}
          title="Мини-игра Moto Trials"
          allow="fullscreen; autoplay"
          allowFullScreen
        />
      </div>
    </>
  );
}
