import type { FastifyInstance, FastifyRequest } from "fastify";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  engineNodes,
  motoNodes,
  nodeLabel,
  partResponses,
  partSchemas,
  responses,
  type ModelDetail,
  type PartEngine,
  type PartFit,
  type PartFitInput,
  type PartItem,
  type PartNode,
  type PartNodeSummary,
  type PartScope,
  type PassportLine,
} from "@enduro/contracts";
import type { Database, Queryable, Row } from "./database.ts";
import { profileOf } from "./auth.ts";
import { allModels, catalogModel, summaryOf } from "./models.ts";
import { blockedBetween } from "./blocks.ts";

// Passport: sizes and codes picked from the seller's specs, each placed on its node.
// Order matters: the first matching row wins its line; noisy rows (wheelbase, "transparent tank") never match.
const passportRules: [string, PartScope, PartNode, RegExp][] = [
  [
    "Передняя шина",
    "moto",
    "wheel_front",
    /^(покрышка передняя|передняя покрышка|переднее колесо|колесо переднее|передняя шина)$/,
  ],
  [
    "Задняя шина",
    "moto",
    "wheel_rear",
    /^(покрышка задняя|задняя покрышка|заднее колесо|колесо заднее|задняя шина)$/,
  ],
  [
    "Колёса",
    "moto",
    "wheel_front",
    /^(шины|размер колес|размер колеса|колеса|диаметр колес \(дюймы\)|диаметр покрышек и дисков)$/,
  ],
  ["Цепь", "moto", "swingarm", /^(цепь|шаг цепи)$/],
  ["Звёзды", "moto", "swingarm", /звезд/],
  [
    "Передний тормоз",
    "moto",
    "handlebar",
    /^(передний тормоз|передние тормоза|диаметр переднего тормозного диска)$/,
  ],
  [
    "Задний тормоз",
    "moto",
    "controls",
    /^(задний тормоз|задние тормоза|диаметр заднего тормозного диска)$/,
  ],
  [
    "Тормоза",
    "moto",
    "handlebar",
    /^(тормоза|тормозная система|тормоза передние\/задние|тормоза \((передние\/задние|передний\/задний)\)|передний\/задний тормоза)$/,
  ],
  [
    "Передняя вилка",
    "moto",
    "fork",
    /^(передняя подвеска|вилка|передняя вилка)/,
  ],
  [
    "Задний амортизатор",
    "moto",
    "shock",
    /^(задний амортизатор|задняя подвеска)/,
  ],
  ["Аккумулятор", "moto", "electrics", /^(аккумулятор|акб)/],
  [
    "Топливный бак",
    "moto",
    "tank_seat",
    /^(топливный бак|емкость бака|объем бака|объем топливного бака|объем бензобака|объём бензобака|емкость топливного бака|бак)/,
  ],
  [
    "Двигатель",
    "engine",
    "covers",
    /^(модель двигателя|маркировка двигателя( мотоцикла)?|двигатель:?|мотор)$/,
  ],
  ["Свеча зажигания", "engine", "ignition", /свеч/],
  ["Масло в двигателе", "engine", "lube", /^объем масла/],
  [
    "Охлаждение",
    "engine",
    "cooling",
    /^(охлаждение|охлаждение двигателя|система охлаждения)$/,
  ],
  ["Сцепление", "engine", "clutch", /^сцепление$/],
  [
    "Коробка передач",
    "engine",
    "gearbox",
    /^(коробка передач|кпп|трансмиссия)$/,
  ],
  [
    "Карбюратор / питание",
    "engine",
    "intake",
    /^(карбюратор|система питания|питание|инжектор)$/,
  ],
];
const key = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
type Line = PassportLine & { scope: PartScope; node: PartNode };
function passportOf(m: ModelDetail): Line[] {
  const lines = new Map<string, Line>();
  for (const [label, scope, node, rule] of passportRules)
    for (const [k, value] of m.specs) {
      if (!rule.test(key(k)) || !value || value === "-") continue;
      const prev = lines.get(label);
      // "Цепь 520" and "Шаг цепи 520 / 116 зв" join into one line; other lines keep the first value.
      if (!prev) lines.set(label, { label, value, scope, node });
      else if (label === "Цепь" && !prev.value.includes(value))
        prev.value = `${prev.value}, ${value}`;
    }
  // Front and rear tyres make the generic "wheels" line redundant; so do separate brakes.
  if (lines.has("Передняя шина") || lines.has("Задняя шина"))
    lines.delete("Колёса");
  if (lines.has("Передний тормоз") || lines.has("Задний тормоз"))
    lines.delete("Тормоза");
  return [...lines.values()];
}

// Engine: one code shared by many models (ZS174MN-3, TYX300, 172FMM…), taken from the engine model rows.
const engineRows =
  /^(модель двигателя|маркировка двигателя( мотоцикла)?|двигатель:?|мотор)$/;
const codePattern =
  /\b(\d?P\d{2}FM[A-Z]{1,2}|[A-Z]{2}\d[A-Z]\d{2}[A-Z]{2}|\d{3}F?M[A-Z]{1,3}(?:-\d+[A-Z]?)?|[A-Z]{1,5}\d{2,4}[A-Z]{0,4}\d?(?:-\d+[A-Z]?)?)\b/;
function engineOf(m: ModelDetail): { key: string; label: string } | null {
  for (const [k, value] of m.specs) {
    if (!engineRows.test(key(k))) continue;
    const latin = value
      .toUpperCase()
      .replace(/[А-ЯЁ]/g, " ")
      // "ZS 177 MM", "YBS 300" → "ZS177MM", "YBS300"
      .replace(/\b([A-Z]{2,5})\s+(\d{2,4})\b/g, "$1$2")
      .replace(/(\d{3})\s+(F?M[A-Z]{1,2})\b/g, "$1$2");
    const code = codePattern.exec(latin)?.[1];
    // Bare sizes or tact counts are not engine codes; Zongshen's "ZS" prefix names the same engine.
    if (code && /[A-Z]/.test(code) && !/^\d+$/.test(code)) {
      const normal = code.replace(/^ZS(?=\d)/, "");
      return { key: normal, label: value.length > 60 ? normal : value };
    }
  }
  return null;
}
const engines = new Map<string, string[]>();
for (const m of allModels) {
  const e = engineOf(m);
  if (e) engines.set(e.key, [...(engines.get(e.key) ?? []), m.slug]);
}
function engineInfo(m: ModelDetail): PartEngine | null {
  const e = engineOf(m);
  return e ? { ...e, models: (engines.get(e.key) ?? []).length - 1 } : null;
}

// Supplier part tables (scripts/import-parts.mjs). Empty until a catalogue is connected.
const partsFile = new URL("../data/parts.json", import.meta.url);
const tables = new Map<string, PartItem[]>();
if (existsSync(partsFile)) {
  const data = JSON.parse(readFileSync(partsFile, "utf8")) as {
    items: (PartItem & { scope: PartScope; key: string; node: PartNode })[];
  };
  for (const { scope, key: k, node, ...item } of data.items) {
    const id = `${scope}|${k}|${node}`;
    tables.set(id, [...(tables.get(id) ?? []), item]);
  }
}
const tableOf = (scope: PartScope, scopeKey: string, node: string) =>
  tables.get(`${scope}|${scopeKey}|${node}`) ?? [];

export function partRoutes(
  app: FastifyInstance,
  db: Database,
  guards: {
    requireWrite: (req: FastifyRequest) => { user: Row };
    notFound: () => Error;
    HttpError: new (status: number, code: string, message: string) => Error;
  },
) {
  const { requireWrite, notFound, HttpError } = guards;
  const tags = ["Parts"],
    security = [{ cookieSession: [] }];
  const errors = {
    400: responses.error,
    401: responses.error,
    403: responses.error,
    404: responses.error,
    409: responses.error,
    429: responses.error,
  };
  function modelOr404(slug: string) {
    const m = catalogModel(slug);
    if (!m) throw notFound();
    return m;
  }
  // Moto fits belong to the model; engine fits are shared by every model with the same engine.
  function scopeKey(m: ModelDetail, scope: PartScope) {
    if (scope === "moto") return m.slug;
    const e = engineOf(m);
    if (!e) throw notFound();
    return e.key;
  }
  const ownerSlugs = (m: ModelDetail, scope: PartScope) =>
    scope === "moto" ? [m.slug] : (engines.get(engineOf(m)?.key ?? "") ?? []);
  async function owns(
    q: Queryable,
    viewer: string | null,
    m: ModelDetail,
    scope: PartScope,
  ) {
    if (!viewer) return false;
    const [r] = await q.query(
      "SELECT 1 FROM bikes WHERE owner_id=$1 AND catalog_slug=ANY($2::text[]) LIMIT 1",
      [viewer, ownerSlugs(m, scope)],
    );
    return Boolean(r);
  }
  async function fitCounts(scope: PartScope, scopeKeyValue: string) {
    const rows = await db.query(
      "SELECT node,count(*) n FROM part_fits WHERE scope=$1 AND scope_key=$2 GROUP BY node",
      [scope, scopeKeyValue],
    );
    return new Map(rows.map((r) => [r.node as string, Number(r.n)]));
  }
  app.get<{ Params: { slug: string } }>(
    "/api/parts/:slug",
    {
      schema: {
        tags,
        params: partSchemas.model,
        response: { 200: partResponses.overview, ...errors },
      },
    },
    async (req) => {
      const m = modelOr404(req.params.slug);
      const passport = passportOf(m),
        engine = engineInfo(m);
      const moto = await fitCounts("moto", m.slug);
      const eng = engine
        ? await fitCounts("engine", engine.key)
        : new Map<string, number>();
      const summary = (
        scope: PartScope,
        id: PartNode,
        counts: Map<string, number>,
        scopeKeyValue: string,
      ): PartNodeSummary => ({
        id,
        label: nodeLabel(scope, id),
        passport: passport.filter((l) => l.scope === scope && l.node === id)
          .length,
        items: tableOf(scope, scopeKeyValue, id).length,
        fits: counts.get(id) ?? 0,
      });
      return {
        model: summaryOf(m),
        engine,
        moto: (Object.keys(motoNodes) as PartNode[]).map((id) =>
          summary("moto", id, moto, m.slug),
        ),
        engineNodes: engine
          ? (Object.keys(engineNodes) as PartNode[]).map((id) =>
              summary("engine", id, eng, engine.key),
            )
          : [],
        viewerOwns: await owns(db, req.authContext?.user.id ?? null, m, "moto"),
      };
    },
  );
  async function fitsOf(
    scope: PartScope,
    scopeKeyValue: string,
    node: string,
    viewer: string | null,
  ): Promise<PartFit[]> {
    // Riders in a block with the viewer are left out, as everywhere else.
    const rows = await db.query(
      `SELECT f.*,u.handle,u.display_name,u.city,u.level,u.bio,
        (SELECT count(*) FROM part_fit_votes v WHERE v.fit_id=f.id) AS votes,
        EXISTS(SELECT 1 FROM part_fit_votes v WHERE v.fit_id=f.id AND v.user_id=$4::uuid) AS voted
       FROM part_fits f JOIN users u ON u.id=f.author_id
       WHERE f.scope=$1 AND f.scope_key=$2 AND f.node=$3 AND NOT ${blockedBetween("$4::uuid", "f.author_id")}
       ORDER BY votes DESC,f.created_at DESC LIMIT 100`,
      [scope, scopeKeyValue, node, viewer],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      partNumber: r.part_number,
      comment: r.comment,
      author: profileOf({ ...r, id: r.author_id }),
      createdAt: new Date(r.created_at).toISOString(),
      votes: Number(r.votes),
      viewerVoted: Boolean(r.voted),
      viewerIsAuthor: r.author_id === viewer,
    }));
  }
  const nodeKnown = (scope: PartScope, node: string) =>
    node in (scope === "moto" ? motoNodes : engineNodes);
  app.get<{ Params: { slug: string; scope: PartScope; node: PartNode } }>(
    "/api/parts/:slug/:scope/:node",
    {
      schema: {
        tags,
        params: partSchemas.node,
        response: { 200: partResponses.node, ...errors },
      },
    },
    async (req) => {
      const { slug, scope, node } = req.params;
      const m = modelOr404(slug);
      if (!nodeKnown(scope, node)) throw notFound();
      const k = scopeKey(m, scope),
        viewer = req.authContext?.user.id ?? null;
      return {
        scope,
        node,
        label: nodeLabel(scope, node),
        passport: passportOf(m)
          .filter((l) => l.scope === scope && l.node === node)
          .map(({ label, value }) => ({ label, value })),
        items: tableOf(scope, k, node),
        fits: await fitsOf(scope, k, node, viewer),
        viewerOwns: await owns(db, viewer, m, scope),
        engine: engineInfo(m),
      };
    },
  );
  const config = { rateLimit: { max: 20, timeWindow: "1 minute" } };
  const noLinks = (...values: string[]) => {
    // Owners share experience here, not shop links or ads.
    if (
      values.some((v) =>
        /https?:\/\/|www\.|\.(ru|com|net|рф)(\/|\s|$)/i.test(v),
      )
    )
      throw new HttpError(
        400,
        "LINKS_NOT_ALLOWED",
        "Без ссылок: укажите название и артикул детали.",
      );
  };
  app.post<{
    Params: { slug: string; scope: PartScope; node: PartNode };
    Body: PartFitInput;
  }>(
    "/api/parts/:slug/:scope/:node/fits",
    {
      config,
      schema: {
        tags,
        security,
        params: partSchemas.node,
        body: partSchemas.fit,
        response: { 201: partResponses.fit, ...errors },
      },
    },
    async (req, reply) => {
      const me = requireWrite(req).user;
      const { slug, scope, node } = req.params;
      const m = modelOr404(slug);
      if (!nodeKnown(scope, node)) throw notFound();
      const name = req.body.name.trim(),
        partNumber = req.body.partNumber.trim(),
        comment = req.body.comment.trim();
      if (name.length < 2)
        throw new HttpError(
          400,
          "VALIDATION_ERROR",
          "Укажите название детали.",
        );
      noLinks(name, partNumber, comment);
      const k = scopeKey(m, scope);
      return db.transaction(async (tx) => {
        if (!(await owns(tx, me.id, m, scope)))
          throw new HttpError(
            403,
            "OWNER_REQUIRED",
            scope === "moto"
              ? "Добавлять могут владельцы этой модели: привяжите свой мотоцикл к модели в гараже."
              : "Добавлять могут владельцы мотоциклов с этим двигателем: привяжите свой мотоцикл к модели в гараже.",
          );
        const [n] = await tx.query(
          "SELECT count(*) n FROM part_fits WHERE author_id=$1 AND scope=$2 AND scope_key=$3",
          [me.id, scope, k],
        );
        if (Number(n.n) >= 50)
          throw new HttpError(
            409,
            "FIT_LIMIT",
            "Не больше 50 записей на одну модель или двигатель.",
          );
        const id = randomUUID();
        const [r] = await tx.query(
          "INSERT INTO part_fits(id,scope,scope_key,node,author_id,name,part_number,comment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING created_at",
          [id, scope, k, node, me.id, name, partNumber, comment],
        );
        reply.code(201);
        return {
          id,
          name,
          partNumber,
          comment,
          author: profileOf(me),
          createdAt: new Date(r.created_at).toISOString(),
          votes: 0,
          viewerVoted: false,
          viewerIsAuthor: true,
        };
      });
    },
  );
  async function fitOr404(id: string) {
    const [f] = await db.query("SELECT * FROM part_fits WHERE id=$1", [id]);
    if (!f) throw notFound();
    return f;
  }
  // The author removes own entry; a moderator removes spam, with a journal line.
  app.delete<{ Params: { id: string } }>(
    "/api/part-fits/:id",
    {
      config,
      schema: { tags, security, params: partSchemas.id, response: errors },
    },
    async (req, reply) => {
      const me = requireWrite(req).user;
      const f = await fitOr404(req.params.id);
      if (f.author_id !== me.id && me.role !== "moderator") throw notFound();
      await db.transaction(async (tx) => {
        await tx.query("DELETE FROM part_fits WHERE id=$1", [f.id]);
        if (f.author_id !== me.id)
          await tx.query(
            "INSERT INTO moderation_actions(id,actor_id,target_type,target_id,action,reason) VALUES ($1,$2,'part_fit',$3,'delete','Запись о запчасти удалена модератором')",
            [randomUUID(), me.id, f.id],
          );
      });
      return reply.code(204).send();
    },
  );
  // «Подошло и мне»: only other owners of the model (or of the engine) confirm.
  for (const method of ["PUT", "DELETE"] as const)
    app.route<{ Params: { id: string } }>({
      method,
      url: "/api/part-fits/:id/vote",
      config,
      schema: { tags, security, params: partSchemas.id, response: errors },
      handler: async (req, reply) => {
        const me = requireWrite(req).user;
        const f = await fitOr404(req.params.id);
        if (method === "DELETE") {
          await db.query(
            "DELETE FROM part_fit_votes WHERE fit_id=$1 AND user_id=$2",
            [f.id, me.id],
          );
          return reply.code(204).send();
        }
        if (f.author_id === me.id)
          throw new HttpError(
            400,
            "OWN_FIT",
            "Свою запись подтверждать не нужно.",
          );
        const slugs =
          f.scope === "moto" ? [f.scope_key] : (engines.get(f.scope_key) ?? []);
        const [owner] = await db.query(
          "SELECT 1 FROM bikes WHERE owner_id=$1 AND catalog_slug=ANY($2::text[]) LIMIT 1",
          [me.id, slugs],
        );
        if (!owner)
          throw new HttpError(
            403,
            "OWNER_REQUIRED",
            "Подтверждать могут владельцы этой модели или двигателя.",
          );
        await db.query(
          "INSERT INTO part_fit_votes(fit_id,user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [f.id, me.id],
        );
        return reply.code(204).send();
      },
    });
}
