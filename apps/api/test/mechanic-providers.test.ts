import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import { openDatabase } from "../src/database.ts";
import { createMechanicResponder } from "../src/mechanic.ts";
// Provider clients are exercised against a fake fetch: request shape, parsing and failures.
// Real provider calls need keys and are verified separately on the server.
describe("AI mechanic providers", () => {
  it("calls YandexGPT with a service-account key, folder and model URI, accepting only final answers", async () => {
    assert.equal(createMechanicResponder({ YANDEX_API_KEY: "k" }), undefined);
    let url = "",
      headers: Record<string, string> = {},
      body: Record<string, any> = {};
    const ok = (status: string, text = "Ответ Яндекса") =>
      new Response(
        JSON.stringify({
          result: {
            alternatives: [{ status, message: { role: "assistant", text } }],
          },
        }),
        { status: 200 },
      );
    const fake = (async (u, options) => {
      url = String(u);
      headers = options!.headers as Record<string, string>;
      body = JSON.parse(options!.body as string);
      return ok("ALTERNATIVE_STATUS_FINAL");
    }) as typeof fetch;
    const responder = createMechanicResponder(
      { YANDEX_API_KEY: "test-key", YANDEX_FOLDER_ID: "b1folder" },
      fake,
    )!;
    assert.equal(responder.provider, "yandex");
    assert.equal(await responder("Вопрос", null), "Ответ Яндекса");
    assert.equal(
      url,
      "https://llm.api.cloud.yandex.net/foundationModels/v1/completion",
    );
    assert.equal(headers.Authorization, "Api-Key test-key");
    assert.equal(headers["x-folder-id"], "b1folder");
    assert.equal(body.modelUri, "gpt://b1folder/yandexgpt-lite/latest");
    assert.equal(body.completionOptions.maxTokens, "1200");
    assert.deepEqual(
      body.messages.map((m: { role: string }) => m.role),
      ["system", "user"],
    );
    assert.deepEqual(JSON.parse(body.messages[1].text), {
      question: "Вопрос",
      bike: null,
    });
    const pinned = createMechanicResponder(
      {
        YANDEX_API_KEY: "k",
        YANDEX_FOLDER_ID: "f",
        YANDEX_MODEL: "gpt://other/yandexgpt/rc",
      },
      fake,
    )!;
    await pinned("Вопрос", null);
    assert.equal(body.modelUri, "gpt://other/yandexgpt/rc");
    for (const response of [
      new Response("denied", { status: 403 }),
      ok("ALTERNATIVE_STATUS_TRUNCATED_FINAL"),
      ok("ALTERNATIVE_STATUS_CONTENT_FILTER"),
      ok("ALTERNATIVE_STATUS_FINAL", "   "),
    ]) {
      const respond = createMechanicResponder(
        { YANDEX_API_KEY: "k", YANDEX_FOLDER_ID: "f" },
        (async () => response) as typeof fetch,
      )!;
      await assert.rejects(respond("question", null));
    }
  });
  it("calls GigaChat with a cached OAuth token, refreshes it after 401 and accepts only complete answers", async () => {
    const calls: {
      url: string;
      headers: Record<string, string>;
      body: string;
    }[] = [];
    let tokens = 0,
      reject401 = false;
    const answer = (finish: string, content = "Ответ GigaChat") =>
      new Response(
        JSON.stringify({
          choices: [
            { finish_reason: finish, message: { role: "assistant", content } },
          ],
        }),
        { status: 200 },
      );
    const fake = (async (u, options) => {
      const call = {
        url: String(u),
        headers: options!.headers as Record<string, string>,
        body: String(options!.body),
      };
      calls.push(call);
      if (call.url.endsWith("/api/v2/oauth")) {
        tokens++;
        return new Response(
          JSON.stringify({
            access_token: `token-${tokens}`,
            expires_at: Date.now() + 30 * 60_000,
          }),
          { status: 200 },
        );
      }
      if (reject401) {
        reject401 = false;
        return new Response("expired", { status: 401 });
      }
      return answer("stop");
    }) as typeof fetch;
    const responder = createMechanicResponder(
      { GIGACHAT_AUTH_KEY: "base64-key" },
      fake,
    )!;
    assert.equal(responder.provider, "gigachat");
    assert.equal(await responder("Вопрос", null), "Ответ GigaChat");
    await responder("Ещё вопрос", null);
    assert.equal(tokens, 1, "token is reused while valid");
    const [oauth, chat] = calls;
    assert.equal(oauth.url, "https://ngw.devices.sberbank.ru:9443/api/v2/oauth");
    assert.equal(oauth.headers.Authorization, "Basic base64-key");
    assert.match(oauth.headers.RqUID, /^[0-9a-f-]{36}$/);
    assert.equal(oauth.body, "scope=GIGACHAT_API_PERS");
    assert.equal(
      chat.url,
      "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
    );
    assert.equal(chat.headers.Authorization, "Bearer token-1");
    const sent = JSON.parse(chat.body);
    assert.equal(sent.model, "GigaChat");
    assert.equal(sent.max_tokens, 1200);
    assert.equal(sent.messages[0].role, "system");
    assert.deepEqual(JSON.parse(sent.messages[1].content), {
      question: "Вопрос",
      bike: null,
    });
    reject401 = true;
    await assert.rejects(responder("Вопрос", null));
    await responder("Вопрос", null);
    assert.equal(tokens, 2, "a rejected token is replaced on the next question");
    for (const response of [
      answer("length"),
      answer("blacklist"),
      answer("stop", ""),
    ]) {
      const respond = createMechanicResponder(
        {
          GIGACHAT_AUTH_KEY: "k",
          GIGACHAT_SCOPE: "GIGACHAT_API_CORP",
          GIGACHAT_MODEL: "GigaChat-Pro",
        },
        (async (u) =>
          String(u).endsWith("/oauth")
            ? new Response(
                JSON.stringify({
                  access_token: "t",
                  expires_at: Date.now() + 600_000,
                }),
              )
            : response) as typeof fetch,
      )!;
      await assert.rejects(respond("question", null));
    }
  });
  it("selects the provider explicitly or by the first complete configuration and reports it", async () => {
    const all = {
      OPENAI_API_KEY: "o",
      OPENAI_MODEL: "m",
      YANDEX_API_KEY: "y",
      YANDEX_FOLDER_ID: "f",
      GIGACHAT_AUTH_KEY: "g",
    };
    assert.equal(createMechanicResponder(all)!.provider, "openai");
    assert.equal(
      createMechanicResponder({ ...all, MECHANIC_PROVIDER: "yandex" })!.provider,
      "yandex",
    );
    assert.equal(
      createMechanicResponder({ ...all, MECHANIC_PROVIDER: "gigachat" })!
        .provider,
      "gigachat",
    );
    assert.equal(
      createMechanicResponder({
        YANDEX_API_KEY: "y",
        YANDEX_FOLDER_ID: "f",
        GIGACHAT_AUTH_KEY: "g",
      })!.provider,
      "yandex",
    );
    assert.equal(
      createMechanicResponder({
        MECHANIC_PROVIDER: "gigachat",
        OPENAI_API_KEY: "o",
        OPENAI_MODEL: "m",
      }),
      undefined,
    );
    assert.equal(
      createMechanicResponder({ ...all, MECHANIC_PROVIDER: "unknown" }),
      undefined,
    );
    const dir = await mkdtemp(join(tmpdir(), "enduro-mechanic-status-"));
    const db = await openDatabase({
      url: process.env.TEST_DATABASE_URL,
      dataDir: dir,
    });
    try {
      for (const [responder, provider] of [
        [createMechanicResponder({ GIGACHAT_AUTH_KEY: "g" }), "gigachat"],
        [undefined, null],
      ] as const) {
        const app = await buildApp({ db, mechanicResponder: responder });
        const status = (
          await app.inject({ method: "GET", url: "/api/mechanic" })
        ).json();
        assert.deepEqual(status, {
          available: Boolean(responder),
          dailyLimit: 10,
          provider,
        });
        await app.close();
      }
    } finally {
      await db.close();
      assert.ok(dir.startsWith(join(tmpdir(), "enduro-mechanic-status-")));
      await rm(dir, { recursive: true, force: true });
    }
  });
});
