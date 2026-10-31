/* Paddle-only templates, shared by live contact retargeting and preview.
 * Ball/swipe points are reference targets, never a ball or input simulator.
 * Requires 10_math.js and PH. All positions/metres and velocities/SI. */
'use strict';

const { PADDLE_TEMPLATES, compileStrokeTemplate, sampleStrokeTemplate,
  retargetStrokeTemplate, createStrokeTemplateOutput } = (() => {
  const freeze = o => {
    for (const value of Object.values(o)) if (value && typeof value === 'object') freeze(value);
    return Object.freeze(o);
  };
  const geometry = { rubberOffset: .010, sweetOffset: .012, ballRadius: PH.BALL_R ?? PH.R };
  const swipe = (pts, kind = 'swipe', curl = 0, toss = false) => ({
    referenceOnly: true, space: 'screen-percent-y-down', kind, pts, curl, toss,
    window: { from: .22, to: .68 },
  });
  const stroke = (id, hand, duration, backT, finishT, keys, ball, swipeReference, authored = 'source') => ({
    id, sourceId: id.toLowerCase(), authored, hand, duration, backT, finishT,
    keys: keys.map(k => ({ t: k[0], dp: k[1], n: k[2], up: k[3] })),
    ballReference: ball.map(b => ({ t: b[0], p: [b[1][0], b[1][1] + PH.TABLE_Y,
      b[1][2] + PH.T_HALF_LEN], h: b[2] ?? 0, contact: b[3] === true })),
    swipeReference,
  });
  // The 17 source profiles retain all 152 keys and 87 ball reference points.
  // Relative dp/n/up are not translated. Authorial scalar spin is omitted.
  const PADDLE_TEMPLATES = freeze({ version: 1, geometry, strokes: {
    DRIVE: stroke('DRIVE', 'fh', 2.4, .34, .74, [
      [0, [-.12,-.04,.22], [-.05,0,-1], [.55,.75,.1]],
      [.14, [-.02,-.04,.24], [-.12,-.02,-1], [.65,.65,.25]],
      [.34, [.17,-.06,.26], [-.18,-.05,-.98], [.65,.55,.45]],
      [.47, [.08,-.03,.11], [-.2,-.06,-.98], [.8,.45,.25]],
      [.55, [0,0,0], [-.22,-.08,-.97], [.85,.45,0]],
      [.63, [-.15,.07,-.08], [-.4,-.18,-.9], [.7,.55,-.3]],
      [.74, [-.36,.17,-.04], [-.75,-.3,-.55], [.15,.9,-.3]],
      [.84, [-.35,.15,0], [-.72,-.25,-.6], [.2,.9,-.25]],
      [1, [-.12,-.04,.22], [-.05,0,-1], [.55,.75,.1]],
    ], [[.22,[0,.3,-1.6],.14], [.42,[.26,.02,-.38],.12],
      [.55,[.34,.24,.14],.17,true], [.7,[-.15,.02,-1.85],.07], [.8,[-.22,.05,-2.45]]],
      swipe([[16,74],[36,64],[56,52],[74,41],[86,34]])),
    LOOP: stroke('LOOP', 'fh', 2.5, .34, .74, [
      [0, [-.14,.02,.1], [-.1,-.1,-1], [.55,.75,.1]],
      [.14, [0,-.1,.14], [-.12,-.3,-.95], [.7,.55,.3]],
      [.34, [.14,-.28,.18], [-.1,-.45,-.88], [.75,.35,.45]],
      [.47, [.07,-.13,.08], [-.18,-.46,-.87], [.85,.35,.2]],
      [.55, [0,0,0], [-.22,-.45,-.86], [.9,.35,-.1]],
      [.63, [-.15,.17,-.06], [-.45,-.5,-.73], [.7,.55,-.3]],
      [.74, [-.36,.38,.02], [-.75,-.45,-.45], [.15,.9,-.3]],
      [.84, [-.36,.35,.05], [-.72,-.4,-.55], [.2,.9,-.25]],
      [1, [-.14,.02,.1], [-.1,-.1,-1], [.55,.75,.1]],
    ], [[.22,[.05,.28,-1.6],.1], [.42,[.32,.02,-.22],.13],
      [.55,[.4,.2,.32],.3,true], [.74,[-.1,.02,-1.7],.05], [.84,[-.2,.04,-2.35]]],
      swipe([[14,88],[34,74],[52,58],[68,41],[82,26]])),
    COUNTER: stroke('COUNTER', 'fh', 2.1, .36, .7, [
      [0, [-.1,-.02,.2], [-.08,-.08,-.99], [.6,.7,.15]],
      [.16, [0,-.03,.2], [-.1,-.12,-.98], [.65,.6,.3]],
      [.36, [.14,-.04,.22], [-.15,-.16,-.97], [.6,.5,.45]],
      [.48, [.06,-.02,.1], [-.18,-.17,-.97], [.75,.45,.25]],
      [.55, [0,0,0], [-.2,-.18,-.96], [.85,.4,0]],
      [.62, [-.12,.06,-.06], [-.35,-.28,-.89], [.7,.5,-.3]],
      [.7, [-.3,.14,-.02], [-.7,-.35,-.62], [.2,.85,-.35]],
      [.82, [-.3,.12,.03], [-.68,-.3,-.66], [.25,.85,-.3]],
      [1, [-.1,-.02,.2], [-.08,-.08,-.99], [.6,.7,.15]],
    ], [[.25,[0,.28,-1.6],.05], [.45,[.24,.02,-.3],.1],
      [.55,[.3,.26,.12],.15,true], [.68,[-.1,.02,-1.9],.05], [.78,[-.16,.05,-2.5]]],
      swipe([[30,76],[46,62],[61,48],[76,34]])),
    SMASH: stroke('SMASH', 'fh', 2.3, .36, .72, [
      [0, [-.12,-.22,.05], [-.1,0,-1], [.55,.75,.1]],
      [.16, [.02,-.05,.18], [-.15,.05,-.98], [.5,.75,.35]],
      [.36, [.12,.12,.3], [-.15,.15,-.97], [.45,.8,.4]],
      [.48, [.06,.06,.13], [-.2,-.1,-.97], [.7,.65,.1]],
      [.55, [0,0,0], [-.25,-.33,-.91], [.8,.5,-.3]],
      [.62, [-.14,-.18,-.12], [-.35,-.55,-.75], [.75,.3,-.55]],
      [.72, [-.34,-.38,-.06], [-.7,-.5,-.5], [.2,.1,-.97]],
      [.84, [-.33,-.36,0], [-.65,-.45,-.6], [.25,.2,-.95]],
      [1, [-.12,-.22,.05], [-.1,0,-1], [.55,.75,.1]],
    ], [[.16,[0,.5,-1.6],.45], [.4,[.25,.02,-.55],.3],
      [.55,[.36,.52,.3],.06,true], [.7,[-.1,.02,-2.1],.06], [.84,[-.18,.28,-2.5]]],
      swipe([[20,28],[40,33],[60,39],[80,45]])),
    FLICK: stroke('FLICK', 'fh', 2.3, .4, .7, [
      [0, [-.1,.02,.32], [-.1,0,-1], [.55,.75,.1]],
      [.2, [0,.02,.16], [-.05,.3,-.95], [.65,.3,-.65]],
      [.4, [.04,0,.08], [0,.35,-.94], [.7,.25,-.65]],
      [.5, [.02,0,.03], [-.1,.18,-.98], [.7,.3,-.65]],
      [.55, [0,0,0], [-.2,.02,-.98], [.7,.32,-.62]],
      [.61, [-.06,.06,-.06], [-.35,-.15,-.92], [.65,.45,-.6]],
      [.7, [-.1,.1,-.06], [-.4,-.2,-.9], [.6,.5,-.6]],
      [.84, [-.08,.08,.06], [-.3,-.1,-.95], [.6,.55,-.4]],
      [1, [-.1,.02,.32], [-.1,0,-1], [.55,.75,.1]],
    ], [[.24,[0,.24,-1.6],.06], [.45,[.16,.02,-.45],.08],
      [.55,[.22,.15,-.26],.17,true], [.71,[-.12,.02,-1.8],.06], [.81,[-.18,.04,-2.35]]],
      swipe([[38,68],[50,58],[61,48],[70,40]])),
    SIDE: stroke('SIDE', 'fh', 2.4, .36, .74, [
      [0, [-.2,-.03,.18], [-.4,-.05,-.92], [.45,.75,.2]],
      [.16, [-.05,-.03,.2], [-.45,-.06,-.89], [.4,.7,.35]],
      [.36, [.16,-.04,.2], [-.5,-.07,-.86], [.35,.6,.5]],
      [.48, [.06,-.02,.09], [-.52,-.08,-.85], [.35,.55,.4]],
      [.55, [0,0,0], [-.55,-.08,-.83], [.3,.55,.3]],
      [.63, [-.18,.03,-.05], [-.6,-.15,-.78], [.3,.6,-.1]],
      [.74, [-.38,.08,-.02], [-.75,-.2,-.63], [.15,.8,-.2]],
      [.85, [-.36,.06,.03], [-.72,-.18,-.67], [.2,.8,-.15]],
      [1, [-.2,-.03,.18], [-.4,-.05,-.92], [.45,.75,.2]],
    ], [[.24,[0,.28,-1.6],.1], [.44,[.26,.02,-.4],.1],
      [.55,[.34,.22,.1],.15,true], [.74,[-.2,.02,-1.95],.05], [.86,[-.42,.05,-2.45]]],
      swipe([[14,52],[38,52],[62,52],[86,52]])),
    HOOK: stroke('HOOK', 'fh', 2.5, .34, .74, [
      [0, [-.12,0,.12], [-.25,-.3,-.88], [.6,.6,.2]],
      [.16, [-.02,-.12,.14], [-.28,-.38,-.83], [.65,.45,.35]],
      [.34, [.12,-.26,.16], [-.3,-.42,-.8], [.7,.35,.45]],
      [.47, [.05,-.12,.08], [-.32,-.44,-.78], [.75,.35,.25]],
      [.55, [0,0,0], [-.35,-.42,-.75], [.75,.35,-.05]],
      [.63, [-.16,.16,-.06], [-.5,-.45,-.65], [.6,.5,-.3]],
      [.74, [-.38,.36,.02], [-.75,-.4,-.4], [.15,.85,-.35]],
      [.85, [-.38,.33,.06], [-.72,-.38,-.45], [.2,.85,-.3]],
      [1, [-.12,0,.12], [-.25,-.3,-.88], [.6,.6,.2]],
    ], [[.22,[.05,.28,-1.6],.1], [.42,[.3,.02,-.25],.13],
      [.55,[.38,.2,.3],.3,true], [.74,[-.35,.02,-1.95],.06], [.88,[-.5,.05,-2.45]]],
      swipe([[70,18],[50,26],[36,50],[50,74],[70,82]], 'swipe', -1)),
    FADE: stroke('FADE', 'fh', 2.5, .34, .74, [
      [0, [-.1,0,.12], [0,-.28,-.96], [.55,.65,.3]],
      [.16, [0,-.1,.15], [.02,-.36,-.93], [.6,.5,.4]],
      [.34, [.1,-.24,.16], [.02,-.42,-.9], [.6,.4,.5]],
      [.47, [.08,-.1,.08], [0,-.44,-.9], [.65,.4,.35]],
      [.55, [0,0,0], [0,-.45,-.89], [.65,.4,.15]],
      [.63, [-.08,.16,-.05], [-.15,-.48,-.86], [.6,.55,-.15]],
      [.74, [-.18,.36,.02], [-.45,-.45,-.77], [.3,.8,-.25]],
      [.85, [-.18,.33,.06], [-.42,-.42,-.8], [.32,.8,-.2]],
      [1, [-.1,0,.12], [0,-.28,-.96], [.55,.65,.3]],
    ], [[.22,[0,.28,-1.6],.1], [.42,[.22,.02,-.25],.13],
      [.55,[.3,.2,.3],.3,true], [.74,[.5,.02,-1.95],.06], [.88,[.6,.05,-2.45]]],
      swipe([[30,18],[50,26],[64,50],[50,74],[30,82]], 'swipe', 1)),
    BLOCK: stroke('BLOCK', 'bh', 2.2, .42, .7, [
      [0, [.04,-.02,.16], [.05,-.05,-1], [-.6,.75,.1]],
      [.2, [.03,-.02,.12], [.08,-.12,-.99], [-.65,.7,.05]],
      [.42, [.02,0,.07], [.1,-.15,-.98], [-.7,.65,0]],
      [.5, [.01,0,.03], [.11,-.16,-.98], [-.72,.65,-.03]],
      [.55, [0,0,0], [.12,-.16,-.98], [-.72,.65,-.05]],
      [.61, [0,.015,-.04], [.15,-.2,-.97], [-.7,.65,-.1]],
      [.7, [.01,.02,-.05], [.15,-.2,-.97], [-.7,.65,-.1]],
      [.84, [.02,0,.03], [.1,-.12,-.99], [-.65,.72,0]],
      [1, [.04,-.02,.16], [.05,-.05,-1], [-.6,.75,.1]],
    ], [[.3,[.15,.3,-1.6],.06], [.46,[.03,.02,-.42],.1],
      [.55,[-.02,.17,.06],.22,true], [.7,[.25,.02,-1.75],.06], [.8,[.32,.05,-2.4]]],
      swipe([[50,50]], 'tap')),
    PUSH: stroke('PUSH', 'fh', 2.4, .4, .72, [
      [0, [-.06,.06,.18], [-.12,.5,-.86], [.8,-.1,-.55]],
      [.2, [0,.05,.16], [-.12,.6,-.78], [.8,-.2,-.5]],
      [.4, [.04,.02,.1], [-.13,.7,-.7], [.8,-.25,-.5]],
      [.5, [.02,0,.05], [-.14,.73,-.67], [.8,-.27,-.48]],
      [.55, [0,0,0], [-.15,.75,-.64], [.8,-.3,-.45]],
      [.62, [-.03,-.01,-.05], [-.17,.77,-.61], [.8,-.3,-.45]],
      [.72, [-.06,-.02,-.07], [-.2,.77,-.6], [.8,-.3,-.45]],
      [.84, [-.05,.02,.02], [-.15,.6,-.78], [.8,-.2,-.5]],
      [1, [-.06,.06,.18], [-.12,.5,-.86], [.8,-.1,-.55]],
    ], [[.26,[.1,.22,-1.6],.05], [.45,[.16,.02,-.55],.06],
      [.55,[.2,.1,-.3],.04,true], [.66,[.14,.19,-1.1],.09],
      [.76,[.06,.02,-1.6],.02], [.86,[0,.03,-1.95]]],
      swipe([[22,36],[42,47],[60,57],[78,66]])),
    CHOP: stroke('CHOP', 'fh', 2.6, .36, .74, [
      [0, [-.15,.15,-.05], [-.1,.1,-1], [.5,.8,.1]],
      [.16, [0,.25,.06], [-.1,.35,-.93], [.55,.75,.3]],
      [.36, [.08,.4,.14], [-.05,.55,-.83], [.55,.55,.6]],
      [.48, [.04,.15,.06], [-.1,.55,-.83], [.75,.35,.55]],
      [.55, [0,0,0], [-.15,.55,-.82], [.85,.2,.45]],
      [.63, [-.1,-.14,-.14], [-.2,.6,-.77], [.85,.1,.5]],
      [.74, [-.24,-.24,-.22], [-.3,.7,-.65], [.8,0,.6]],
      [.84, [-.22,-.2,-.16], [-.25,.6,-.75], [.75,.2,.6]],
      [1, [-.15,.15,-.05], [-.1,.1,-1], [.5,.8,.1]],
    ], [[.2,[0,.32,-1.6],.18], [.38,[.25,.02,-.55],.28],
      [.55,[.4,.04,.78],.29,true], [.78,[.05,.02,-1.9],.03], [.88,[0,.03,-2.4]]],
      swipe([[18,20],[38,38],[56,54],[76,70]])),
    DROP: stroke('DROP', 'fh', 2.4, .42, .72, [
      [0, [-.03,.03,.12], [-.1,.55,-.83], [.8,-.15,-.5]],
      [.25, [0,.02,.08], [-.1,.62,-.78], [.8,-.2,-.48]],
      [.45, [.015,0,.04], [-.12,.68,-.72], [.8,-.24,-.46]],
      [.55, [0,0,0], [-.13,.7,-.7], [.8,-.26,-.44]],
      [.63, [-.015,.005,-.03], [-.15,.72,-.67], [.8,-.26,-.44]],
      [.74, [-.03,.01,-.045], [-.17,.72,-.66], [.8,-.26,-.44]],
      [.86, [-.025,.02,.01], [-.13,.6,-.78], [.8,-.2,-.5]],
      [1, [-.03,.03,.12], [-.1,.55,-.83], [.8,-.15,-.5]],
    ], [[.24,[.1,.25,-1.55],.03], [.46,[.14,.02,-.5],.05],
      [.55,[.16,.09,-.32],.03,true], [.66,[.09,.21,-1.25],.06],
      [.76,[.02,.02,-1.55],.015], [.86,[-.05,.02,-1.75]]],
      swipe([[40,44],[51,49],[60,53]])),
    LOB: stroke('LOB', 'fh', 2.8, .36, .76, [
      [0, [-.15,.22,-.05], [-.1,.2,-.98], [.55,.75,.1]],
      [.16, [0,0,.06], [-.1,.5,-.86], [.7,.45,.5]],
      [.36, [.1,-.22,.12], [-.08,.7,-.71], [.85,.1,.5]],
      [.48, [.05,-.1,.06], [-.1,.72,-.69], [.9,.15,.35]],
      [.55, [0,0,0], [-.12,.72,-.68], [.9,.25,.2]],
      [.64, [-.12,.24,-.08], [-.3,.6,-.75], [.75,.5,-.2]],
      [.76, [-.28,.48,-.04], [-.6,.3,-.75], [.3,.85,-.3]],
      [.86, [-.27,.45,0], [-.55,.3,-.78], [.3,.85,-.2]],
      [1, [-.15,.22,-.05], [-.1,.2,-.98], [.55,.75,.1]],
    ], [[.24,[0,.55,-1.6],.04], [.34,[.2,.02,-.5],.45],
      [.55,[.45,.02,1.05],1.3,true], [.86,[-.05,.02,-2.25],.05], [.93,[-.08,.15,-2.6]]],
      swipe([[16,82],[34,68],[50,52],[66,34],[80,20]])),
    SERVE_TOP: stroke('SERVE_TOP', 'fh', 2.8, .36, .7, [
      [0, [-.02,.06,.14], [-.08,.35,-.93], [.8,-.2,-.45]],
      [.18, [.04,.05,.18], [-.1,.42,-.9], [.8,-.25,-.45]],
      [.36, [.08,.02,.22], [-.12,.5,-.86], [.8,-.3,-.4]],
      [.48, [.04,0,.1], [-.14,.53,-.84], [.8,-.32,-.4]],
      [.55, [0,0,0], [-.15,.55,-.82], [.8,-.33,-.35]],
      [.63, [-.04,.03,-.05], [-.2,.5,-.84], [.78,-.3,-.35]],
      [.72, [-.07,.06,-.07], [-.24,.42,-.87], [.75,-.25,-.4]],
      [.85, [-.05,.06,.02], [-.16,.4,-.9], [.78,-.2,-.45]],
      [1, [-.02,.06,.14], [-.08,.35,-.93], [.8,-.2,-.45]],
    ], [[.1,[.14,.05,.2],.24], [.55,[.2,.13,.16],.05,true],
      [.64,[.08,.02,-.45],.19], [.8,[-.05,.02,-1.95],.02], [.88,[-.08,.03,-2.3]]],
      swipe([[30,72],[46,60],[62,46],[78,32]], 'swipe', 0, true)),
    SERVE_BACK: stroke('SERVE_BACK', 'fh', 2.8, .36, .7, [
      [0, [-.04,.1,.12], [-.1,.45,-.89], [.8,-.1,-.5]],
      [.18, [.03,.08,.16], [-.1,.55,-.83], [.8,-.2,-.5]],
      [.36, [.06,.04,.22], [-.12,.68,-.72], [.8,-.25,-.5]],
      [.48, [.03,0,.09], [-.13,.73,-.67], [.8,-.27,-.5]],
      [.55, [0,0,0], [-.15,.75,-.65], [.8,-.3,-.45]],
      [.62, [-.05,0,-.06], [-.2,.78,-.6], [.8,-.3,-.45]],
      [.7, [-.08,.01,-.08], [-.22,.78,-.58], [.8,-.3,-.45]],
      [.84, [-.07,.05,0], [-.15,.6,-.78], [.8,-.2,-.5]],
      [1, [-.04,.1,.12], [-.1,.45,-.89], [.8,-.1,-.5]],
    ], [[.1,[.12,.04,.2],.26], [.55,[.22,.07,.16],.04,true],
      [.64,[.1,.02,-.4],.2], [.8,[-.05,.02,-1.95],.01], [.88,[-.08,.03,-2.3]]],
      swipe([[26,34],[44,46],[62,56],[80,66]], 'swipe', 0, true)),
    SERVE_SIDE: stroke('SERVE_SIDE', 'fh', 2.8, .36, .7, [
      [0, [-.16,.08,.16], [-.45,.35,-.82], [.7,-.2,-.4]],
      [.18, [-.04,.06,.2], [-.5,.42,-.76], [.65,-.25,-.45]],
      [.36, [.14,.03,.22], [-.55,.5,-.67], [.55,-.3,-.5]],
      [.48, [.06,0,.1], [-.57,.53,-.62], [.5,-.32,-.5]],
      [.55, [0,0,0], [-.58,.55,-.6], [.45,-.33,-.45]],
      [.63, [-.1,0,-.06], [-.62,.55,-.55], [.4,-.3,-.45]],
      [.72, [-.18,.02,-.08], [-.65,.52,-.54], [.35,-.28,-.45]],
      [.85, [-.12,.05,.02], [-.55,.45,-.7], [.55,-.22,-.45]],
      [1, [-.16,.08,.16], [-.45,.35,-.82], [.7,-.2,-.4]],
    ], [[.1,[.1,.05,.2],.22], [.55,[.18,.12,.16],.04,true],
      [.64,[.05,.02,-.5],.24], [.78,[-.25,.02,-1.6],.05], [.9,[-.45,.03,-2.15]]],
      swipe([[16,52],[40,51],[64,51],[86,53]], 'swipe', 0, true)),
    SERVE_FAST: stroke('SERVE_FAST', 'fh', 2.5, .38, .7, [
      [0, [-.04,.1,.2], [-.08,.12,-.99], [.8,-.1,-.5]],
      [.2, [.04,.08,.22], [-.09,.16,-.98], [.8,-.15,-.5]],
      [.4, [.08,.04,.24], [-.1,.2,-.97], [.8,-.2,-.45]],
      [.5, [.04,.01,.1], [-.1,.22,-.97], [.8,-.2,-.4]],
      [.55, [0,0,0], [-.1,.24,-.96], [.8,-.2,-.35]],
      [.62, [-.06,0,-.08], [-.15,.28,-.95], [.78,-.2,-.35]],
      [.7, [-.1,.01,-.12], [-.2,.3,-.93], [.75,-.18,-.4]],
      [.84, [-.08,.05,0], [-.14,.25,-.96], [.78,-.15,-.45]],
      [1, [-.04,.1,.2], [-.08,.12,-.99], [.8,-.1,-.5]],
    ], [[.08,[.12,.04,.2],.24], [.55,[.2,.1,.18],.03,true],
      [.63,[.12,.02,-.7],.17], [.78,[.05,.02,-2.2],0], [.88,[0,.02,-2.62]]],
      swipe([[24,42],[44,46],[66,52],[84,57]], 'swipe', 0, true)),
    // Project-owned compact wrist arc, absorbing cut and neutral serve.
    BANANA: stroke('BANANA', 'bh', 2.2, .42, .7, [
      [0, [.04,.02,.15], [.1,-.05,-1], [-.6,.75,.1]],
      [.2, [.045,-.015,.10], [.2,.12,-.97], [-.65,.55,-.35]],
      [.42, [.06,-.035,.06], [.35,.16,-.92], [-.7,.35,-.45]],
      [.5, [.035,-.025,.025], [.42,-.02,-.91], [-.72,.38,-.3]],
      [.55, [0,0,0], [.38,-.24,-.89], [-.75,.45,-.12]],
      [.61, [-.06,.045,-.035], [.15,-.36,-.92], [-.65,.6,.12]],
      [.7, [-.085,.07,-.025], [-.08,-.32,-.95], [-.5,.75,.18]],
      [.84, [-.01,.04,.05], [.04,-.15,-.99], [-.55,.75,.1]],
      [1, [.04,.02,.15], [.1,-.05,-1], [-.6,.75,.1]],
    ], [[.26,[.1,.22,-1.6],.05], [.46,[-.10,.02,-.5],.08],
      [.55,[-.16,.16,-.3],.15,true], [.73,[.2,.02,-1.85],.06], [.85,[.35,.05,-2.35]]],
      swipe([[60,64],[47,61],[42,53],[48,45],[59,42]], 'swipe', -1), 'project'),
    CHOP_BLOCK: stroke('CHOP_BLOCK', 'bh', 2.2, .42, .69, [
      [0, [.035,.015,.13], [.08,-.1,-.99], [-.65,.7,.05]],
      [.2, [.03,.04,.09], [.1,.08,-.99], [-.7,.65,.08]],
      [.42, [.02,.055,.055], [.12,.26,-.96], [-.75,.55,.15]],
      [.5, [.008,.024,.02], [.13,.32,-.94], [-.8,.48,.18]],
      [.55, [0,0,0], [.13,.35,-.93], [-.8,.45,.2]],
      [.61, [-.006,-.04,-.02], [.15,.4,-.9], [-.8,.4,.24]],
      [.69, [-.01,-.055,-.015], [.13,.35,-.93], [-.78,.45,.2]],
      [.84, [.015,-.005,.06], [.1,.05,-.99], [-.7,.65,.08]],
      [1, [.035,.015,.13], [.08,-.1,-.99], [-.65,.7,.05]],
    ], [[.30,[.18,.27,-1.6],.06], [.46,[-.015,.02,-.45],.1],
      [.55,[-.06,.17,-.16],.14,true], [.74,[.12,.02,-1.75],.03], [.84,[.15,.03,-2.1]]],
      swipe([[47,43],[48,48],[49,54],[50,59]]), 'project'),
    SERVE_NO_SPIN: stroke('SERVE_NO_SPIN', 'fh', 2.6, .42, .7, [
      [0, [-.025,.035,.12], [-.08,.15,-.99], [.8,.25,-.25]],
      [.2, [.02,.03,.11], [-.08,.17,-.98], [.8,.25,-.25]],
      [.42, [.03,.02,.07], [-.08,.18,-.98], [.8,.25,-.25]],
      [.5, [.012,.006,.026], [-.08,.18,-.98], [.8,.25,-.25]],
      [.55, [0,0,0], [-.08,.18,-.98], [.8,.25,-.25]],
      [.61, [-.015,-.004,-.034], [-.08,.18,-.98], [.8,.25,-.25]],
      [.7, [-.022,-.005,-.05], [-.08,.18,-.98], [.8,.25,-.25]],
      [.84, [-.015,.02,.035], [-.08,.16,-.99], [.8,.25,-.25]],
      [1, [-.025,.035,.12], [-.08,.15,-.99], [.8,.25,-.25]],
    ], [[.1,[.12,.04,.2],.24], [.55,[.18,.12,.18],.04,true],
      [.65,[.08,.02,-.45],.19], [.8,[-.05,.02,-1.8],.02], [.9,[-.08,.03,-2.2]]],
      swipe([[50,50]], 'tap', 0, true), 'project'),
  } });

  const dotQ = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const finiteV = v => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  const arrayV = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const unitQ = q => {
    const l = Math.hypot(q.x, q.y, q.z, q.w);
    if (!Number.isFinite(l) || l < 1e-9) throw new RangeError('Invalid stroke quaternion');
    q.x /= l; q.y /= l; q.z /= l; q.w /= l;
    return q;
  };
  // Allocation-free orthonormal frame. Local +Y=head, activeFace*+Z=normal.
  function frame(out, normal, up, activeFace, penhold = false) {
    if (!finiteV(normal) || !finiteV(up) || V3.len2(normal) < 1e-16)
      throw new RangeError('Invalid stroke normal/up');
    V3.norm(out.n, normal);
    const n = out.n, d = V3.dot(up, n);
    let ux = up.x - n.x * d, uy = up.y - n.y * d, uz = up.z - n.z * d;
    // Project vertical; near a vertical normal use Z as the head reference.
    let bx = -n.x * n.y, by = 1 - n.y * n.y, bz = -n.z * n.y;
    let l = Math.hypot(bx, by, bz);
    if (l < 1e-8) { bx = -n.x * n.z; by = -n.y * n.z; bz = 1 - n.z * n.z; l = Math.hypot(bx, by, bz); }
    bx /= l; by /= l; bz /= l;
    l = Math.hypot(ux, uy, uz);
    if (l < 1e-8) { ux = bx; uy = by; uz = bz; }
    else { ux /= l; uy /= l; uz /= l; }
    if (penhold) {
      // Handle-up without reversing lateral lean or the striking rubber.
      const vertical = 2 * (ux * bx + uy * by + uz * bz);
      ux -= vertical * bx; uy -= vertical * by; uz -= vertical * bz;
    }
    V3.set(out.up, ux, uy, uz);
    const zx = n.x * activeFace, zy = n.y * activeFace, zz = n.z * activeFace;
    const xx = uy * zz - uz * zy, xy = uz * zx - ux * zz, xz = ux * zy - uy * zx;
    const q = out.q, tr = xx + uy + zz;
    if (tr > 0) {
      const s = Math.sqrt(tr + 1) * 2;
      q.w = .25 * s; q.x = (uz - zy) / s; q.y = (zx - xz) / s; q.z = (xy - ux) / s;
    } else if (xx > uy && xx > zz) {
      const s = Math.sqrt(1 + xx - uy - zz) * 2;
      q.w = (uz - zy) / s; q.x = .25 * s; q.y = (ux + xy) / s; q.z = (zx + xz) / s;
    } else if (uy > zz) {
      const s = Math.sqrt(1 + uy - xx - zz) * 2;
      q.w = (zx - xz) / s; q.x = (ux + xy) / s; q.y = .25 * s; q.z = (zy + uz) / s;
    } else {
      const s = Math.sqrt(1 + zz - xx - uy) * 2;
      q.w = (xy - ux) / s; q.x = (zx + xz) / s; q.y = (zy + uz) / s; q.z = .25 * s;
    }
    unitQ(q);
  }
  function rotate(out, q, v) {
    const x = v.x, y = v.y, z = v.z;
    const tx = 2 * (q.y * z - q.z * y), ty = 2 * (q.z * x - q.x * z), tz = 2 * (q.x * y - q.y * x);
    return V3.set(out, x + q.w * tx + q.y * tz - q.z * ty,
      y + q.w * ty + q.z * tx - q.x * tz, z + q.w * tz + q.x * ty - q.y * tx);
  }
  function directions(out, activeFace) {
    const q = out.q, x = q.x, y = q.y, z = q.z, w = q.w;
    V3.set(out.n, 2 * (x * z + w * y) * activeFace,
      2 * (y * z - w * x) * activeFace, (1 - 2 * (x * x + y * y)) * activeFace);
    V3.set(out.up, 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x));
  }
  function surface(out, localPoint) {
    rotate(out.point, out.q, localPoint);
    V3.cross(out.vR, out.w, out.point);
    V3.add(out.vR, out.vR, out.v);
    V3.add(out.point, out.point, out.p);
  }
  function createStrokeTemplateOutput() {
    return { p: V3.new(), q: Q.new(), n: V3.new(), up: V3.new(), v: V3.new(), w: V3.new(),
      point: V3.new(), vR: V3.new(), phase: 0, stage: 'ready', activeFace: 1 };
  }

  /** Input data uses game-world absolute ballReference and untranslated dp.
   * side=-1 rotates about table Y (X AND Z); hand/FH-BH reflect only X.
   * No implicit DRIVE fallback. Compile once per variant, share read-only. */
  function compileStrokeTemplate(idOrData, options = {}) {
    const data = typeof idOrData === 'string' ? PADDLE_TEMPLATES.strokes[idOrData.toUpperCase()] : idOrData;
    if (!data || !Array.isArray(data.keys) || data.keys.length < 3 || !Array.isArray(data.ballReference))
      throw new RangeError('Unknown or invalid stroke template');
    const contacts = data.ballReference.filter(b => b.contact === true);
    if (contacts.length !== 1) throw new RangeError('Stroke needs exactly one contact marker');
    const marker = contacts[0], tc = marker.t, ck = data.keys.find(k => Math.abs(k.t - tc) < 1e-9);
    const duration = options.duration ?? data.duration;
    if (!ck || !Number.isFinite(tc) || !(tc > data.backT && tc < data.finishT) ||
        !(data.backT > 0 && data.finishT < 1) || !Number.isFinite(duration) || duration <= 0 ||
        !['fh', 'bh'].includes(data.hand) || !arrayV(marker.p))
      throw new RangeError('Invalid stroke contact phase/duration');
    if ((options.side !== undefined && options.side !== 1 && options.side !== -1) ||
        (options.hand !== undefined && !['right', 'left'].includes(options.hand)) ||
        (options.grip !== undefined && !['shakehand', 'penhold'].includes(options.grip)) ||
        (options.forehand !== undefined && typeof options.forehand !== 'boolean'))
      throw new RangeError('Invalid stroke side/hand/grip');
    const side = options.side ?? 1, hand = options.hand ?? 'right', grip = options.grip ?? 'shakehand';
    const forehand = options.forehand ?? (data.hand === 'fh'), activeFace = forehand ? 1 : -1;
    const mirror = (hand === 'left' ? -1 : 1) * (forehand === (data.hand === 'fh') ? 1 : -1);
    const sx = mirror * side, sz = side;
    const contact = createStrokeTemplateOutput();
    const normal = V3.new(), up = V3.new();
    for (let i = 0; i < data.keys.length; i++) {
      const k = data.keys[i];
      if (!Number.isFinite(k.t) || k.t < 0 || k.t > 1 || (i && k.t <= data.keys[i - 1].t) ||
          !arrayV(k.dp) || !arrayV(k.n) || !arrayV(k.up)) throw new RangeError('Invalid stroke key');
    }
    if (data.keys[0].t !== 0 || data.keys[data.keys.length - 1].t !== 1)
      throw new RangeError('Stroke keys must span phases 0..1');
    V3.set(normal, ck.n[0] * sx, ck.n[1], ck.n[2] * sz);
    V3.set(up, ck.up[0] * sx, ck.up[1], ck.up[2] * sz);
    frame(contact, normal, up, activeFace, grip === 'penhold');
    const localPoint = V3.new(0, geometry.sweetOffset, activeFace * geometry.rubberOffset);
    const ballP = V3.new(marker.p[0] * sx, marker.p[1], marker.p[2] * sz);
    V3.addScaled(contact.point, ballP, contact.n, -geometry.ballRadius);
    rotate(contact.p, contact.q, localPoint);
    V3.sub(contact.p, contact.point, contact.p);
    const keys = data.keys.map(k => {
      const pose = { t: k.t, p: V3.new(contact.p.x + (k.dp[0] - ck.dp[0]) * sx,
        contact.p.y + k.dp[1] - ck.dp[1], contact.p.z + (k.dp[2] - ck.dp[2]) * sz),
      q: Q.new(), n: V3.new(), up: V3.new(), dp: V3.new(), dq: Q.new(0, 0, 0, 0) };
      V3.set(normal, k.n[0] * sx, k.n[1], k.n[2] * sz);
      V3.set(up, k.up[0] * sx, k.up[1], k.up[2] * sz);
      frame(pose, normal, up, activeFace, grip === 'penhold');
      return pose;
    });
    for (let i = 1; i < keys.length; i++) if (dotQ(keys[i - 1].q, keys[i].q) < 0) {
      const q = keys[i].q; q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w;
    }
    const loop = options.loop === true, last = keys.length - 1;
    if (loop && (V3.dist(keys[0].p, keys[last].p) > 1e-8 || Math.abs(dotQ(keys[0].q, keys[last].q)) < 1 - 1e-8))
      throw new RangeError('Looped stroke must close its pose');
    const cycleSign = dotQ(keys[0].q, keys[last].q) < 0 ? -1 : 1;
    for (let i = 0; i <= last; i++) {
      if (!loop && (i === 0 || i === last)) continue;
      const a = keys[i === 0 ? last - 1 : i - 1], b = keys[i === last ? 1 : i + 1];
      const dt = b.t + (i === last ? 1 : 0) - a.t + (i === 0 ? 1 : 0);
      V3.sub(keys[i].dp, b.p, a.p); V3.mul(keys[i].dp, keys[i].dp, 1 / dt);
      const sa = i === 0 ? cycleSign : 1, sb = i === last ? cycleSign : 1, dq = keys[i].dq;
      dq.x = (b.q.x * sb - a.q.x * sa) / dt; dq.y = (b.q.y * sb - a.q.y * sa) / dt;
      dq.z = (b.q.z * sb - a.q.z * sa) / dt; dq.w = (b.q.w * sb - a.q.w * sa) / dt;
    }
    const sr = data.swipeReference;
    const motion = { id: data.id, sourceId: data.sourceId, side, hand, forehand, grip, activeFace,
      duration, loop, contactPhase: tc, readyPhase: data.keys[1].t, backPhase: data.backT,
      finishPhase: data.finishT, localPoint, keys, contact,
      ballReference: data.ballReference.map(b => {
        if (!arrayV(b.p) || !Number.isFinite(b.t) || !Number.isFinite(b.h)) throw new RangeError('Invalid ball reference');
        return { ...b, p: [b.p[0] * sx, b.p[1], b.p[2] * sz] };
      }),
      // Screen reference is player-local, so changing court side does not flip it.
      swipeReference: sr ? { ...sr, pts: sr.pts.map(p => [mirror < 0 ? 100 - p[0] : p[0], p[1]]),
        curl: sr.curl * mirror, window: { ...sr.window } } : null,
    };
    sampleStrokeTemplate(motion, tc, contact);
    contact.ballP = ballP;
    return freeze(motion);
  }

  /** phase is normalized, not seconds. Pass createStrokeTemplateOutput() to
   * avoid all per-sample allocations. v=center velocity, w=world angular
   * velocity, point/vR=the moving material point on the active rubber. */
  function sampleStrokeTemplate(motion, phase, out = createStrokeTemplateOutput()) {
    const compiled = motion.compiled || motion, keys = compiled.keys;
    if (!keys) throw new RangeError('Compile the stroke before sampling');
    const tIn = Number.isFinite(phase) ? phase : 0;
    const t = compiled.loop ? tIn - Math.floor(tIn) : Math.max(0, Math.min(1, tIn));
    let j = 0;
    while (j < keys.length - 2 && keys[j + 1].t <= t) j++;
    const a = keys[j], b = keys[j + 1], dt = b.t - a.t, u = (t - a.t) / dt, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const d00 = (6 * u2 - 6 * u) / dt, d10 = 3 * u2 - 4 * u + 1;
    const d01 = (-6 * u2 + 6 * u) / dt, d11 = 3 * u2 - 2 * u;
    const invDuration = 1 / motion.duration;
    V3.set(out.p, h00 * a.p.x + h10 * dt * a.dp.x + h01 * b.p.x + h11 * dt * b.dp.x,
      h00 * a.p.y + h10 * dt * a.dp.y + h01 * b.p.y + h11 * dt * b.dp.y,
      h00 * a.p.z + h10 * dt * a.dp.z + h01 * b.p.z + h11 * dt * b.dp.z);
    V3.set(out.v, (d00 * a.p.x + d10 * a.dp.x + d01 * b.p.x + d11 * b.dp.x) * invDuration,
      (d00 * a.p.y + d10 * a.dp.y + d01 * b.p.y + d11 * b.dp.y) * invDuration,
      (d00 * a.p.z + d10 * a.dp.z + d01 * b.p.z + d11 * b.dp.z) * invDuration);
    // Non-uniform quaternion Hermite with hemisphere-aligned keys. Normalize
    // its derivative too, rather than using a finite-difference surface speed.
    let x = h00 * a.q.x + h10 * dt * a.dq.x + h01 * b.q.x + h11 * dt * b.dq.x;
    let y = h00 * a.q.y + h10 * dt * a.dq.y + h01 * b.q.y + h11 * dt * b.dq.y;
    let z = h00 * a.q.z + h10 * dt * a.dq.z + h01 * b.q.z + h11 * dt * b.dq.z;
    let w = h00 * a.q.w + h10 * dt * a.dq.w + h01 * b.q.w + h11 * dt * b.dq.w;
    const l = Math.hypot(x, y, z, w); x /= l; y /= l; z /= l; w /= l;
    out.q.x = x; out.q.y = y; out.q.z = z; out.q.w = w;
    let dx = d00 * a.q.x + d10 * a.dq.x + d01 * b.q.x + d11 * b.dq.x;
    let dy = d00 * a.q.y + d10 * a.dq.y + d01 * b.q.y + d11 * b.dq.y;
    let dz = d00 * a.q.z + d10 * a.dq.z + d01 * b.q.z + d11 * b.dq.z;
    let dw = d00 * a.q.w + d10 * a.dq.w + d01 * b.q.w + d11 * b.dq.w;
    const radial = x * dx + y * dy + z * dz + w * dw;
    dx = (dx - x * radial) / l; dy = (dy - y * radial) / l;
    dz = (dz - z * radial) / l; dw = (dw - w * radial) / l;
    V3.set(out.w, 2 * (-dw * x + dx * w - dy * z + dz * y) * invDuration,
      2 * (-dw * y + dx * z + dy * w - dz * x) * invDuration,
      2 * (-dw * z - dx * y + dy * x + dz * w) * invDuration);
    if (motion.compiled) {
      V3.sub(out.p, out.p, compiled.contact.p); rotate(out.p, motion.rotation, out.p);
      V3.add(out.p, out.p, motion.contact.p);
      rotate(out.v, motion.rotation, out.v); rotate(out.w, motion.rotation, out.w);
      Q.mul(out.q, motion.rotation, out.q);
      // C1 compact correction: zero displacement at contact and both ends,
      // unit time derivative at contact, zero derivative outside the window.
      const tc = compiled.contactPhase, lo = compiled.backPhase, hi = compiled.finishPhase;
      let f = 0, df = 0;
      if (t > lo && t <= tc) {
        const s = (t - lo) / (tc - lo);
        f = (s * s * s - s * s) * (tc - lo); df = 3 * s * s - 2 * s;
      } else if (t > tc && t < hi) {
        const s = (t - tc) / (hi - tc);
        f = (s * s * s - 2 * s * s + s) * (hi - tc); df = 3 * s * s - 4 * s + 1;
      }
      V3.addScaled(out.p, out.p, motion.velocityDelta, f * motion.duration);
      V3.addScaled(out.v, out.v, motion.velocityDelta, df);
    }
    if (!compiled.loop && (tIn < 0 || tIn > 1)) { V3.zero(out.v); V3.zero(out.w); }
    directions(out, compiled.activeFace);
    surface(out, motion.localPoint);
    out.phase = t; out.activeFace = compiled.activeFace;
    out.stage = t < compiled.readyPhase ? 'ready' : t < compiled.backPhase ? 'backswing'
      : t < compiled.contactPhase - .012 ? 'swing' : t < compiled.contactPhase + .015 ? 'contact'
        : t < compiled.finishPhase ? 'follow' : 'recover';
    return out;
  }

  /** Exactly ONE anchor, all in game-world coordinates:
   * point=actual RUBBER surface; ballP=ball CENTER before launch separation;
   * p=authoritative blade center (no offsets). Explicit q/up is the actual
   * blade pose, not a grip recipe. localPoint is blade-local (V3 or tuple),
   * defaults to the sweet point; vR is velocity there, not at blade center.
   * Reuse out while tracking a predicted contact; snapshot it after impact. */
  function retargetStrokeTemplate(compiled, target, out) {
    if (!compiled || compiled.compiled || !compiled.keys || !compiled.contact || !target)
      throw new RangeError('Retarget needs a compiled stroke and contact');
    const anchors = Number(target.point !== undefined) + Number(target.ballP !== undefined) + Number(target.p !== undefined);
    const anchor = target.point ?? target.ballP ?? target.p;
    const duration = target.duration ?? compiled.duration;
    if (anchors !== 1 || !finiteV(anchor) || !Number.isFinite(duration) || duration <= 0 ||
        (target.vR !== undefined && !finiteV(target.vR))) throw new RangeError('Invalid retarget anchor/duration/velocity');
    if (!out) out = { contact: createStrokeTemplateOutput(), rotation: Q.new(), velocityDelta: V3.new(),
      localPoint: V3.new(), _inverse: Q.new(), _offset: V3.new(), _normal: V3.new(), _up: V3.new() };
    const contact = out.contact, base = compiled.contact;
    if (target.q) {
      unitQ(Q.copy(contact.q, target.q)); directions(contact, compiled.activeFace);
      if (target.normal !== undefined) {
        if (!finiteV(target.normal) || V3.len2(target.normal) < 1e-16) throw new RangeError('Invalid retarget normal');
        V3.norm(out._normal, target.normal);
        if (V3.dist(out._normal, contact.n) > 1e-6) throw new RangeError('Quaternion and active normal disagree');
      }
      if (target.up !== undefined) {
        if (!finiteV(target.up)) throw new RangeError('Invalid retarget up');
        V3.addScaled(out._up, target.up, contact.n, -V3.dot(target.up, contact.n));
        if (V3.len2(out._up) < 1e-16) throw new RangeError('Quaternion and blade head disagree');
        V3.norm(out._up, out._up);
        if (V3.dist(out._up, contact.up) > 1e-6) throw new RangeError('Quaternion and blade head disagree');
      }
    } else {
      frame(contact, target.normal ?? base.n, target.up ?? base.up, compiled.activeFace);
    }
    if (dotQ(contact.q, base.q) < 0) {
      contact.q.x = -contact.q.x; contact.q.y = -contact.q.y;
      contact.q.z = -contact.q.z; contact.q.w = -contact.q.w;
    }
    V3.copy(out.localPoint, compiled.localPoint);
    if (target.localPoint !== undefined) {
      const lp = target.localPoint;
      const tuple = arrayV(lp);
      if (!tuple && !finiteV(lp)) throw new RangeError('Invalid local contact point');
      const x = tuple ? lp[0] : lp.x, y = tuple ? lp[1] : lp.y, z = tuple ? lp[2] : lp.z;
      if (Math.abs(z - compiled.activeFace * geometry.rubberOffset) > 1e-8)
        throw new RangeError('localPoint must lie on the active rubber surface');
      V3.set(out.localPoint, x, y, z);
    }
    rotate(out._offset, contact.q, out.localPoint);
    if (target.p) {
      V3.copy(contact.p, target.p); V3.add(contact.point, contact.p, out._offset);
    } else {
      V3.copy(contact.point, anchor);
      if (target.ballP) V3.addScaled(contact.point, contact.point, contact.n, -geometry.ballRadius);
      V3.sub(contact.p, contact.point, out._offset);
    }
    out._inverse.x = -base.q.x; out._inverse.y = -base.q.y; out._inverse.z = -base.q.z; out._inverse.w = base.q.w;
    unitQ(Q.mul(out.rotation, contact.q, out._inverse));
    const rate = compiled.duration / duration;
    rotate(contact.v, out.rotation, base.v); V3.mul(contact.v, contact.v, rate);
    rotate(contact.w, out.rotation, base.w); V3.mul(contact.w, contact.w, rate);
    V3.cross(contact.vR, contact.w, out._offset); V3.add(contact.vR, contact.vR, contact.v);
    V3.zero(out.velocityDelta);
    if (target.vR) {
      V3.sub(out.velocityDelta, target.vR, contact.vR);
      V3.add(contact.v, contact.v, out.velocityDelta); V3.copy(contact.vR, target.vR);
    }
    if (!contact.ballP) contact.ballP = V3.new();
    V3.addScaled(contact.ballP, contact.point, contact.n, geometry.ballRadius);
    contact.phase = compiled.contactPhase; contact.stage = 'contact'; contact.activeFace = compiled.activeFace;
    out.compiled = compiled; out.duration = duration; out.contactPhase = compiled.contactPhase;
    return out;
  }
  return { PADDLE_TEMPLATES, compileStrokeTemplate, sampleStrokeTemplate,
    retargetStrokeTemplate, createStrokeTemplateOutput };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { PADDLE_TEMPLATES,
  compileStrokeTemplate, sampleStrokeTemplate, retargetStrokeTemplate, createStrokeTemplateOutput };
