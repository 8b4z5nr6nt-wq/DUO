export async function navigate(page, name) {
  const link = page.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) {
    const toggle = page.getByRole("button", {
      name: "メニューを開く",
      exact: true,
    });
    if (await toggle.count()) await toggle.click();
  }
  await link.click();
  const menu = page.locator("#app-menu");
  if (await menu.count()) await menu.waitFor({ state: "hidden" });
}
