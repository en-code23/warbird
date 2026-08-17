/*
 * Warbird menu theme — SuperCollider, rendered offline.
 *
 *   /Applications/SuperCollider.app/Contents/MacOS/sclang tools/build_music.scd
 *
 * Non-real-time on purpose: Score.recordNRT runs scsynth as a file-to-file
 * renderer, so this never opens the audio hardware. It is repeatable, it is
 * faster than the piece is long, and running it does not blast music out of
 * whatever machine happens to build the assets.
 *
 * The piece is a 16-bar loop at 72 BPM in D minor — i / VI / III / VII, four
 * bars each — scored for a filtered saw pad, a sub pulse standing in for a
 * distant engine, a sparse horn line and brushed percussion.
 *
 * Seamless looping: the loop is rendered TWICE back to back and the second
 * pass is what ships. By then the reverb tails and the noise bed have filled
 * in, so the extracted region starts in the same steady state it ends in —
 * splicing the first pass instead would start dry and audibly re-enter.
 */

(
var sr = 48000;
var bpm = 72;
var beat = 60 / bpm;
var bar = beat * 4;
var bars = 16;
var loopLen = bar * bars;          // 53.33 s
var total = (loopLen * 2) + 8;     // two passes plus room for the last tail
var bundles = List.new;
var nodeId = 1000;
var rvbBus = 20;
var outPath = "/tmp/warbird-music.aiff";

// note number -> Hz
var f = { |midi| midi.midicps };

var add = { |time, msg|
    bundles.add([time.max(0), msg]);
};

var play = { |time, def, args|
    nodeId = nodeId + 1;
    add.value(time, ['/s_new', def, nodeId, 0, 0] ++ args);
};

/* ------------------------------------------------------------- voices --- */

var defs = [
    // Filtered saw pad. Three detuned saws plus a sub, opened and closed by a
    // slow LFO so the chord breathes instead of sitting still.
    // `phase` is handed in per voice rather than randomised: the loop is
    // rendered twice and the second pass is what ships, so anything random
    // per-synth would make the two passes differ and the seam audible.
    SynthDef(\wbPad, { |out = 0, rvb = 20, freq = 220, amp = 0.1,
                       atk = 2.5, sus = 8, rel = 4, cutoff = 1100, pan = 0,
                       phase = 0|
        var env = EnvGen.kr(Env.linen(atk, sus, rel, 1, \sin), doneAction: 2);
        var lfo = SinOsc.kr(0.06, phase).range(0.65, 1.35);
        var sig = Mix([
            Saw.ar(freq * 0.9985) * 0.42,
            Saw.ar(freq * 1.0015) * 0.42,
            Saw.ar(freq * 2.001) * 0.12,
            SinOsc.ar(freq * 0.5) * 0.30
        ]);
        sig = RLPF.ar(sig, (cutoff * lfo).clip(120, 6000), 0.42);
        sig = sig * env * amp;
        sig = Pan2.ar(sig, pan);
        Out.ar(out, sig);
        Out.ar(rvb, sig * 0.30);
    }),

    // Low pulse. Short, round and slightly detuned — the throb under the pad.
    SynthDef(\wbBass, { |out = 0, rvb = 20, freq = 55, amp = 0.3, dur = 0.6|
        var env = EnvGen.kr(Env.perc(0.008, dur, 1, -4), doneAction: 2);
        var sig = (SinOsc.ar(freq) * 0.8) + (Saw.ar(freq * 1.002) * 0.22);
        sig = LPF.ar(sig, freq * 7);
        sig = sig * env * amp;
        Out.ar(out, Pan2.ar(sig, 0));
        Out.ar(rvb, Pan2.ar(sig * 0.12, 0));
    }),

    // Horn-ish melody: narrow VarSaw with a little vibrato, rolled off hard so
    // it sits behind the pad rather than on top of it.
    SynthDef(\wbHorn, { |out = 0, rvb = 20, freq = 440, amp = 0.11,
                        sus = 1.2, pan = 0|
        var env = EnvGen.kr(
            Env.new([0, 1, 0.82, 0], [0.14, sus, 0.55], [\sin, 0, \sin]),
            doneAction: 2);
        var vib = SinOsc.kr(4.6, 0, 0.0045, 1);
        var sig = Mix([
            VarSaw.ar(freq * vib, 0, 0.3) * 0.45,
            SinOsc.ar(freq * vib) * 0.38,
            SinOsc.ar(freq * vib * 2) * 0.10
        ]);
        sig = LPF.ar(sig, 2200);
        sig = sig * env * amp;
        Out.ar(out, Pan2.ar(sig, pan));
        Out.ar(rvb, Pan2.ar(sig * 0.45, pan));
    }),

    SynthDef(\wbKick, { |out = 0, amp = 0.34|
        var env = EnvGen.kr(Env.perc(0.002, 0.40, 1, -6), doneAction: 2);
        var fenv = EnvGen.kr(Env([124, 46, 34], [0.05, 0.3], \exp));
        Out.ar(out, Pan2.ar(SinOsc.ar(fenv) * env * amp, 0));
    }),

    SynthDef(\wbBrush, { |out = 0, rvb = 20, amp = 0.075, dur = 0.16, pan = 0.25|
        var env = EnvGen.kr(Env.perc(0.004, dur, 1, -3), doneAction: 2);
        var sig = BPF.ar(PinkNoise.ar(1), 2600, 0.8) * env * amp;
        Out.ar(out, Pan2.ar(sig, pan));
        Out.ar(rvb, Pan2.ar(sig * 0.4, pan));
    }),

    // Wind bed. Never the point, but it glues the rest together and gives the
    // loop point something continuous to hide behind.
    // This one synth spans the whole render, so its movement has to repeat with
    // the loop or the timbre jumps at the splice. Both the filter sweep and the
    // pan run at exact multiples of 1/loop, which LFNoise2 could never do.
    SynthDef(\wbAir, { |out = 0, amp = 0.030, sus = 60, loop = 53.333|
        var env = EnvGen.kr(Env.linen(6, sus, 6, 1, \sin), doneAction: 2);
        var sweep = (SinOsc.kr(2 / loop) * 0.6) + (SinOsc.kr(3 / loop, 1.7) * 0.4);
        var sig = BPF.ar(PinkNoise.ar(1), sweep.linexp(-1, 1, 220, 900), 0.5);
        sig = sig * env * amp;
        Out.ar(out, Pan2.ar(sig, SinOsc.kr(1 / loop) * 0.6));
    }),

    SynthDef(\wbVerb, { |in = 20, out = 0, room = 0.84, damp = 0.42, amp = 0.9|
        var sig = In.ar(in, 2);
        sig = FreeVerb2.ar(sig[0], sig[1], 1.0, room, damp);
        Out.ar(out, sig * amp);
    })
];

/* ------------------------------------------------------------ material -- */

// i - VI - III - VII in D minor, four bars each.
var chords = [
    [50, 53, 57, 62],   // Dm
    [46, 50, 53, 58],   // Bb
    [41, 45, 48, 53],   // F
    [48, 52, 55, 60]    // C
];
var roots = [38, 34, 41, 36];

// bar -> [[midi, beats] ...]; nil bars are rests
var melody = [
    nil, nil, nil, nil,
    [[57, 2], [53, 2]],
    [[50, 4]],
    nil,
    [[60, 2], [57, 2]],
    [[58, 4]],
    [[57, 2], [55, 2]],
    [[53, 4]],
    nil,
    [[55, 2], [57, 2]],
    [[60, 3]],
    [[57, 2], [53, 2]],
    [[50, 4]]
];

/* ------------------------------------------------------------ schedule -- */

defs.do { |d| add.value(0.0, ['/d_recv', d.asBytes]) };

// The reverb goes down first; every later voice is added to the head of the
// root group, which puts all of them in front of it.
nodeId = nodeId + 1;
add.value(0.0, ['/s_new', \wbVerb, nodeId, 0, 0, \in, rvbBus, \amp, 0.9]);

// One continuous wind bed under the whole render.
play.value(0.0, \wbAir, [\sus, total, \amp, 0.030, \loop, loopLen]);

2.do { |pass|
    var base = pass * loopLen;

    bars.do { |b|
        var barT = base + (b * bar);
        var chord = chords[(b / 4).floor.asInteger];
        var root = roots[(b / 4).floor.asInteger];

        // pad: one long chord per 4-bar section, struck on the section start
        if (b % 4 == 0) {
            chord.do { |n, i|
                play.value(barT, \wbPad, [
                    \freq, f.value(n),
                    \amp, 0.075,
                    \atk, 2.2,
                    \sus, (bar * 4) - 3.4,
                    \rel, 3.2,
                    \cutoff, 900 + (i * 190),
                    \pan, (i - 1.5) * 0.34,
                    \phase, i * 1.6
                ]);
            };
        };

        // bass pulse on 1 and 3, with the octave below on 1
        play.value(barT, \wbBass, [\freq, f.value(root), \amp, 0.26, \dur, 0.7]);
        play.value(barT, \wbBass, [\freq, f.value(root - 12), \amp, 0.20, \dur, 0.9]);
        play.value(barT + (beat * 2), \wbBass,
            [\freq, f.value(root), \amp, 0.17, \dur, 0.5]);

        // percussion from bar 3 onward
        if (b >= 2) {
            play.value(barT, \wbKick, [\amp, 0.30]);
            play.value(barT + (beat * 2), \wbKick, [\amp, 0.22]);
            play.value(barT + beat, \wbBrush, [\amp, 0.070, \pan, 0.28]);
            play.value(barT + (beat * 3), \wbBrush, [\amp, 0.070, \pan, -0.28]);
            play.value(barT + (beat * 3.5), \wbBrush, [\amp, 0.038, \pan, 0.1]);
        };

        // melody
        if (melody[b].notNil) {
            var t = barT;
            melody[b].do { |pair|
                var midi = pair[0];
                var beats = pair[1];
                play.value(t, \wbHorn, [
                    \freq, f.value(midi),
                    \amp, 0.105,
                    \sus, (beats * beat) - 0.5,
                    \pan, -0.12
                ]);
                t = t + (beats * beat);
            };
        };
    };
};

add.value(total, ['/c_set', 0, 0]);

/* -------------------------------------------------------------- render -- */

Score(bundles.asArray.sort { |a, b| a[0] <= b[0] }).recordNRT(
    outputFilePath: outPath,
    sampleRate: sr,
    headerFormat: "AIFF",
    sampleFormat: "int24",
    options: ServerOptions.new
        .numOutputBusChannels_(2)
        .numInputBusChannels_(0)
        .memSize_(65536),
    duration: total,
    action: {
        ("[warbird] rendered " ++ outPath
            ++ "  loop=" ++ loopLen.round(0.001)
            ++ "s  total=" ++ total.round(0.001) ++ "s").postln;
        0.exit;
    }
);
)
