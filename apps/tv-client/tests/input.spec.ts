import { expect, test, type Page } from "@playwright/test";

async function openGame(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir biblioteca" }).click();
  await page.getByRole("button", { name: /Synthetic fixture/ }).click();
  await page.getByRole("button", { name: "Jogar agora" }).click();
}

test("production runtime loads without source fallback and accepts a sparse gamepad", async ({
  page,
}) => {
  const failures: string[] = [],
    sources: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/src/")) sources.push(request.url());
  });
  await page.addInitScript(() => {
    const pad = {
      id: "fixture-pad",
      index: 1,
      connected: true,
      mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(window, "runtimePad", { value: pad });
    Object.defineProperty(navigator, "getGamepads", {
      value: () =>
        pad.connected
          ? Array.from({ length: pad.index + 1 }, (_, i) =>
              i === pad.index ? pad : null,
            )
          : [],
    });
  });
  await openGame(page);
  const player = page.frameLocator("iframe");
  await expect(
    player.getByRole("button", { name: "Iniciar jogo" }),
  ).toBeVisible();
  const frame = page.frames().find((f) => f.url().includes("/player/"))!;
  expect(
    await frame.evaluate("typeof EJS_emulator.config.superFlip.allowInput"),
  ).toBe("function");
  expect(await frame.evaluate("EJS_emulator.gamepad.gamepads[0].index")).toBe(
    1,
  );
  expect(sources).toEqual([]);
  expect(
    await frame.evaluate(`(() => {
    for(let i=0;i<20;i++) {
      runtimePad.connected=false; EJS_emulator.gamepad.updateGamepadState();
      runtimePad.index=1+i%2; runtimePad.connected=true; EJS_emulator.gamepad.updateGamepadState();
    }
    return EJS_emulator.gamepad.gamepads.map(p=>p.index);
  })()`),
  ).toEqual([2]);
  expect(failures).toEqual([]);
});

test("UI waits for correlated pause/resume acknowledgments and ignores stale replies", async ({
  page,
}) => {
  await page.route("**/player/?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>
    const gameId=new URLSearchParams(location.search).get('gameId');
    window.commands=[];
    window.reply=(type,requestId)=>parent.postMessage({type,gameId,requestId,payload:{}},location.origin);
    addEventListener('message',e=>commands.push(e.data));
    reply('started','event');
  </script>`,
    }),
  );
  await openGame(page);
  await page.getByRole("button", { name: "Menu / Voltar" }).click();
  const frame = page.frames().find((f) => f.url().includes("/player/"))!;
  const save = page.getByRole("button", {
    name: "Salvar no servidor · slot 1",
  });
  await expect(save).toBeDisabled();
  await frame.evaluate("reply('paused','stale')");
  await expect(save).toBeDisabled();
  await expect.poll(() => frame.evaluate("commands.length")).toBe(1);
  await frame.evaluate("reply('paused',commands[0].requestId)");
  await expect(save).toBeEnabled();
  await page.getByRole("button", { name: "Continuar jogo" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => frame.evaluate("commands.length")).toBe(2);
  await frame.evaluate("reply('resumed',commands[0].requestId)");
  await expect(page.getByRole("dialog")).toBeVisible();
  await frame.evaluate("reply('resumed',commands[1].requestId)");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await frame.evaluate(
    "parent.postMessage({type:'error',gameId,requestId:'event',payload:{message:'Falha específica da engine',fatal:true}},location.origin)",
  );
  await expect.poll(() => frame.evaluate("commands.length")).toBe(3);
  await frame.evaluate("reply('paused',commands[2].requestId)");
  await expect(page.getByRole("dialog").getByRole("status")).toHaveText(
    "Falha específica da engine",
  );
});

test("held A cannot click through a gameplay/menu transition", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const pad = {
      id: "test",
      index: 2,
      connected: true,
      mapping: "standard",
      axes: [0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(window, "testPad", { value: pad });
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [null, null, pad],
    });
  });
  await page.route("**/player/?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>
    const gameId=new URLSearchParams(location.search).get('gameId');
    parent.postMessage({type:'started',gameId,requestId:'event',payload:{}},location.origin);
    addEventListener('message',e=>{if(e.data.type==='pause')parent.postMessage({type:'paused',gameId,requestId:e.data.requestId,payload:{}},location.origin)});
  </script>`,
    }),
  );
  await openGame(page);
  await page.evaluate("testPad.buttons[0].pressed=true");
  await page.getByRole("button", { name: "Menu / Voltar" }).click();
  const dialog = page.getByRole("dialog");
  const save = dialog.getByRole("button", {
    name: "Salvar no servidor · slot 1",
  });
  await expect(save).toBeEnabled();
  await save.focus();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 0;
        function tick() {
          if (++frames === 6) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
  );
  await expect(dialog.getByRole("status")).toContainText("Jogo pausado");
  await page.evaluate("testPad.buttons[0].pressed=false");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.evaluate("testPad.buttons[0].pressed=true");
  await expect(dialog.getByRole("status")).toContainText(
    "Aguardando confirmação",
  );
});
