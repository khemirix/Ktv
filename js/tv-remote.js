window.addEventListener("message", function (e) {
  console.log("TV KEY:", e.data);

  if (!e.data || e.data.type !== "TV_KEY") return;

  switch (e.data.keyCode) {
    case 37: console.log("LEFT"); break;
    case 38: console.log("UP"); break;
    case 39: console.log("RIGHT"); break;
    case 40: console.log("DOWN"); break;
    case 13: console.log("ENTER"); break;
    case 10009: console.log("BACK"); break;
  }
});
