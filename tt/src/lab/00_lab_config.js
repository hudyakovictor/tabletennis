/* =====================================================================
 *  TOPSPIN LAB — the ONE configuration of the core loop.
 *
 *  Every number here is a calibration constant, not a player preference.
 *  The only setting the player has is `distance` (how close the table is):
 *  it is the only thing that legitimately differs between a phone and a
 *  desktop. Everything else is tuned from the saved history of shots.
 * ===================================================================== */
'use strict';

const LAB = {
  version: 3,

  /* ---- storage -------------------------------------------------- */
  storeKey: 'topspin.lab.settings.v3',
  historyKey: 'topspin.lab.history.v3',
  historyLimit: 1500,          // shot records kept across reloads
  sessionLimit: 80,            // "games" (one per page session)

  /* ---- camera / the single setting ------------------------------ */
  distance: 1.00,              // 1 = author's default framing
  distanceMin: 0.72,           // closest
  distanceMax: 1.34,           // farthest
  camFov: 52,
  camPitch: 24,                // landscape: look down the table
  camPitchPortrait: 50,
  camLook: { x: 0, y: 0.74, z: -0.30 },
  ballScale: 1.45,             // readability: the colour IS the timing cue
  padScale: 0.62,              // the blade must not hide the contact area

  /* ---- the contact window ---------------------------------------
   * The ball is "green" while its centre is inside this box in front of
   * the player. The box is deliberately generous in z (length) because a
   * human reaction is 200-300 ms and the swipe itself takes another
   * 100-250 ms; anything tighter is not playable with a thumb.
   * ------------------------------------------------------------------ */
  /* The ball is hit on the plane where the bat stands. The WINDOW is a
   * TIME window before the ball reaches that plane, not a box in space:
   * a 4 m/s ball crosses a 0.4 m box in 100 ms, which no thumb can react
   * to (research: human reaction is 200-300 ms). 0.62 s of green is the
   * shortest window that is honestly playable. */
  strikeZ: 1.30,
  windowOpenZ: -0.30,          // green starts just before the ball crosses the net
  windowLateSec: 0.22,
  lateReactSec: 0.08,          // red starts this close to the plane: no time left to swing
  windowMinY: 0.70,            // a ball this low cannot be hit at all
  windowMaxY: 2.30,
  lateGraceSec: 0.34,          // a contact snapshot stays valid this long

  /* ---- input zone ------------------------------------------------
   * Screen radius, as a fraction of min(viewport). The zone is NOT drawn
   * in play (it distracts); the debug panel reports the measured distance
   * so the radius can be calibrated from history.
   * ------------------------------------------------------------------ */
  zoneFrac: 0.24,
  zoneMinPx: 76,
  zoneMaxPx: 158,

  /* ---- gesture ---------------------------------------------------
   * Power is a PHYSICAL length of the swipe in millimetres, not a fraction
   * of the screen: a thumb travels the same distance on a phone and on a
   * monitor, and 1 CSS px is 1/96 inch on both. Fractions of the viewport
   * made the same gesture "strong" on a phone and "normal" on a desktop.
   * ------------------------------------------------------------------ */
  pxPerMm: 96 / 25.4,
  minSwipeMm: 9,               // shorter than this is a tap, not a stroke
  powerZeroMm: 14,             // swipe length at which power starts to grow
  powerFullMm: 72,             // swipe length at full effort
  effortMax: 1.25,

  /* ---- power bands (fractions of full effort) --------------------
   * weak   : the ball must not reach the opponent's half
   * normal : lands on the table
   * strong : fast, may go long
   * Buckets only label the counter; physics uses the continuous value.
   * ------------------------------------------------------------------ */
  /* Four power bands, in effort units. Two of them are the usable variants
   * (normal, strong), the other two are the deliberate mistakes the debug
   * mode has to make visible: too soft (net / own half) and too hard
   * (over the far edge). */
  weakBelow: 0.34,
  normalBelow: 0.72,
  strongBelow: 0.88,

  /* ---- ball colours --------------------------------------------- */
  colorIdle: [1.00, 1.00, 0.99],
  colorReady: [0.42, 1.00, 0.36],
  colorLate: [1.00, 0.26, 0.28],

  /* ---- rally loop ------------------------------------------------ */
  deadDelay: 0.85,             // pause after a dead ball before the next feed
  watchdogSec: 6.0,            // a stuck live ball is reset

  /* ---- serving --------------------------------------------------- */
  serveHand: { x: 0.14, y: 1.12, z: 1.34 },
  serveTargetZ: -0.92,
  serveOwnZ: 0.58,
  serveDirs: ['LEFT', 'CENTER', 'RIGHT'],
  serveSpins: ['FLAT', 'TOP', 'BACK', 'SIDE'],
};

/* The screen-space capture zone for the current viewport, in CSS px. */
function labZonePx(w, h) {
  const min = Math.max(1, Math.min(w, h));
  return clamp(min * LAB.zoneFrac, LAB.zoneMinPx, LAB.zoneMaxPx);
}

/* ---------------------------------------------------------------------
 *  The lens. ONE rule shared by the renderer and the pointer map: above
 *  16:9 the authored vertical angle is used; below it the horizontal
 *  angle is locked instead, so a portrait phone sees the whole table
 *  rather than a crop. Duplicated from the legacy camera module on
 *  purpose — this build does not load the legacy camera at all.
 * ------------------------------------------------------------------- */
const CAMERA_TUNING = { lensMax: 1.55, vMax: 84 };
const CAMERA_REF_ASPECT = 16 / 9;
function lensFovDeg(vfovDeg, aspect) {
  const a = Math.max(aspect, 0.30);
  if (a >= CAMERA_REF_ASPECT) return vfovDeg;
  const hf = 2 * Math.atan(Math.tan(vfovDeg * DEG / 2) * CAMERA_REF_ASPECT);
  const need = 2 * Math.atan(Math.tan(hf / 2) / a) / DEG;
  return Math.min(need, vfovDeg * CAMERA_TUNING.lensMax, CAMERA_TUNING.vMax);
}
function verticalFovDeg(vfovDeg, aspect) { return lensFovDeg(vfovDeg, aspect); }
function horizontalFovDeg(vfovDeg, aspect) {
  return 2 * Math.atan(Math.tan(lensFovDeg(vfovDeg, aspect) * DEG / 2) * Math.max(aspect, 0.2)) / DEG;
}
