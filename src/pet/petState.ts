// The cat's brain — a small state machine driving moods (continuous) and
// actions (one-shots). Spec: spec/2026-06-10-pet-cat-3d.md §4 §6 §7.
//
// Priority: user feedback (petted/carried) > celebrate > invite > ambient.
// All timings in ms on the clock supplied by the host (performance.now).

import type { PetEvent } from "./petEvents";

export type PetMood =
  | "idle"
  | "watch" // gaze follows the cursor
  | "typing" // looks toward the editor, tail ticks
  | "petted"
  | "sleep"
  | "carried"
  | "concerned"; // compile error pending

export type PetActionName =
  | "wake-stretch"
  | "invite-paw"
  | "invite-stretch"
  | "invite-tailchase"
  | "celebrate-small" // manual save
  | "celebrate-glance" // compile success — watch the paper settle
  | "celebrate-big" // checkpoint — jump + brass dust
  | "celebrate-nod" // push success tail of the big one
  | "surprise-shake" // checkpoint restored
  | "poke-flick" // user tapped the cat
  | "blink-ack"; // downgraded celebration inside cooldown

export interface PetAction {
  name: PetActionName;
  start: number;
  dur: number;
}

export const ACTION_DUR: Record<PetActionName, number> = {
  "wake-stretch": 1400,
  "invite-paw": 2600,
  "invite-stretch": 2800,
  "invite-tailchase": 2400,
  "celebrate-small": 1500,
  "celebrate-glance": 1200,
  "celebrate-big": 2500,
  "celebrate-nod": 1200,
  "surprise-shake": 700,
  "poke-flick": 500,
  "blink-ack": 600,
};

const SLEEP_AFTER = 5 * 60_000;
const WATCH_HOLD = 3_000; // keep watching this long after the cursor stops
const TYPING_HOLD = 4_000;
const PETTED_HOLD = 2_000;
const CELEBRATE_COOLDOWN = 60_000; // per tier
const INVITE_MIN = 10 * 60_000;
const INVITE_MAX = 18 * 60_000;
const STARTUP_GRACE = 5 * 60_000;
const ACTIVE_WINDOW = 30_000; // "user is around" for invites
const LONG_TYPING = 45 * 60_000; // stretch-reminder weighting
const INVITE_ACCEPT_WINDOW = 6_000;

export type BubbleKind = "meow";

export interface BrainHost {
  now(): number;
  /** Modal open / compile error / anything that demands quiet. */
  isQuiet(): boolean;
  onBubble(kind: BubbleKind): void;
  /** Pseudo-randomness source (tests can pin it). */
  random(): number;
}

export class PetBrain {
  mood: PetMood = "idle";
  action: PetAction | null = null;

  private host: BrainHost;
  private bornAt: number;
  private lastPointer = -Infinity;
  private lastTyping = -Infinity;
  private lastStroke = -Infinity;
  private lastInput: number;
  private typingSince: number | null = null;
  private carried = false;
  private concerned = false;
  private sleeping = false;
  private celebrateUntil: Record<"small" | "glance" | "big", number> = {
    small: -Infinity,
    glance: -Infinity,
    big: -Infinity,
  };
  private nextInviteAt: number;
  private inviteBackoff = 1;
  private pendingInviteAccept: number | null = null;
  private pendingNod = false;

  constructor(host: BrainHost) {
    this.host = host;
    this.bornAt = host.now();
    this.lastInput = this.bornAt;
    this.nextInviteAt = this.bornAt + STARTUP_GRACE + this.inviteGap();
  }

  private inviteGap(): number {
    return INVITE_MIN + (INVITE_MAX - INVITE_MIN) * this.host.random();
  }

  // ---- inputs ------------------------------------------------------------

  /** Any global pointer movement (gaze + wake + activity). */
  pointerActive(): void {
    const now = this.host.now();
    this.lastPointer = now;
    this.lastInput = now;
  }

  /** Any global key press (activity only — content never reaches the pet). */
  keyActive(): void {
    this.lastInput = this.host.now();
  }

  /** Hovering over the cat counts as accepting an invitation. */
  hover(): void {
    const now = this.host.now();
    this.lastInput = now;
    if (this.pendingInviteAccept != null) {
      this.pendingInviteAccept = null;
      this.inviteBackoff = 1;
      this.nextInviteAt = now + this.inviteGap();
    }
  }

  /** Stroke gesture over the cat's body. */
  strokeTick(): void {
    const now = this.host.now();
    this.lastStroke = now;
    this.lastInput = now;
    if (this.pendingInviteAccept != null) {
      // Invitation accepted — the cat is encouraged.
      this.pendingInviteAccept = null;
      this.inviteBackoff = 1;
      this.nextInviteAt = now + this.inviteGap();
    }
    // Petting interrupts any self-initiated action.
    if (this.action && this.action.name.startsWith("invite")) this.action = null;
  }

  poke(): void {
    this.lastInput = this.host.now();
    if (!this.action) this.startAction("poke-flick");
  }

  setCarried(on: boolean): void {
    this.carried = on;
    this.lastInput = this.host.now();
    if (on) this.action = null;
  }

  handleEvent(e: PetEvent): void {
    const now = this.host.now();
    switch (e) {
      case "typing":
        this.lastTyping = now;
        this.lastInput = now;
        if (this.typingSince == null) this.typingSince = now;
        break;
      case "compile-error":
        this.concerned = true;
        break;
      case "compiled":
        this.concerned = false;
        this.celebrate("glance");
        break;
      case "saved":
        this.celebrate("small");
        break;
      case "checkpoint":
        this.celebrate("big");
        break;
      case "pushed":
        // Tail of the big celebration; if it already ended, nod on its own.
        if (this.action?.name === "celebrate-big") this.pendingNod = true;
        else if (!this.host.isQuiet()) this.startAction("celebrate-nod");
        break;
      case "restored":
        if (!this.action) this.startAction("surprise-shake");
        break;
    }
  }

  private celebrate(tier: "small" | "glance" | "big"): void {
    const now = this.host.now();
    if (now < this.celebrateUntil[tier]) {
      // Fatigue protection — scarce rituals stay meaningful.
      if (!this.action) this.startAction("blink-ack");
      return;
    }
    this.celebrateUntil[tier] = now + CELEBRATE_COOLDOWN;
    const name: PetActionName =
      tier === "small"
        ? "celebrate-small"
        : tier === "glance"
          ? "celebrate-glance"
          : "celebrate-big";
    this.startAction(name);
  }

  private startAction(name: PetActionName): void {
    this.action = { name, start: this.host.now(), dur: ACTION_DUR[name] };
  }

  // ---- per-frame update ----------------------------------------------------

  update(): void {
    const now = this.host.now();

    if (this.action && now - this.action.start >= this.action.dur) {
      const finished = this.action.name;
      this.action = null;
      if (finished === "celebrate-big" && this.pendingNod) {
        this.pendingNod = false;
        this.startAction("celebrate-nod");
      }
      if (finished.startsWith("invite")) {
        this.pendingInviteAccept = now + INVITE_ACCEPT_WINDOW;
      }
      if (finished === "wake-stretch") this.sleeping = false;
    }

    if (this.pendingInviteAccept != null && now > this.pendingInviteAccept) {
      // Ignored — the cat takes the hint and backs off.
      this.pendingInviteAccept = null;
      this.inviteBackoff *= 1.5;
      this.nextInviteAt = now + this.inviteGap() * this.inviteBackoff;
    }

    if (this.typingSince != null && now - this.lastTyping > TYPING_HOLD) {
      this.typingSince = null;
    }

    // Sleep / wake.
    const idleFor = now - this.lastInput;
    if (this.sleeping) {
      if (idleFor < 250 && this.action?.name !== "wake-stretch") {
        this.startAction("wake-stretch");
      }
    } else if (
      idleFor > SLEEP_AFTER &&
      !this.carried &&
      !this.action &&
      now - this.lastStroke > PETTED_HOLD
    ) {
      this.sleeping = true;
    }

    // Invitations — three gates: cooldown, user active, quiet room.
    if (
      !this.sleeping &&
      !this.carried &&
      !this.action &&
      !this.concerned &&
      now >= this.nextInviteAt
    ) {
      if (now - this.lastInput <= ACTIVE_WINDOW && !this.host.isQuiet()) {
        this.startAction(this.pickInvite(now));
        this.nextInviteAt = now + this.inviteGap() * this.inviteBackoff;
      } else {
        this.nextInviteAt = now + 60_000; // re-check in a minute
      }
    }

    this.mood = this.computeMood(now);
  }

  private pickInvite(now: number): PetActionName {
    const longTyping =
      this.typingSince != null && now - this.typingSince > LONG_TYPING;
    const pool: PetActionName[] = [
      "invite-paw",
      "invite-stretch",
      "invite-tailchase",
    ];
    if (longTyping) pool.push("invite-stretch", "invite-stretch");
    const picked = pool[Math.floor(this.host.random() * pool.length)];
    if (picked === "invite-paw") this.host.onBubble("meow");
    return picked;
  }

  private computeMood(now: number): PetMood {
    if (this.carried) return "carried";
    if (this.sleeping && this.action?.name !== "wake-stretch") return "sleep";
    if (now - this.lastStroke < PETTED_HOLD) return "petted";
    if (this.concerned) return "concerned";
    if (now - this.lastTyping < TYPING_HOLD) return "typing";
    if (now - this.lastPointer < WATCH_HOLD) return "watch";
    return "idle";
  }
}
