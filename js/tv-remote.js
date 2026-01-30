window.addEventListener("message", function (event) {
  if (!event.data || event.data.type !== "TV_KEY") return;

  const key = event.data.keyCode;

  switch (key) {
    case 13: // ENTER
      handleEnter();
      break;

    case 37: // LEFT
      handleLeft();
      break;

    case 39: // RIGHT
      handleRight();
      break;

    case 38: // UP
      handleUp();
      break;

    case 40: // DOWN
      handleDown();
      break;

    case 10009: // BACK (Samsung remote)
      handleBack();
      break;
  }
});
if (key === 10009) {
  const modal = bootstrap.Modal.getInstance(
    document.getElementById("playerModal")
  );
  if (modal) modal.hide();
}
