const dialog = document.querySelector("#app-menu");
const toggle = document.querySelector("#menu-toggle");
export function closeMenu() {
  if (dialog.open) dialog.close();
  toggle.setAttribute("aria-expanded", "false");
}
export function installMenu(onOpen) {
  toggle.onclick = () => {
    onOpen();
    dialog.showModal();
    toggle.setAttribute("aria-expanded", "true");
  };
  dialog.querySelector("[data-close-menu]").onclick = closeMenu;
  dialog.addEventListener("close", () =>
    toggle.setAttribute("aria-expanded", "false"),
  );
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("a")) closeMenu();
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        closeMenu();
    }
  });
}
