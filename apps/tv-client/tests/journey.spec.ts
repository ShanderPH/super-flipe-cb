import { expect, test } from "@playwright/test";

test("remote navigation, isolated player and restored library focus", async ({
  page,
}) => {
  await page.route("**/player/?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<script>const gameId=new URLSearchParams(location.search).get('gameId');parent.postMessage({type:'started',gameId,requestId:'event',payload:{}},location.origin);addEventListener('message',e=>{if(e.data.type==='pause')parent.postMessage({type:'paused',gameId,requestId:e.data.requestId,payload:{message:'Jogo pausado.'}},location.origin)});</script>`,
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Uma nova partida/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Abrir biblioteca" }).click();
  const card = page.getByRole("button", { name: /Synthetic fixture/ });
  await expect(card).toBeVisible();
  await expect(page.getByPlaceholder("Nome do jogo")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Synthetic fixture" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Jogar agora" }).click();
  await expect(page.getByTitle("Jogar Synthetic fixture")).toBeVisible();
  await page.getByRole("button", { name: "Menu / Voltar" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Voltar à biblioteca" }).click();
  await expect(page.getByRole("alert")).toContainText("Progresso não gravado");
  await page.getByRole("button", { name: "Confirmar saída da sessão" }).click();
  await expect(card).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: /Uma nova partida/ }),
  ).toBeVisible();
});

test("empty, server failure and reconnection states", async ({ page }) => {
  await page.route("**/api/games?*", (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 24 } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Sua coleção começa aqui." }),
  ).toBeVisible();
  await page.route("**/api/capabilities", (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("button", { name: "Reconectar" })).toBeVisible();
  await page.getByRole("button", { name: "Diagnóstico", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pronto para testar na TV." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Biblioteca", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reconectar" })).toBeVisible();
  await page.unroute("**/api/capabilities");
  await page.getByRole("button", { name: "Reconectar" }).click();
  await expect(
    page.getByRole("heading", { name: "Sua coleção começa aqui." }),
  ).toBeVisible();
});

test("diagnostics, responsive layout and offline assets", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (req) => {
    if (!req.url().startsWith("http://127.0.0.1:8788/"))
      external.push(req.url());
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Diagnóstico", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Pronto para testar na TV." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Testar áudio" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Testar áudio" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("button", { name: "Exportar diagnóstico" }),
  ).toBeFocused();
  await page.setViewportSize({ width: 960, height: 540 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(external).toEqual([]);
});

test("cache cleanup preserves save databases", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await Promise.all(
      ["EmulatorJS-roms", "EmulatorJS-states"].map(
        (name) =>
          new Promise<void>((resolve, reject) => {
            const req = indexedDB.open(name, 1);
            req.onupgradeneeded = () => req.result.createObjectStore("fixture");
            req.onsuccess = () => {
              req.result.close();
              resolve();
            };
            req.onerror = () => reject(req.error);
          }),
      ),
    );
  });
  await page.getByRole("button", { name: "Diagnóstico", exact: true }).click();
  await page
    .getByRole("button", { name: "Limpar cache de ROMs e cores" })
    .click();
  await expect(
    page.getByText(
      "Cache de ROMs, BIOS e cores removido desta origem. Saves não foram removidos.",
    ),
  ).toBeVisible();
  const names = await page.evaluate(async () =>
    (await indexedDB.databases()).map((d) => d.name),
  );
  expect(names).not.toContain("EmulatorJS-roms");
  expect(names).toContain("EmulatorJS-states");
});
