window.addEventListener("message", function (event) {
  if (!event.data || event.data.type !== "TV_KEY") return;

  const key = event.data.keyCode;

  switch (key) {
    case 13: // ENTER
      tvEnter();
      break;

    case 37: // LEFT
      tvLeft();
      break;

    case 39: // RIGHT
      tvRight();
      break;

    case 38: // UP
      tvUp();
      break;

    case 40: // DOWN
      tvDown();
      break;

    case 10009: // BACK (Samsung)
      tvBack();
      break;
  }
});

/* ========= PLAYER CONTROL ========= */

function getVideo() {
  return document.querySelector("video");
}

function tvEnter() {
  const active = document.activeElement;
  if (active) active.click();

  const video = getVideo();
  if (video) video.paused ? video.play() : video.pause();
}

function tvLeft() {
  const video = getVideo();
  if (video) video.currentTime -= 10;
}

function tvRight() {
  const video = getVideo();
  if (video) video.currentTime += 10;
}

function tvUp() {
  const video = getVideo();
  if (video) video.volume = Math.min(video.volume + 0.1, 1);
}

function tvDown() {
  const video = getVideo();
  if (video) video.volume = Math.max(video.volume - 0.1, 0);
}

function tvBack() {
  const modalEl = document.getElementById("playerModal");
  if (!modalEl) return;

  const modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
}
