import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Stateful memory fixture exercises bridge ordering, not SNES save interpretation.
const engineFixture = `
window.sram = new Uint8Array([0,0,0,0]);
window.EJS_emulator = {
  config:{}, gamepad:{on(){}}, setupKeys(){}, on(){}, paused:false,
  pause(){this.paused=true}, play(){this.paused=false},
  gameManager:{
    functions:{simulateInput(){},getFrameNum(){return 0}},
    getSaveFile(){return window.sram.slice()},getSaveFilePath(){return '/data/saves/test.srm'},
    loadSaveFiles(){},FS:{writeFile(path,bytes){window.sram=bytes.slice()}}
  }
};
setTimeout(()=>{EJS_ready(); EJS_onGameStart()},0);`;

async function fixture(page: Page) {
  let serverBytes = [1, 2, 3, 4],
    version = '"initial"',
    puts = 0,
    conflict = false;
  await page.route("**/emulatorjs/data/loader.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: engineFixture,
    }),
  );
  await page.route("**/api/games/*/saves/1", async (route) => {
    if (route.request().method() === "PUT") {
      puts++;
      if (conflict || route.request().headers()["if-match"] !== version) {
        await route.fulfill({ status: 409 });
        return;
      }
      serverBytes = [...route.request().postDataBuffer()!];
      version = '"updated-' + puts + '"';
    }
    await route.fulfill({
      status: 200,
      body: Buffer.from(serverBytes),
      headers: {
        etag: version,
        "x-core-version": "emulatorjs-4.2.3",
        "x-core-build": "snes9x-eaa0bcfce676-7d427a575cef",
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Abrir biblioteca" }).click();
  await page.getByRole("button", { name: /Synthetic fixture/ }).click();
  await page.getByRole("button", { name: "Jogar agora" }).click();
  await page.getByRole("button", { name: "Menu / Voltar" }).click();
  await expect(
    page.getByRole("button", { name: "Salvar no servidor · slot 1" }),
  ).toBeEnabled();
  const frame = page.frames().find((f) => f.url().includes("/player/"))!;
  return {
    frame,
    bytes: () => serverBytes,
    puts: () => puts,
    conflict: () => {
      conflict = true;
    },
  };
}

test("boot SRAM, rejected import, preserved previous snapshot and no implicit upload", async ({
  page,
}) => {
  const f = await fixture(page);
  expect(await f.frame.evaluate("Array.from(sram)")).toEqual([1, 2, 3, 4]);
  await page.locator('input[type="file"]').setInputFiles({
    name: "wrong.srm",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([9, 9]),
  });
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "SRAM incompatível",
  );
  expect(await f.frame.evaluate("Array.from(sram)")).toEqual([1, 2, 3, 4]);
  await page.locator('input[type="file"]').setInputFiles({
    name: "compatible-size.srm",
    mimeType: "application/octet-stream",
    buffer: Buffer.from([5, 6, 7, 8]),
  });
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "SRAM importado",
  );
  expect(await f.frame.evaluate("Array.from(sram)")).toEqual([5, 6, 7, 8]);
  expect(f.puts()).toBe(0);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Exportar SRAM anterior à restauração" })
    .click();
  const download = await downloadPromise;
  expect([...(await readFile((await download.path())!))]).toEqual([1, 2, 3, 4]);
  expect(f.bytes()).toEqual([1, 2, 3, 4]);
  for (const [width, height] of [
    [1920, 1080],
    [960, 540],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(
        process.cwd(),
        `../../artifacts/screenshots/audit-player-${width}.png`,
      ),
    });
  }
});

test("opt-in synchronization uploads changed SRAM within 30 seconds then freezes on conflict", async ({
  page,
}) => {
  await page.clock.install();
  const f = await fixture(page);
  await page
    .getByRole("button", { name: "Ativar sincronização · SRAM já verificado" })
    .click();
  await expect(
    page.getByRole("button", { name: "Desativar sincronização" }),
  ).toBeEnabled();
  await f.frame.evaluate("sram=new Uint8Array([9,8,7,6])");
  await page.clock.fastForward(15001);
  await expect.poll(f.puts).toBe(1);
  expect(f.bytes()).toEqual([9, 8, 7, 6]);
  await page.clock.fastForward(15001);
  expect(f.puts()).toBe(1);
  f.conflict();
  await f.frame.evaluate("sram=new Uint8Array([4,3,2,1])");
  await page.clock.fastForward(15001);
  await expect(
    page.getByText(
      "Conflito de progresso. Exporte esta sessão antes de restaurar o servidor.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.clock.fastForward(45001);
  expect(f.puts()).toBe(2);
  expect(f.bytes()).toEqual([9, 8, 7, 6]);
  expect(await f.frame.evaluate("Array.from(sram)")).toEqual([4, 3, 2, 1]);
});

test("calibration preserves UI ownership and session experiment settings reach the bridge", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const pad = {
      id: "custom",
      index: 1,
      connected: true,
      mapping: "",
      axes: [0, 0],
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    };
    Object.defineProperty(window, "testPad", { value: pad });
    Object.defineProperty(navigator, "getGamepads", {
      value: () => [null, pad],
    });
  });
  await page.clock.install();
  await page.goto("/");
  await page.getByRole("button", { name: "Diagnóstico", exact: true }).click();
  await page.getByRole("button", { name: "Calibrar controle SNES" }).click();
  for (let button = 0; button < 12; button++) {
    await page.clock.fastForward(101);
    await page.evaluate(`testPad.buttons[${button}].pressed=true`);
    await page.clock.fastForward(101);
    await page.evaluate(`testPad.buttons[${button}].pressed=false`);
  }
  await expect(
    page.getByRole("status").filter({ hasText: "Perfil SNES salvo" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("superflip-snes-controls-v1")!).buttons,
    ),
  ).toEqual(Array.from({ length: 12 }, (_, i) => i));
  await page.getByLabel("Renderer solicitado").selectOption("webgl2");
  await page.getByRole("button", { name: "Ativar registro da sessão" }).click();
  for (const [width, height] of [
    [1920, 1080],
    [960, 540],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: join(
        process.cwd(),
        `../../artifacts/screenshots/audit-diagnostics-${width}.png`,
      ),
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "Biblioteca", exact: true }).click();
  await page.getByRole("button", { name: /Synthetic fixture/ }).click();
  await page.getByRole("button", { name: "Jogar agora" }).click();
  await expect(page.locator("iframe")).toHaveAttribute(
    "src",
    /renderer=webgl2&diagnostics=1/,
  );
});
