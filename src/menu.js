const dialog = document.querySelector("#app-menu");
const toggle = document.querySelector("#menu-toggle");
let closeTimer;
function finishClose() {
  clearTimeout(closeTimer);
  if (dialog.open) dialog.close();
  dialog.classList.remove("closing");
  document.body.classList.remove("menu-open");
  toggle.setAttribute("aria-expanded", "false");
}
export function closeMenu() {
  if (!dialog.open || dialog.classList.contains("closing")) return;
  toggle.setAttribute("aria-expanded", "false");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishClose();
    return;
  }
  dialog.classList.add("closing");
  closeTimer = setTimeout(finishClose, 240);
}
export function installMenu(onOpen) {
  toggle.onclick = () => {
    onOpen();
    dialog.showModal();
    document.body.classList.add("menu-open");
    toggle.setAttribute("aria-expanded", "true");
  };
  dialog.querySelector("[data-close-menu]").onclick = closeMenu;
  dialog.addEventListener("close", () => {
    if (!dialog.open) finishClose();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeMenu();
  });
  dialog.addEventListener("animationend", (event) => {
    if (event.target === dialog && event.animationName === "menu-slide-out")
      finishClose();
  });
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
