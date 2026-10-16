import { useState, type ChangeEvent } from "react";
import {
  placeImportColumns,
  placeImportLimit,
  type PlaceImportResult,
  type PlaceImportRow,
} from "@enduro/contracts";
import { api } from "./api.ts";
import { ErrorBox, Icon, Modal } from "./ui.tsx";
// Moderators: many places at once from a spreadsheet saved as CSV (Excel «CSV UTF-8»).
// The file is read in the browser; the server checks every row again.
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  // Russian Excel separates with «;», others with «,».
  const sep =
    (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && source[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
const number = (s: string) => {
  const n = Number(s.trim().replace(",", "."));
  return s.trim() && Number.isFinite(n) ? n : null;
};
/** Rows by column names of the first line; unknown columns are ignored. */
export function rowsOf(table: string[][]) {
  const [head = [], ...body] = table;
  const index = Object.fromEntries(
    Object.entries(placeImportColumns).map(([field, names]) => [
      field,
      head.findIndex((h) => names.includes(h.trim().toLowerCase())),
    ]),
  ) as Record<keyof PlaceImportRow, number>;
  const missing = (["title", "latitude", "longitude"] as const).filter(
    (f) => index[f] < 0,
  );
  const rows = body.map((cells) => {
    const at = (f: keyof PlaceImportRow) =>
      index[f] >= 0 ? (cells[index[f]] ?? "").trim() : "";
    return {
      kind: at("kind"),
      title: at("title"),
      city: at("city"),
      latitude: number(at("latitude")),
      longitude: number(at("longitude")),
      difficulty: at("difficulty"),
      description: at("description"),
      accessNotes: at("accessNotes"),
      contacts: at("contacts"),
    } satisfies PlaceImportRow;
  });
  return { rows, missing };
}
export function PlaceImport({ done }: { done: () => void }) {
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState<PlaceImportRow[]>([]),
    [file, setFile] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<PlaceImportResult | null>(null);
  const reset = () => {
    setRows([]);
    setFile("");
    setError("");
    setResult(null);
  };
  const read = async (e: ChangeEvent<HTMLInputElement>) => {
    reset();
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f.name);
    const parsed = rowsOf(parseCsv(await f.text()));
    if (parsed.missing.length)
      return setError(
        "В первой строке нужны столбцы «Название», «Широта» и «Долгота». Возьмите за основу шаблон.",
      );
    if (!parsed.rows.length) return setError("В файле нет строк с местами.");
    if (parsed.rows.length > placeImportLimit)
      return setError(
        `За один раз — до ${placeImportLimit} мест. Разделите файл на части.`,
      );
    setRows(parsed.rows);
  };
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<PlaceImportResult>("/moderation/locations/import", {
        method: "POST",
        body: { items: rows },
      });
      setResult(r);
      setRows([]);
      if (r.added) done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="button outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Icon name="plus" />
        Загрузить таблицей
      </button>
      {open && (
        <Modal title="Места из таблицы" close={() => setOpen(false)}>
          <p className="muted">
            Заполните{" "}
            <a href="/places-template.csv" download>
              шаблон
            </a>{" "}
            в Excel или Google Таблицах и сохраните как «CSV UTF-8». Типы:
            место, прокат, гид, школа. Для мест укажите сложность: лёгкая,
            средняя или сложная. Координаты — как в Яндекс Картах, например
            54,78 и 32,04. Места сразу публикуются от вашего имени.
          </p>
          <label className="import-file">
            Файл CSV
            <input type="file" accept=".csv,text/csv" onChange={read} />
          </label>
          <ErrorBox message={error} />
          {rows.length > 0 && (
            <>
              <p>
                В файле «{file}» строк: <strong>{rows.length}</strong>. Первые:
              </p>
              <ul className="import-preview">
                {rows.slice(0, 5).map((r, i) => (
                  <li key={i}>
                    <strong>{r.title || "без названия"}</strong>
                    <small>
                      {[r.kind || "место", r.city, r.difficulty]
                        .filter(Boolean)
                        .join(" · ")}
                      {r.latitude === null || r.longitude === null
                        ? " · нет координат"
                        : ` · ${r.latitude}, ${r.longitude}`}
                    </small>
                  </li>
                ))}
              </ul>
              <button className="button" disabled={busy} onClick={send}>
                {busy ? "Загружаем…" : `Загрузить ${rows.length}`}
              </button>
            </>
          )}
          {result && (
            <div className="import-result">
              <p>
                Добавлено мест: <strong>{result.added}</strong>
                {result.skipped.length > 0 &&
                  `, пропущено: ${result.skipped.length}`}
                .
              </p>
              {result.skipped.length > 0 && (
                <ul>
                  {result.skipped.map((s) => (
                    <li key={s.row}>
                      Строка {s.row}
                      {s.title && ` («${s.title}»)`}: {s.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
