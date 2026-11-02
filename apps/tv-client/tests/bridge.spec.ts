import { expect, test } from "@playwright/test";

test("real bridge persists SRAM and reports network failure without claiming success", async ({
  page,
  request,
}) => {
  // Only the engine is substituted. HTML, bridge, parent, API and SaveStore are real.
  await page.route("**/emulatorjs/data/loader.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
    const files = new Map();
    window.EJS_emulator = {
      config:{}, gamepad:{on(){}}, setupKeys(){}, on(){}, paused:false,
      pause(){this.paused=true}, play(){this.paused=false},
      gameManager: {
        functions:{simulateInput(){},getFrameNum(){return 0}},
        getSaveFile(){return new Uint8Array([83,70,67,66])},
        getSaveFilePath(){return '/data/saves/game.srm'},
        loadSaveFiles(){},
        FS:{ analyzePath(p){return {exists:files.has(p)}}, mkdir(p){files.set(p,true)}, writeFile(p,b){files.set(p,b)} }
      }
    };
    setTimeout(()=>{window.EJS_ready();window.EJS_onGameStart()},0);
  `,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir biblioteca" }).click();
  await page.getByRole("button", { name: /Synthetic fixture/ }).click();
  await page.getByRole("button", { name: "Jogar agora" }).click();
  await page.getByRole("button", { name: "Menu / Voltar" }).click();
  const save = page.getByRole("button", {
    name: "Salvar no servidor · slot 1",
  });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Progresso gravado no servidor.",
  );
  const catalog = await (await request.get("/api/games")).json();
  const url = `/api/games/${catalog.items[0].id}/saves/1`;
  const saved = await request.get(url);
  expect(saved.status()).toBe(200);
  expect([...(await saved.body())]).toEqual([83, 70, 67, 66]);
  await page.route("**/api/games/*/saves/1", (route) => route.abort());
  await save.click();
  await expect(page.getByRole("dialog").getByRole("status")).not.toHaveText(
    "Progresso gravado no servidor.",
  );
  await expect(save).toBeEnabled();
  expect([...(await (await request.get(url)).body())]).toEqual([
    83, 70, 67, 66,
  ]);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => !!document.activeElement?.closest('[role="dialog"]'),
    ),
  ).toBe(true);
});

test("benchmark bridge never reads or writes real progress and exports honest metrics", async ({
  page,
  request,
}) => {
  const catalog = await (await request.get("/api/games")).json();
  const gameId = catalog.items[0].id;
  const saveRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/saves/")) saveRequests.push(req.method());
  });
  await page.route("**/emulatorjs/data/loader.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
      window.EJS_emulator = {
        config:{}, gamepad:{on(){},terminate(){window.pollingStopped=true},updateGamepadState(){}},
        setupKeys(){},on(){},paused:false,
        gameManager:{functions:{simulateInput(){},getFrameNum(){return 0}}}
      };
      setTimeout(()=>{EJS_ready();EJS_onGameStart()},0);`,
    }),
  );
  await page.goto(
    `/player/?gameId=${gameId}&benchmark=1&diagnostics=1&region=ntsc`,
  );
  await page.waitForFunction("!!window.superFlipBenchmark");
  const report = await page.evaluate("window.superFlipBenchmark.report()");
  expect(report).toMatchObject({
    options: { nominalFps: 60.0988 },
    pureCoreFrameMs: { status: "unavailable" },
    presentedGameFrames: { status: "unavailable" },
    hardwareValidated: false,
  });
  expect(await page.evaluate("window.pollingStopped")).toBe(true);
  const error = await page.evaluate(
    (id) =>
      new Promise<string>((resolve) => {
        const listener = (event: MessageEvent) => {
          if (
            event.data.requestId === "forbidden-save" &&
            event.data.type === "error"
          ) {
            window.removeEventListener("message", listener);
            resolve(event.data.payload.message);
          }
        };
        window.addEventListener("message", listener);
        window.postMessage(
          {
            type: "save",
            requestId: "forbidden-save",
            gameId: id,
            payload: {},
          },
          location.origin,
        );
      }),
    gameId,
  );
  expect(error).toContain("alterações de progresso bloqueadas");
  expect(saveRequests).toEqual([]);
});
