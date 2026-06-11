// Dev-only entry for pet-dev.html — drives the cat without the app.
import { createCatScene } from "./catScene";
import { PetBrain } from "./petState";
import { petEvents } from "./petEvents";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

const brain = new PetBrain({
  now: () => performance.now(),
  isQuiet: () => false,
  random: Math.random,
  onBubble: (k) => console.log("bubble:", k),
});

const scene = createCatScene(canvas, { brain, reducedMotion: false });
if (!scene) {
  document.body.textContent = "WebGL2 unavailable";
} else {
  scene.setGaze(Number(params.get("gx") ?? 0), Number(params.get("gy") ?? 0.05));

  const mood = params.get("mood");
  if (mood === "typing") {
    setInterval(() => petEvents.emit("typing"), 800);
    petEvents.on((e) => brain.handleEvent(e));
    petEvents.emit("typing");
  } else if (mood === "petted") {
    setInterval(() => brain.strokeTick(), 600);
  } else if (mood === "concerned") {
    brain.handleEvent("compile-error");
  } else if (mood === "watch") {
    setInterval(() => brain.pointerActive(), 500);
  }
  const action = params.get("action");
  if (action) {
    // e.g. ?action=celebrate-big / invite-paw — fire after 0.5s.
    setTimeout(() => {
      if (action === "celebrate-big") brain.handleEvent("checkpoint");
      else if (action === "celebrate-small") brain.handleEvent("saved");
      else if (action === "shake") brain.handleEvent("restored");
      else if (action === "poke") brain.poke();
    }, 500);
  }
}
