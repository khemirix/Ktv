if (window.IS_TV_APP) {

  document.body.classList.add("tv-mode");

  document.addEventListener("keydown", function (e) {

    const focusable = Array.prototype.slice.call(
      document.querySelectorAll(
        '[tabindex="0"]:not([disabled])'
      )
    );

    if (!focusable.length) return;

    const index = focusable.indexOf(document.activeElement);

    let nextIndex = index;

    switch (e.keyCode) {
      case 37: // LEFT
        nextIndex = Math.max(0, index - 1);
        break;

      case 39: // RIGHT
        nextIndex = Math.min(focusable.length - 1, index + 1);
        break;

      case 38: // UP
        nextIndex = Math.max(0, index - 5);
        break;

      case 40: // DOWN
        nextIndex = Math.min(focusable.length - 1, index + 5);
        break;

      case 13: // ENTER
        document.activeElement.click();
        return;

      default:
        return;
    }

    e.preventDefault();

    focusable[nextIndex].focus();
  });

  // Auto-focus first item
  window.addEventListener("load", function () {
    const first = document.querySelector('[tabindex="0"]');
    if (first) first.focus();
  });
}
