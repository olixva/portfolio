"""Genera las variantes de sonido de la entrada del hero. Solo para desarrollo.

    python3 -m pip install --target ./py numpy scipy
    PYTHONPATH=./py python3 tools/hero-sound.py

Escribe tools/audio/NN-nombre.mp3, uno por variante, y el indice que consume
tools/sound.html. Nada de esto viaja a public/: son bocetos para elegir.

Los tiempos salen de la linea de tiempo real de hero3d.js. Si alli cambian las
duraciones, cambialas tambien en TIMELINE y vuelve a generar: el sonido tiene
que caer en el fotograma correcto, no aproximadamente.
"""
import json
import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import butter, sosfilt, sosfilt_zi, fftconvolve

SR = 48000
ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'audio'

# --- Linea de tiempo -----------------------------------------------------
# Espejo de runIntro() en public/js/hero/hero3d.js, en escritorio.
VIDEO = 2.00                 # intro.mp4: las dos gotas se buscan y se funden
TRANSFER = 0.16              # el overlay se apaga
RISE = 1.10                  # la pieza sube y se coloca
HANDOFF = VIDEO + TRANSFER + RISE - 0.55   # 2.71 el video cede al WebGL
GOLD = VIDEO + TRANSFER + RISE             # 3.26 giro corto en metal
GREEN = GOLD + 0.55                        # 3.81 barrido verde y particulas
END = GREEN + 1.35                         # 5.16 reposo: silencio
TAIL = 0.55                                # cola de reverb, ya en silencio visual
TOTAL = END + TAIL

N = int(TOTAL * SR)


# --- Utilidades ----------------------------------------------------------

def rng(seed):
    return np.random.default_rng(seed)


def secs(x):
    return int(round(x * SR))


def noise(n, gen, color='white'):
    """Ruido blanco o rosa. El rosa se acerca mas a lo que graba un microfono."""
    white = gen.standard_normal(n)
    if color == 'white':
        return white
    spectrum = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n, 1 / SR)
    freqs[0] = freqs[1] if len(freqs) > 1 else 1.0
    shape = freqs ** (-0.5 if color == 'pink' else -1.0)
    out = np.fft.irfft(spectrum * shape, n)
    # Sin normalizar, rosa y marron salen a niveles muy distintos del blanco.
    return out / (np.sqrt(np.mean(out ** 2)) + 1e-12)


def band(x, lo=None, hi=None, order=4):
    if lo and hi:
        sos = butter(order, [lo, hi], btype='bandpass', fs=SR, output='sos')
    elif lo:
        sos = butter(order, lo, btype='highpass', fs=SR, output='sos')
    elif hi:
        sos = butter(order, hi, btype='lowpass', fs=SR, output='sos')
    else:
        return x
    return sosfilt(sos, x)


def sweep_band(x, cutoff, kind='lowpass', order=4, block=1024, width=1.2):
    """Filtro con la frecuencia moviendose. Se procesa por bloques conservando
    el estado: a 1024 muestras el escalon no se oye y evita un bucle por
    muestra en Python. En bandpass, cutoff es el centro y width la anchura en
    octavas a cada lado."""
    nyquist = SR / 2
    cutoff = np.clip(np.asarray(cutoff, dtype=float), 25.0, nyquist - 200)
    out = np.zeros_like(x)
    zi = None
    for start in range(0, len(x), block):
        stop = min(start + block, len(x))
        f = float(np.mean(cutoff[start:stop]))
        if kind in ('bandpass', 'bandstop'):
            f = [max(20.0, f / 2 ** width), min(nyquist - 100, f * 2 ** width)]
        sos = butter(order, f, btype=kind, fs=SR, output='sos')
        if zi is None:
            zi = sosfilt_zi(sos) * x[start]
        chunk, zi = sosfilt(sos, x[start:stop], zi=zi)
        out[start:stop] = chunk
    return out


def env(n, attack, decay, hold=0.0, curve=2.0):
    """Ataque-sostenido-caida en muestras, con la caida exponencial."""
    a, h = secs(attack), secs(hold)
    d = max(1, n - a - h)
    parts = []
    if a:
        parts.append(np.linspace(0, 1, a) ** (1 / curve))
    if h:
        parts.append(np.ones(h))
    parts.append(np.exp(-np.linspace(0, curve * 3, d)))
    out = np.concatenate(parts)[:n]
    return np.pad(out, (0, max(0, n - len(out))))


def ramp(n, a=0.0, b=1.0, curve=1.0):
    return a + (b - a) * np.linspace(0, 1, n) ** curve


def sine(freq, n, phase=0.0):
    """freq puede ser escalar o por muestra: la fase se integra."""
    f = np.full(n, freq, dtype=float) if np.isscalar(freq) else np.asarray(freq, dtype=float)
    return np.sin(2 * np.pi * np.cumsum(f) / SR + phase)


def saw(freq, n, harmonics=14):
    out = np.zeros(n)
    for k in range(1, harmonics + 1):
        out += sine(np.multiply(freq, k), n) / k
    return out * (2 / np.pi)


def metal(n, base, ratios, decays, gen, detune=0.0):
    """Cuerpo metalico: parciales inarmonicos con caidas distintas. Es lo que
    separa un metal de una campana afinada."""
    out = np.zeros(n)
    for ratio, decay in zip(ratios, decays):
        f = base * ratio * (1 + detune * gen.standard_normal())
        out += np.sin(2 * np.pi * f * np.arange(n) / SR) * np.exp(-np.arange(n) / (decay * SR))
    return out / max(1, len(ratios) ** 0.5)


def bubble(n, f0, f1, gen, curve=3.0):
    """Gota: un barrido de tono corto y hacia arriba, la firma de un liquido."""
    f = f0 + (f1 - f0) * np.linspace(0, 1, n) ** curve
    return sine(f, n) * env(n, 0.002, 0.0, curve=2.5)


def reverb(stereo, tail, gen, damp=6000, mix=0.35, predelay=0.01):
    """Sala por convolucion con ruido que decae. Una respuesta distinta por
    canal: con la misma en los dos, la cola se colapsa al centro."""
    ir_n = secs(tail)
    dry_peak = np.max(np.abs(stereo)) + 1e-9
    wet = np.empty_like(stereo)
    for ch in range(stereo.shape[0]):
        ir = noise(ir_n, gen) * np.exp(-np.linspace(0, 7, ir_n))
        ir = band(ir, hi=damp)
        ir /= np.max(np.abs(ir)) + 1e-9
        tail_ch = fftconvolve(stereo[ch], ir)[:stereo.shape[1]]
        wet[ch] = np.roll(tail_ch, secs(predelay))
    wet /= np.max(np.abs(wet)) + 1e-9
    out = stereo * (1 - mix) + wet * dry_peak * mix
    peak = np.max(np.abs(out))
    # Margen de sobra: el codificador MP3 rebasa el pico del PCM.
    return out / peak * 0.72 if peak else out


def drive(x, amount=2.0):
    return np.tanh(x * amount) / np.tanh(amount)


def crush(x, bits=6, hold=8):
    step = 2 ** bits
    held = x[::hold].repeat(hold)[:len(x)]
    return np.round(held * step) / step


def converge(at, spread=0.85):
    """Panoramica de las gotas: empiezan separadas y se juntan al centro justo
    cuando el video las une. Son dos, y en estereo se tienen que oir como dos."""
    k = min(1.0, max(0.0, at / (VIDEO * 0.82))) ** 1.6
    return spread * (1 - k)


class Mix:
    """Lienzo estereo. place() coloca un sonido en un instante y una posicion."""

    def __init__(self):
        self.left = np.zeros(N)
        self.right = np.zeros(N)

    def place(self, x, at, gain=1.0, pan=0.0):
        start = secs(at)
        if start < 0:
            x = x[-start:]
            start = 0
        stop = min(N, start + len(x))
        if stop <= start:
            return
        x = x[:stop - start] * gain
        self.left[start:stop] += x * np.cos((pan + 1) * np.pi / 4)
        self.right[start:stop] += x * np.sin((pan + 1) * np.pi / 4)

    def stereo(self):
        out = np.stack([self.left, self.right])
        # El reposo es silencio: la caida arranca antes de END para que en la
        # marca no quede nada mas que cola de sala.
        fade = np.ones(N)
        start = secs(END - 0.35)
        fade[start:] = np.linspace(1, 0, N - start) ** 2.2
        out *= fade
        out = np.tanh(out * 1.15)
        peak = np.max(np.abs(out))
        return out / peak * 0.72 if peak else out


# --- Variantes -----------------------------------------------------------
# Cada una recorre los cuatro tiempos: gotas, solidificar, giro, verde.

def v_ferrofluido(g):
    """T2: humedo + metal + succion. Granular y organico."""
    m = Mix()
    n = secs(VIDEO)
    m.place(band(noise(n, g, 'pink'), 30, 90) * ramp(n, 0.2, 1.0), 0, 0.4)
    # Arrastre: limaduras moviendose. Es el cuerpo audible de las gotas, en la
    # banda que si sale por un altavoz pequeno.
    for side in (-1, 1):
        crawl = band(noise(n, g, 'pink'), 700, 4500)
        crawl *= 0.45 + 0.55 * (0.5 + 0.5 * np.sin(np.linspace(0, 22 + 7 * side, n)))
        m.place(sweep_band(crawl, 1100 + 600 * np.sin(np.linspace(side, 9 * side, n)),
                           'bandpass', 2) * ramp(n, 0.4, 1.0), 0, 0.5, 0.8 * side)
    for i in range(58):
        at = g.uniform(0, VIDEO * 0.92)
        d = secs(g.uniform(0.04, 0.13))
        f0 = g.uniform(260, 900)
        m.place(bubble(d, f0, f0 * g.uniform(2.5, 5.5), g), at,
                g.uniform(0.12, 0.3), converge(at) * g.choice([-1, 1]))
    # Succion: las gotas se estiran una hacia otra en el ultimo tercio.
    n = secs(1.0)
    pull = band(noise(n, g, 'pink'), 180, 2600) * ramp(n, 0.05, 1.0, 2.2)
    m.place(sweep_band(pull, ramp(n, 400, 3200, 2.0), 'lowpass'), VIDEO - 1.0, 0.5)
    m.place(sine(ramp(n, 70, 34, 0.6), n) * ramp(n, 0.2, 1.0), VIDEO - 1.0, 0.3)
    # Solidificar: crepitar cristalizando y el cuerpo metalico entrando.
    n = secs(1.1)
    grit = noise(n, g) * (g.random(n) > 0.988) * ramp(n, 1.0, 0.05, 0.7)
    m.place(band(grit, 900, 7000) * 3.2, HANDOFF - 0.35, 0.4)
    m.place(metal(secs(2.4), 148, [1, 2.37, 3.61, 5.12, 7.44], [1.5, 1.1, .8, .55, .35], g, .004),
            HANDOFF, 0.5)
    m.place(band(noise(secs(0.35), g), 40, 220) * env(secs(0.35), 0.002, 0), HANDOFF, 0.7)
    # Giro: un roce de aire corto.
    n = secs(0.55)
    m.place(sweep_band(band(noise(n, g, 'pink'), 500, 9000), ramp(n, 1400, 5200), 'bandpass', 2)
            * env(n, 0.15, 0, curve=1.4), GOLD, 0.3, -0.4)
    # Verde: el enjambre se desprende y se disuelve.
    n = secs(1.35)
    shimmer = noise(n, g) * (g.random(n) > 0.972)
    m.place(band(shimmer, 2600, 12000) * 3.0 * np.exp(-np.linspace(0, 3.4, n)), GREEN, 0.36)
    m.place(metal(n, 296, [1, 1.51, 2.42, 3.9], [.9, .7, .5, .35], g) * ramp(n, 1, 0, 1.4),
            GREEN, 0.22, 0.5)
    return reverb(m.stereo(), 1.3, g, 5200, 0.3)


def v_trailer(g):
    """Cine: subgrave, riser invertido, golpe y floracion."""
    m = Mix()
    n = secs(HANDOFF)
    m.place(sine(ramp(n, 28, 44, 1.4), n) * ramp(n, 0.3, 1.0, 1.7), 0, 0.8)
    # Riser: ruido subiendo de banda hasta el golpe.
    riser = band(noise(n, g, 'pink'), 200, 14000) * ramp(n, 0.12, 1.0, 1.4)
    m.place(sweep_band(riser, ramp(n, 300, 9000, 1.6), 'highpass', 2), 0, 0.5)
    m.place(sine(ramp(n, 180, 900, 3.0), n) * ramp(n, 0.0, 0.5, 3.5), 0, 0.3, 0.3)
    # Pulso de las dos gotas: golpes graves con cuerpo medio, acercandose.
    at, gap = 0.05, 0.42
    while at < VIDEO - 0.1:
        d = secs(0.5)
        hit = metal(d, 165, [1, 2.4, 4.1], [.35, .22, .14], g, .01)
        m.place(hit * env(d, 0.003, 0, curve=2.0), at, 0.34, converge(at))
        m.place(sine(ramp(d, 110, 55, 0.5), d) * env(d, 0.002, 0, curve=1.6), at, 0.3)
        at += gap
        gap *= 0.82
    # Golpe en el relevo, con cuerpo grave y cola metalica.
    n = secs(2.2)
    m.place(sine(ramp(n, 92, 32, 0.35), n) * env(n, 0.001, 0, curve=1.6), HANDOFF, 0.95)
    m.place(metal(n, 116, [1, 2.71, 4.13, 6.3], [1.8, 1.2, .8, .5], g, .006), HANDOFF, 0.45)
    m.place(band(noise(secs(0.5), g), 300, 9000) * env(secs(0.5), 0.001, 0, curve=2.2),
            HANDOFF, 0.4)
    # Giro y floracion verde.
    n = secs(0.55)
    m.place(sweep_band(band(noise(n, g, 'pink'), 400, 10000), ramp(n, 900, 6000), 'bandpass', 2)
            * env(n, 0.2, 0, curve=1.2), GOLD, 0.28, 0.45)
    n = secs(1.35)
    chord = sum(sine(f, n) for f in (110, 165, 220, 330, 440))
    m.place(chord / 5 * ramp(n, 0.0, 1.0, 0.35) * np.exp(-np.linspace(0, 2.6, n)), GREEN, 0.55)
    m.place(band(noise(n, g, 'pink'), 3000, 13000) * np.exp(-np.linspace(0, 4.0, n)), GREEN, 0.3)
    return reverb(m.stereo(), 1.8, g, 7000, 0.4)


def v_mercurio(g):
    """Agua y mercurio: gotas, viscosidad, chapoteo. Nada de sintetizador."""
    m = Mix()
    for i in range(96):
        at = g.uniform(0, VIDEO)
        d = secs(g.uniform(0.03, 0.1))
        f0 = g.uniform(240, 900)
        m.place(bubble(d, f0, f0 * g.uniform(3, 7), g, 2.2), at,
                g.uniform(0.12, 0.32), converge(at) * g.choice([-1, 1]))
    n = secs(1.2)
    m.place(band(noise(n, g, 'pink'), 60, 500) * ramp(n, 0.15, 1.0, 1.8), VIDEO - 1.2, 0.45)
    # Sorbo: viscosidad estirandose antes de la union.
    n = secs(0.8)
    slurp = band(noise(n, g, 'pink'), 200, 3000) * ramp(n, 0.1, 1.0, 2.5)
    m.place(sweep_band(slurp, ramp(n, 250, 2400, 1.6), 'lowpass'), VIDEO - 0.8, 0.55)
    m.place(sine(ramp(n, 220, 96, 1.2), n) * ramp(n, 0.3, 1.0), VIDEO - 0.8, 0.25)
    # Chapoteo que cuaja.
    n = secs(0.9)
    m.place(band(noise(n, g), 400, 6000) * env(n, 0.004, 0, curve=2.4), HANDOFF, 0.5)
    m.place(sine(ramp(n, 150, 60, 0.5), n) * env(n, 0.002, 0, curve=1.4), HANDOFF, 0.5)
    for i in range(22):
        d = secs(g.uniform(0.02, 0.07))
        f0 = g.uniform(300, 900)
        m.place(bubble(d, f0, f0 * 4, g), HANDOFF + g.uniform(0, 0.7),
                g.uniform(0.05, 0.14), g.uniform(-0.8, 0.8))
    n = secs(0.55)
    m.place(band(noise(n, g, 'pink'), 800, 5000) * env(n, 0.18, 0, curve=1.5), GOLD, 0.5)
    for i in range(10):
        d = secs(g.uniform(0.02, 0.06))
        f0 = g.uniform(400, 1100)
        m.place(bubble(d, f0, f0 * 3.5, g), GOLD + g.uniform(0, 0.45),
                g.uniform(0.08, 0.18), g.uniform(-0.8, 0.8))
    # Verde: efervescencia que se evapora.
    n = secs(1.35)
    fizz = noise(n, g) * (g.random(n) > 0.955)
    m.place(band(fizz, 1800, 11000) * 2.6 * np.exp(-np.linspace(0, 3.0, n)), GREEN, 0.85)
    for i in range(30):
        d = secs(g.uniform(0.015, 0.05))
        f0 = g.uniform(600, 1800)
        m.place(bubble(d, f0, f0 * 3, g), GREEN + g.uniform(0, 1.1) ** 1.6,
                g.uniform(0.04, 0.1), g.uniform(-0.9, 0.9))
    return reverb(m.stereo(), 1.0, g, 6000, 0.25)


def v_analogico(g):
    """Sintetizador clasico: sierras detune, barrido resonante, zap."""
    m = Mix()
    n = secs(HANDOFF)
    pad = saw(np.full(n, 110.0), n) + saw(np.full(n, 110.8), n) + saw(np.full(n, 165.0), n)
    pad *= ramp(n, 0.25, 1.0, 1.5)
    # El filtro abre desde el principio: cerrado en 180 Hz no salia del subgrave.
    m.place(sweep_band(pad / 3, ramp(n, 700, 4200, 1.3), 'lowpass', 6), 0, 0.55)
    m.place(sine(np.full(n, 27.5), n) * ramp(n, 0.4, 1.0), 0, 0.3)
    # Dos osciladores que laten y se juntan: las gotas buscandose.
    for side in (-1, 1):
        blip = saw(np.full(n, 220.0 if side > 0 else 293.66), n)
        blip *= (0.5 + 0.5 * np.sin(np.linspace(0, 26 + 6 * side, n))) ** 3
        pan = np.array([converge(i / SR) for i in range(0, n, 2048)]).mean()
        m.place(band(blip, 300, 5000) * ramp(n, 0.3, 1.0), 0, 0.3, pan * side)
    # Zap al solidificar: barrido resonante que se cierra de golpe.
    n = secs(1.4)
    zap = saw(ramp(n, 440, 110, 0.4), n) * env(n, 0.002, 0, curve=1.8)
    m.place(sweep_band(zap, ramp(n, 5200, 300, 0.5), 'lowpass', 6), HANDOFF, 0.38)
    m.place(sine(ramp(n, 110, 41, 0.35), n) * env(n, 0.001, 0, curve=1.5), HANDOFF, 0.42)
    # Giro: portamento corto.
    n = secs(0.55)
    glide = saw(ramp(n, 330, 495, 1.0), n) * env(n, 0.1, 0, curve=1.6)
    m.place(band(glide, 300, 6000), GOLD, 1.0, -0.35)
    m.place(band(saw(ramp(n, 660, 990, 1.0), n) * env(n, 0.12, 0, curve=1.4), 400, 7000),
            GOLD, 0.45, 0.4)
    # Verde: arpegio que se abre y se apaga.
    step = secs(0.135)
    for i, f in enumerate([220, 330, 440, 550, 660, 880, 1100, 1320]):
        d = secs(0.5)
        voice = saw(np.full(d, float(f)), d) * env(d, 0.004, 0, curve=2.6)
        m.place(band(voice, hi=7000), GREEN + i * step / SR,
                0.62 * (1 - i / 9), (i / 7) * 1.4 - 0.7)
    return reverb(m.stereo(), 1.4, g, 6500, 0.3)


def v_cristal(g):
    """Cristal: parciales vidriosos, casi musical, muy limpio."""
    m = Mix()
    n = secs(VIDEO)
    m.place(sine(np.full(n, 65.4), n) * ramp(n, 0.3, 1.0, 1.4), 0, 0.35)
    for i in range(18):
        d = secs(g.uniform(0.5, 1.3))
        base = g.choice([523.25, 659.25, 784.0, 987.77, 1174.66])
        m.place(metal(d, base, [1, 2.02, 3.05], [.8, .5, .3], g, .002)
                * env(d, 0.006, 0, curve=2.2), g.uniform(0, VIDEO * 0.9),
                g.uniform(0.07, 0.18), g.uniform(-0.9, 0.9))
    # Solidificar: racimo de campanas a la vez.
    n = secs(2.6)
    for f, pan in [(261.6, -0.6), (392.0, 0.0), (523.25, 0.55), (784.0, -0.3)]:
        m.place(metal(n, f, [1, 2.41, 4.07, 6.8], [2.0, 1.3, .8, .5], g, .003), HANDOFF, 0.3, pan)
    m.place(sine(ramp(n, 130, 65, 0.4), n) * env(n, 0.002, 0, curve=1.3), HANDOFF, 0.45)
    n = secs(0.55)
    m.place(band(noise(n, g), 4000, 14000) * env(n, 0.2, 0, curve=1.3), GOLD, 0.16)
    # Verde: purpurina que asciende y desaparece.
    n = secs(1.35)
    for i in range(34):
        d = secs(g.uniform(0.2, 0.6))
        f = g.uniform(1200, 5200)
        m.place(metal(d, f, [1, 2.1], [.4, .25], g) * env(d, 0.003, 0, curve=2.8),
                GREEN + g.uniform(0, 1.0) ** 1.4, g.uniform(0.05, 0.13), g.uniform(-1, 1))
    chord = sum(sine(f, n) for f in (523.25, 659.25, 784.0))
    m.place(chord / 3 * ramp(n, 0.0, 1.0, 0.4) * np.exp(-np.linspace(0, 3.2, n)), GREEN, 0.3)
    return reverb(m.stereo(), 1.5, g, 9000, 0.34)


def v_fragua(g):
    """Industrial: retumbe, roce de metal, yunque y vapor."""
    m = Mix()
    n = secs(HANDOFF)
    m.place(band(noise(n, g, 'brown'), 25, 120) * ramp(n, 0.4, 1.0), 0, 0.55)
    # Roce: ruido de banda estrecha resonando, moviendose.
    n = secs(VIDEO)
    scrape = band(noise(n, g, 'pink'), 700, 4200)
    m.place(sweep_band(scrape, 1200 + 700 * np.sin(np.linspace(0, 9, n)), 'bandpass', 3)
            * ramp(n, 0.2, 1.0, 1.2), 0, 0.45, -0.3)
    m.place(sweep_band(band(noise(n, g, 'pink'), 700, 4200),
                       1600 + 900 * np.sin(np.linspace(2, 11, n)), 'bandpass', 3)
            * ramp(n, 0.15, 0.9, 1.4), 0, 0.35, 0.4)
    # Yunque.
    n = secs(2.0)
    m.place(metal(n, 92, [1, 2.13, 3.77, 5.9, 8.4], [1.6, 1.0, .7, .45, .3], g, .008),
            HANDOFF, 0.6)
    m.place(band(noise(secs(0.3), g), 60, 400) * env(secs(0.3), 0.001, 0, curve=1.4),
            HANDOFF, 0.7)
    m.place(drive(band(noise(secs(0.12), g), 1500, 9000) * env(secs(0.12), 0.0005, 0), 3),
            HANDOFF, 0.35)
    n = secs(0.55)
    m.place(band(noise(n, g, 'pink'), 300, 3000) * env(n, 0.12, 0, curve=1.6), GOLD, 0.3, 0.35)
    # Verde: vapor que se libera y se agota.
    n = secs(1.35)
    steam = band(noise(n, g, 'pink'), 600, 6000)
    m.place(sweep_band(steam, ramp(n, 900, 3400, 0.6), 'bandpass', 2)
            * ramp(n, 0.0, 1.0, 0.25) * np.exp(-np.linspace(0, 2.8, n)), GREEN, 1.5)
    m.place(band(noise(n, g, 'pink'), 2500, 9000)
            * ramp(n, 0.0, 1.0, 0.3) * np.exp(-np.linspace(0, 3.2, n)), GREEN, 0.5)
    m.place(sine(ramp(n, 60, 38, 0.7), n) * np.exp(-np.linspace(0, 3.0, n)), GREEN, 0.3)
    return reverb(m.stereo(), 1.6, g, 4500, 0.32)


def v_minimo(g):
    """Casi musica: un acorde que se completa. Sin efectos, muy discreto."""
    m = Mix()

    def voice(f, at, dur, gain, pan=0.0, attack=0.35):
        n = secs(dur)
        tone = sine(np.full(n, float(f)), n) + 0.28 * sine(np.full(n, float(f) * 2), n)
        shape = np.minimum(ramp(n, 0, 1, 1.0) / max(attack / dur, 1e-3), 1.0)
        m.place(band(tone, hi=6000) * shape * np.exp(-np.linspace(0, 1.4, n)), at, gain, pan)

    voice(110, 0.0, HANDOFF, 0.5, 0.0, 0.9)             # gotas: la fundamental
    # La fundamental sola no sale de un altavoz pequeno: las dos octavas de
    # arriba, en tremolo lento y a un lado cada una, la hacen audible sin
    # romper lo discreto.
    for side, f in ((-1, 220.0), (1, 440.0)):
        n = secs(VIDEO + 0.4)
        tone = sine(np.full(n, f), n) * (0.55 + 0.45 * np.sin(np.linspace(0, 9 * -side, n)))
        pan = np.array([converge(i / SR) for i in range(0, n, 2048)]).mean() * side
        m.place(tone * ramp(n, 0.2, 1.0, 0.7) * np.exp(-np.linspace(0, 0.9, n)),
                0, 0.2 if f > 300 else 0.26, pan)
    voice(164.81, HANDOFF, END - HANDOFF + 0.4, 0.36, -0.5)   # solidificar: quinta
    voice(659.25, HANDOFF, 1.1, 0.3, 0.35, 0.02)              # su octava, ya audible
    voice(494, HANDOFF + 0.05, 1.0, 0.22, -0.3, 0.02)
    voice(220, GOLD, END - GOLD + 0.4, 0.3, 0.5)        # giro: octava
    voice(277.18, GREEN, 1.5, 0.28, -0.25, 0.15)        # verde: tercera, resuelve
    voice(329.63, GREEN + 0.09, 1.4, 0.24, 0.3, 0.15)
    voice(440, GREEN + 0.18, 1.3, 0.18, 0.0, 0.15)
    n = secs(0.9)
    m.place(band(noise(n, g, 'pink'), 2000, 9000)
            * ramp(n, 0.0, 1.0, 0.3) * np.exp(-np.linspace(0, 3.4, n)), GREEN, 0.12)
    return reverb(m.stereo(), 1.6, g, 7000, 0.34)


def v_granular(g):
    """Glitch: granos, bitcrush y un estallido de datos."""
    m = Mix()
    n = secs(VIDEO)
    for i in range(320):
        d = secs(g.uniform(0.008, 0.045))
        f = g.uniform(400, 3600)
        at = g.uniform(0, VIDEO * 0.95)
        grain = sine(np.full(d, f), d) * env(d, 0.001, 0, curve=2.0)
        m.place(crush(grain, 4, 6), at, g.uniform(0.12, 0.3), converge(at) * g.choice([-1, 1]))
    m.place(sine(ramp(n, 40, 55, 1.0), n) * ramp(n, 0.3, 1.0), 0, 0.45)
    # Solidificar: el flujo se congela en un tono estable.
    n = secs(1.6)
    freeze = crush(saw(ramp(n, 900, 220, 0.3), n), 5, 12) * env(n, 0.001, 0, curve=1.8)
    m.place(band(freeze, hi=8000), HANDOFF, 0.45)
    m.place(sine(ramp(n, 120, 45, 0.4), n) * env(n, 0.001, 0, curve=1.4), HANDOFF, 0.55)
    n = secs(0.55)
    stutter = noise(n, g) * (np.arange(n) // secs(0.02) % 2)
    m.place(band(stutter, 800, 6000) * env(n, 0.05, 0, curve=0.9), GOLD, 1.6, 0.4)
    for i in range(12):
        d = secs(0.03)
        m.place(crush(sine(np.full(d, g.uniform(500, 2600)), d) * env(d, 0.001, 0), 3, 3),
                GOLD + i * 0.042, 0.3, g.uniform(-0.8, 0.8))
    # Verde: rafaga de datos que se agota.
    n = secs(1.35)
    burst = noise(n, g) * (g.random(n) > 0.93)
    m.place(crush(band(burst, 1500, 12000) * 2.4, 3, 4) * np.exp(-np.linspace(0, 3.6, n)),
            GREEN, 0.9)
    for i in range(26):
        d = secs(g.uniform(0.01, 0.04))
        f = g.uniform(1500, 6000)
        m.place(crush(sine(np.full(d, f), d) * env(d, 0.001, 0), 3, 3),
                GREEN + g.uniform(0, 1.0) ** 1.5, g.uniform(0.12, 0.28), g.uniform(-1, 1))
    return reverb(m.stereo(), 0.9, g, 8000, 0.22)


def v_aliento(g):
    """Humano: inspirar, contener, soltar. Con un pulso debajo."""
    m = Mix()
    # Inspiracion durante las gotas.
    n = secs(VIDEO)
    breath = band(noise(n, g, 'pink'), 300, 4500)
    m.place(sweep_band(breath, ramp(n, 500, 2600, 1.4), 'bandpass', 2) * ramp(n, 0.1, 1.0, 1.6),
            0, 0.5)
    # Pulso: se acelera hacia el relevo.
    beat = 0.0
    interval = 0.62
    while beat < HANDOFF:
        d = secs(0.28)
        m.place(sine(ramp(d, 62, 34, 0.5), d) * env(d, 0.004, 0, curve=1.6), beat, 0.55)
        beat += interval
        interval *= 0.86
    # Contener: el aire se corta y queda un tono tenso.
    n = secs(1.5)
    m.place(sine(np.full(n, 73.4), n) * ramp(n, 0.6, 1.0) * np.exp(-np.linspace(0, 1.2, n)),
            HANDOFF, 0.35)
    # La tension tiene que oirse: armonicos del tono contenido, con un batido
    # lento. Solo con la fundamental grave la fase quedaba muda.
    tense = sine(np.full(n, 440.4), n) + sine(np.full(n, 587.3), n)
    m.place(tense / 2 * (0.6 + 0.4 * np.sin(np.linspace(0, 14, n)))
            * ramp(n, 0.5, 1.0) * np.exp(-np.linspace(0, 2.0, n)), HANDOFF, 0.45, -0.2)
    m.place(band(noise(secs(0.25), g), 400, 4000) * env(secs(0.25), 0.002, 0, curve=2.5),
            HANDOFF, 0.6)
    n = secs(0.55)
    m.place(band(noise(n, g, 'pink'), 400, 3000) * env(n, 0.25, 0, curve=1.2), GOLD, 0.2, -0.3)
    # Soltar: espiracion larga que se apaga sola.
    n = secs(1.35)
    out = band(noise(n, g, 'pink'), 250, 6000)
    m.place(sweep_band(out, ramp(n, 2400, 500, 0.8), 'lowpass', 2)
            * ramp(n, 0.0, 1.0, 0.2) * np.exp(-np.linspace(0, 2.4, n)), GREEN, 0.6)
    m.place(sine(ramp(n, 98, 49, 0.8), n) * np.exp(-np.linspace(0, 2.8, n)), GREEN, 0.25)
    return reverb(m.stereo(), 1.5, g, 5000, 0.34)


def v_espacio(g):
    """Ambiente enorme: subgrave, un paso doppler y un lavado que se evapora."""
    m = Mix()
    n = N
    # El subgrave se abre paso mientras no hay nada mas, pero tiene que dejar
    # sitio al climax: si llega entero al verde, se lo come y en un altavoz
    # normal esa fase se queda muda aunque el nivel diga lo contrario.
    body = np.ones(N)
    body[secs(GOLD):] = np.exp(-np.linspace(0, 5.0, N - secs(GOLD)))
    m.place(sine(ramp(n, 24, 36, 1.2), n) * ramp(n, 0.3, 1.0, 0.8) * body, 0, 0.6)
    # Paso doppler durante las gotas: cruza el estereo.
    n = secs(2.4)
    pass_by = band(noise(n, g, 'pink'), 120, 5000)
    curve = np.exp(-((np.linspace(-2.2, 2.2, n)) ** 2))
    m.place(sweep_band(pass_by, 300 + 1800 * curve, 'bandpass', 2) * curve, 0, 0.55, -0.9)
    m.place(sweep_band(band(noise(n, g, 'pink'), 120, 5000), 300 + 1800 * curve, 'bandpass', 2)
            * np.roll(curve, secs(0.35)), 0, 0.45, 0.9)
    # Gemido tectonico al solidificar.
    n = secs(2.4)
    groan = saw(ramp(n, 58, 31, 0.5), n)
    m.place(sweep_band(groan, ramp(n, 2600, 700, 0.7), 'lowpass', 4)
            * env(n, 0.06, 0, curve=1.1), HANDOFF, 0.9)
    m.place(metal(n, 116, [1, 2.9, 5.4], [1.6, 1.0, .6], g, .01)
            * env(n, 0.04, 0, curve=1.0), HANDOFF, 0.5, 0.3)
    n = secs(0.55)
    m.place(band(noise(n, g, 'pink'), 700, 5000) * env(n, 0.3, 0, curve=1.0), GOLD, 0.8)
    m.place(metal(n, 330, [1, 1.87, 3.2], [.5, .35, .2], g) * env(n, 0.2, 0, curve=1.2),
            GOLD, 0.38, 0.5)
    # Verde: un lavado que se abre y se va.
    n = secs(1.35)
    wash = band(noise(n, g, 'pink'), 600, 8000)
    m.place(sweep_band(wash, ramp(n, 900, 3400, 0.5), 'bandpass', 2)
            * ramp(n, 0.0, 1.0, 0.3) * np.exp(-np.linspace(0, 2.6, n)), GREEN, 1.7)
    m.place(metal(n, 494, [1, 1.6, 2.7], [.7, .5, .3], g) * ramp(n, 1, 0, 1.2), GREEN, 0.45, -0.4)
    return reverb(m.stereo(), 1.8, g, 4000, 0.38)


VARIANTS = [
    ('ferrofluido', 'Humedo y metalico, escuela T2: burbujas, succion y cristalizacion.', v_ferrofluido),
    ('trailer', 'Cine: subgrave, riser invertido, golpe en el relevo y floracion final.', v_trailer),
    ('mercurio', 'Solo agua y mercurio: gotas, viscosidad, chapoteo y efervescencia.', v_mercurio),
    ('analogico', 'Sintetizador clasico: sierras detune, barrido resonante y arpegio.', v_analogico),
    ('cristal', 'Vidrio y campanas: limpio, luminoso, casi afinado.', v_cristal),
    ('fragua', 'Industrial: retumbe, roce de metal, yunque y vapor.', v_fragua),
    ('minimo', 'Casi musica: un acorde que se completa. Lo mas discreto.', v_minimo),
    ('granular', 'Glitch: granos, bitcrush y una rafaga de datos.', v_granular),
    ('aliento', 'Humano: inspirar, contener y soltar, con pulso debajo.', v_aliento),
    ('espacio', 'Ambiente enorme: subgrave, paso doppler y un lavado que se evapora.', v_espacio),
]


def write(name, stereo):
    # El MP3 rebasa el pico del PCM, y mas con material de bordes duros como el
    # bitcrush: se recorta lo mas agudo y se deja techo de sobra.
    stereo = np.stack([band(ch, hi=16000) for ch in stereo])
    peak = np.max(np.abs(stereo))
    if peak:
        stereo = stereo / peak * 0.66
    raw = (np.clip(stereo.T, -1, 1) * 32767).astype('<i2').tobytes()
    target = OUT / name
    subprocess.run(
        ['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '2',
         '-i', 'pipe:0', '-codec:a', 'libmp3lame', '-b:a', '128k', str(target)],
        input=raw, check=True)
    return target.stat().st_size


PHASES = [('gotas', 0, VIDEO), ('rigido', VIDEO, GOLD),
          ('giro', GOLD, GREEN), ('verde', GREEN, END)]


def audible(stereo):
    """Energia por fase entre 300 Hz y 5 kHz. La medida que importa: el nivel
    total engana, porque un subgrave enorme lo sube sin que se oiga nada en un
    altavoz de portatil. Aqui se vio: la fase de gotas era casi toda sub."""
    mono = stereo.mean(axis=0)
    out = []
    for _, a, b in PHASES:
        seg = mono[secs(a):secs(b)]
        spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
        freqs = np.fft.rfftfreq(len(seg), 1 / SR)
        picked = (freqs >= 300) & (freqs < 5000)
        out.append(10 * np.log10(np.sum(spectrum[picked]) / len(seg) + 1e-12))
    return out


def main():
    OUT.mkdir(exist_ok=True)
    index = []
    warnings = []
    for i, (name, blurb, fn) in enumerate(VARIANTS, 1):
        filename = f'{i:02d}-{name}.mp3'
        stereo = fn(rng(1000 + i))
        levels = audible(stereo)
        size = write(filename, stereo)
        index.append({'id': i, 'name': name, 'file': filename, 'about': blurb})
        bars = ' '.join(f'{p[0][:3]} {d:5.1f}' for p, d in zip(PHASES, levels))
        print(f'{filename:<22} {size / 1024:6.1f} kB  {bars}')
        quiet = max(levels) - min(levels)
        if quiet > 12:
            flojo = PHASES[levels.index(min(levels))][0]
            warnings.append(f'  {name}: la fase "{flojo}" queda {quiet:.0f} dB por '
                            f'debajo de la mas fuerte, no se va a oir')
    marks = {'video': VIDEO, 'handoff': HANDOFF, 'gold': GOLD, 'green': GREEN,
             'end': END, 'total': TOTAL}
    (OUT / 'index.json').write_text(
        json.dumps({'marks': marks, 'variants': index}, indent=2, ensure_ascii=False) + '\n')
    print(f'\ndB en 300 Hz-5 kHz por fase. marcas: {marks}')
    if warnings:
        print('\nDesequilibrios:')
        print('\n'.join(warnings))


if __name__ == '__main__':
    main()
