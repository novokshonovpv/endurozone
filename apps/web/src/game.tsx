import { useRef, useState } from "react";
import { Icon } from "./ui.tsx";
// «ГАЗГАЗ 67!» — the owner's game from 67moto.ru, shown as is (scores stay in the 67МОТО table).
// Turning the phone sideways hides our chrome (CSS); the button goes full screen and asks for landscape.
export const gameUrl = "https://67moto.ru/game.html";
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
          <p className="eyebrow">МИНИ-ИГРА 67МОТО</p>
          <h1>ГАЗГАЗ 67!</h1>
          <p className="muted">
            Заезд по смоленским трассам. Лучше всего играть горизонтально.
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
          title="Мини-игра ГАЗГАЗ 67!"
          allow="fullscreen; autoplay"
          allowFullScreen
        />
      </div>
    </>
  );
}
