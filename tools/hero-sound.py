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


# --- Forma dramatica -----------------------------------------------------
# La primera version se construyo como un riser: cama callada, subida, golpe.
# Esa forma deja la apertura como lo mas flojo por definicion, y la apertura es
# justo donde esta la imagen buena, las dos gotas buscandose. Aqui manda ella:
# el relevo puntua y el verde cierra, pero ninguno la tapa.
PROFILE = {'gotas': 0.0, 'rigido': -2.0, 'giro': -5.0, 'verde': -1.5}

PHASES = [('gotas', 0, VIDEO), ('rigido', VIDEO, GOLD),
          ('giro', GOLD, GREEN), ('verde', GREEN, END)]

# Tres llamadas alternando lado: las gotas se responden, cada vez mas cerca y
# mas agudas, hasta el estiramiento que las une. Son eventos con ataque, no una
# textura de fondo: el oido se agarra a los transitorios, y sin ninguno la fase
# se percibe vacia por mucho nivel que marque.
CALLS = [(0.00, 1.00, -0.88), (0.52, 1.22, 0.82), (1.02, 1.52, -0.46)]


def converge(at, spread=0.85):
    """Panoramica del relleno de la apertura: lo que se siembra alrededor de
    las tres llamadas tambien se cierra al centro segun el video une las gotas."""
    k = min(1.0, max(0.0, at / (VIDEO * 0.82))) ** 1.6
    return spread * (1 - k)


def opening(m, g, drop, stretch=None, gain=1.0):
    """Coloca la apertura. drop(gen, tono) devuelve el timbre de la variante y
    stretch(gen) el del filamento; la estructura es comun a las diez."""
    for at, pitch, pan in CALLS:
        m.place(drop(g, pitch), at, gain, pan)
    if stretch:
        m.place(stretch(g), VIDEO - 0.66, gain * 0.85)


def a_weighting(freqs):
    """Ponderacion A (IEC 61672), en amplitud. Aproxima como oye el oido: casi
    no cuenta lo que hay por debajo de 100 Hz."""
    f2 = np.asarray(freqs, dtype=float) ** 2
    num = (12194.0 ** 2) * f2 ** 2
    den = ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2))
           * (f2 + 12194.0 ** 2))
    return 1.2589 * num / (den + 1e-30)


def audible(stereo):
    """Sonoridad percibida por fase. El nivel total engana: un subgrave enorme
    lo sube sin que se oiga nada en un altavoz pequeno, y asi fue como se colo
    una apertura practicamente muda. Una ventana fija de 300 Hz a 5 kHz tampoco
    vale, porque ignora un grave que en cascos si pesa. La ponderacion A cubre
    los dos casos con una sola medida."""
    mono = stereo.mean(axis=0)
    out = []
    for _, a, b in PHASES:
        seg = mono[secs(a):secs(b)]
        spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2
        weight = a_weighting(np.fft.rfftfreq(len(seg), 1 / SR)) ** 2
        out.append(10 * np.log10(np.sum(spectrum * weight) / len(seg) + 1e-12))
    return out


def shape(stereo):
    """Impone PROFILE. Mide cada fase en la banda audible y corrige hasta
    cuadrar el perfil, en vez de confiar en que el balance salga solo de las
    ganancias sueltas: eso es lo que fallaba, y fase a fase no se veia."""
    levels = audible(stereo)
    targets = [PROFILE[name] for name, _, _ in PHASES]
    # Media cero: se reparte el peso, no se sube el conjunto.
    offset = float(np.mean(levels) - np.mean(targets))
    gains = np.ones(N)
    for (name, a, b), level, target in zip(PHASES, levels, targets):
        correction = np.clip(target + offset - level, -9.0, 9.0)
        gains[secs(a):secs(b)] = 10 ** (correction / 20)
    gains[secs(END):] = gains[secs(END) - 1]
    # Suavizado de 0.2 s: sin el, el salto entre fases se oye como un escalon.
    window = np.hanning(secs(0.2))
    gains = np.convolve(gains, window / window.sum(), mode='same')
    return stereo * gains


# --- Variantes -----------------------------------------------------------
# Todas comparten la forma; lo que cambia es el timbre de cada golpe.

def v_ferrofluido(g):
    """T2: humedo y metalico. La gota es un impacto blando con cola de burbuja."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(0.55)
        body = metal(n, 210 * pitch, [1, 2.31, 3.74, 5.9], [.28, .2, .13, .08], gen, .01)
        wet = band(noise(n, gen), 500, 4200) * env(n, 0.004, 0, curve=2.6)
        tail = bubble(secs(0.14), 150 * pitch, 620 * pitch, gen)
        out = body * env(n, 0.003, 0, curve=1.9) + wet * 0.7
        out[:len(tail)] += tail * 0.5
        return out

    def stretch(gen):
        n = secs(0.66)
        pull = band(noise(n, gen, 'pink'), 300, 3800) * ramp(n, 0.15, 1.0, 2.0)
        return sweep_band(pull, ramp(n, 600, 3400, 1.6), 'lowpass') \
            + sine(ramp(n, 200, 92, 0.8), n) * ramp(n, 0.2, 1.0) * 0.5

    opening(m, g, drop, stretch, 0.9)
    m.place(band(noise(secs(VIDEO), g, 'pink'), 30, 90) * ramp(secs(VIDEO), 0.2, 1.0), 0, 0.3)
    # Relevo: cristaliza. Crepitar corto y el cuerpo metalico asentandose.
    n = secs(1.0)
    grit = noise(n, g) * (g.random(n) > 0.985) * ramp(n, 1.0, 0.05, 0.7)
    m.place(band(grit, 900, 6000) * 3.0, HANDOFF - 0.3, 0.45)
    m.place(metal(secs(2.0), 148, [1, 2.37, 3.61, 5.12], [1.2, .9, .6, .4], g, .004),
            HANDOFF, 0.4)
    n = secs(0.55)
    m.place(sweep_band(band(noise(n, g, 'pink'), 500, 7000), ramp(n, 1400, 4200), 'bandpass', 2)
            * env(n, 0.15, 0, curve=1.4), GOLD, 0.3, -0.4)
    # Verde: el enjambre se desprende y se disuelve.
    n = secs(1.35)
    shimmer = noise(n, g) * (g.random(n) > 0.968)
    m.place(band(shimmer, 1800, 9000) * 3.0 * np.exp(-np.linspace(0, 3.2, n)), GREEN, 0.5)
    m.place(metal(n, 296, [1, 1.51, 2.42, 3.9], [.9, .7, .5, .35], g) * ramp(n, 1, 0, 1.4),
            GREEN, 0.3, 0.5)
    return reverb(m.stereo(), 1.2, g, 5200, 0.28)


def v_trailer(g):
    """Cine. La gota es un impacto con cuerpo, no un riser que llega tarde."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(0.7)
        hit = metal(n, 165 * pitch, [1, 2.02, 3.4, 5.1], [.4, .28, .18, .11], gen, .008)
        air = band(noise(n, gen, 'pink'), 400, 6000) * env(n, 0.002, 0, curve=2.8)
        low = sine(ramp(n, 130 * pitch, 52, 0.45), n) * env(n, 0.002, 0, curve=1.5)
        return hit * env(n, 0.002, 0, curve=1.6) + air * 0.55 + low * 0.7

    def stretch(gen):
        n = secs(0.66)
        riser = band(noise(n, gen, 'pink'), 300, 12000) * ramp(n, 0.2, 1.0, 1.3)
        return sweep_band(riser, ramp(n, 700, 6000, 1.4), 'highpass', 2) \
            + sine(ramp(n, 300, 1100, 2.2), n) * ramp(n, 0.0, 0.6, 2.6)

    opening(m, g, drop, stretch, 0.95)
    m.place(sine(ramp(secs(HANDOFF), 28, 44, 1.4), secs(HANDOFF))
            * ramp(secs(HANDOFF), 0.3, 1.0, 1.7), 0, 0.45)
    # Relevo: el golpe puntua, ya no aplasta a la apertura.
    n = secs(2.0)
    m.place(sine(ramp(n, 92, 32, 0.35), n) * env(n, 0.001, 0, curve=1.6), HANDOFF, 0.55)
    m.place(metal(n, 116, [1, 2.71, 4.13, 6.3], [1.5, 1.0, .7, .45], g, .006), HANDOFF, 0.35)
    n = secs(0.55)
    m.place(sweep_band(band(noise(n, g, 'pink'), 400, 8000), ramp(n, 900, 5000), 'bandpass', 2)
            * env(n, 0.2, 0, curve=1.2), GOLD, 0.3, 0.45)
    n = secs(1.35)
    chord = sum(sine(f, n) for f in (220, 330, 440, 660))
    m.place(chord / 4 * ramp(n, 0.0, 1.0, 0.35) * np.exp(-np.linspace(0, 2.6, n)), GREEN, 0.5)
    m.place(band(noise(n, g, 'pink'), 2000, 9000) * np.exp(-np.linspace(0, 3.4, n)), GREEN, 0.35)
    return reverb(m.stereo(), 1.6, g, 7000, 0.36)


def v_mercurio(g):
    """Agua y mercurio. La gota es una gota: plop con cuerpo resonante."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(0.42)
        plop = bubble(secs(0.11), 260 * pitch, 1500 * pitch, gen, 2.0)
        body = sine(np.full(n, 430.0 * pitch), n) * env(n, 0.004, 0, curve=2.4)
        splash = band(noise(n, gen), 700, 5500) * env(n, 0.002, 0, curve=3.0)
        out = body * 0.55 + splash * 0.8
        out[:len(plop)] += plop * 1.1
        return out

    def stretch(gen):
        n = secs(0.66)
        slurp = band(noise(n, gen, 'pink'), 300, 3600) * ramp(n, 0.15, 1.0, 2.2)
        return sweep_band(slurp, ramp(n, 450, 2800, 1.5), 'lowpass') \
            + sine(ramp(n, 380, 140, 1.1), n) * ramp(n, 0.3, 1.0) * 0.6

    opening(m, g, drop, stretch, 1.0)
    for i in range(40):
        at = g.uniform(0, VIDEO * 0.95)
        d = secs(g.uniform(0.02, 0.07))
        f0 = g.uniform(320, 1100)
        m.place(bubble(d, f0, f0 * g.uniform(3, 6), g, 2.2), at,
                g.uniform(0.08, 0.2), converge(at) * g.choice([-1, 1]))
    n = secs(0.9)
    m.place(band(noise(n, g), 400, 5000) * env(n, 0.004, 0, curve=2.4), HANDOFF, 0.45)
    m.place(sine(ramp(n, 150, 60, 0.5), n) * env(n, 0.002, 0, curve=1.4), HANDOFF, 0.4)
    n = secs(0.55)
    m.place(band(noise(n, g, 'pink'), 800, 5000) * env(n, 0.18, 0, curve=1.5), GOLD, 0.4)
    n = secs(1.35)
    fizz = noise(n, g) * (g.random(n) > 0.95)
    m.place(band(fizz, 1200, 8000) * 2.6 * np.exp(-np.linspace(0, 3.0, n)), GREEN, 0.8)
    for i in range(26):
        d = secs(g.uniform(0.015, 0.05))
        f0 = g.uniform(600, 1800)
        m.place(bubble(d, f0, f0 * 3, g), GREEN + g.uniform(0, 1.1) ** 1.6,
                g.uniform(0.06, 0.14), g.uniform(-0.9, 0.9))
    return reverb(m.stereo(), 0.9, g, 6000, 0.24)


def v_analogico(g):
    """Sintetizador. La gota es un pluck resonante, no un pad inaudible."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(0.6)
        pluck = saw(np.full(n, 220.0 * pitch), n) * env(n, 0.003, 0, curve=2.0)
        return sweep_band(pluck, ramp(n, 4200, 500, 0.6), 'lowpass', 6) \
            + sine(np.full(n, 110.0 * pitch), n) * env(n, 0.002, 0, curve=1.6) * 0.5

    def stretch(gen):
        n = secs(0.66)
        return sweep_band(saw(ramp(n, 110, 330, 1.6), n) * ramp(n, 0.3, 1.0),
                          ramp(n, 600, 5200, 1.2), 'lowpass', 6)

    opening(m, g, drop, stretch, 0.95)
    m.place(sine(np.full(secs(HANDOFF), 55.0), secs(HANDOFF))
            * ramp(secs(HANDOFF), 0.4, 1.0), 0, 0.3)
    n = secs(1.3)
    zap = saw(ramp(n, 440, 110, 0.4), n) * env(n, 0.002, 0, curve=1.8)
    m.place(sweep_band(zap, ramp(n, 5200, 400, 0.5), 'lowpass', 6), HANDOFF, 0.42)
    m.place(sine(ramp(n, 110, 41, 0.35), n) * env(n, 0.001, 0, curve=1.5), HANDOFF, 0.38)
    n = secs(0.55)
    m.place(band(saw(ramp(n, 330, 495, 1.0), n) * env(n, 0.1, 0, curve=1.6), 300, 6000),
            GOLD, 0.55, -0.35)
    step = secs(0.135)
    for i, f in enumerate([330, 440, 550, 660, 880, 1100, 1320]):
        d = secs(0.5)
        voice = saw(np.full(d, float(f)), d) * env(d, 0.004, 0, curve=2.6)
        m.place(band(voice, hi=7000), GREEN + i * step / SR,
                0.5 * (1 - i / 8), (i / 6) * 1.4 - 0.7)
    return reverb(m.stereo(), 1.3, g, 6500, 0.28)


def v_cristal(g):
    """Vidrio. La gota es un golpe de campana limpio."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(1.1)
        base = 523.25 * pitch
        bell = metal(n, base, [1, 2.02, 3.05, 4.8], [.8, .55, .35, .2], gen, .002)
        # El golpe del badajo: sin ese chasquido corto la campana no arranca,
        # entra sola y se pierde entre lo demas.
        strike = band(noise(secs(0.04), gen), 2500, 10000) * env(secs(0.04), 0.0005, 0)
        out = bell * env(n, 0.004, 0, curve=2.0)
        out[:len(strike)] += strike * 0.5
        return out

    def stretch(gen):
        n = secs(0.66)
        glide = sum(sine(ramp(n, f, f * 1.5, 1.4), n) for f in (392.0, 587.3))
        return glide / 2 * ramp(n, 0.2, 1.0, 1.2)

    opening(m, g, drop, stretch, 0.95)
    m.place(sine(np.full(secs(VIDEO), 65.4), secs(VIDEO))
            * ramp(secs(VIDEO), 0.3, 1.0), 0, 0.22)
    n = secs(2.2)
    for f, pan in [(261.6, -0.6), (392.0, 0.0), (523.25, 0.55)]:
        m.place(metal(n, f, [1, 2.41, 4.07, 6.8], [1.8, 1.2, .7, .45], g, .003), HANDOFF, 0.26, pan)
    m.place(sine(ramp(n, 130, 65, 0.4), n) * env(n, 0.002, 0, curve=1.3), HANDOFF, 0.35)
    n = secs(0.55)
    m.place(band(noise(n, g), 3000, 12000) * env(n, 0.2, 0, curve=1.3), GOLD, 0.2)
    n = secs(1.35)
    for i in range(30):
        d = secs(g.uniform(0.2, 0.6))
        f = g.uniform(900, 4200)
        m.place(metal(d, f, [1, 2.1], [.4, .25], g) * env(d, 0.003, 0, curve=2.8),
                GREEN + g.uniform(0, 1.0) ** 1.4, g.uniform(0.06, 0.15), g.uniform(-1, 1))
    chord = sum(sine(f, n) for f in (523.25, 659.25, 784.0))
    m.place(chord / 3 * ramp(n, 0.0, 1.0, 0.4) * np.exp(-np.linspace(0, 3.2, n)), GREEN, 0.32)
    return reverb(m.stereo(), 1.5, g, 9000, 0.32)


def v_fragua(g):
    """Fragua. La gota es un martillazo corto sobre metal."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(0.8)
        anvil = metal(n, 190 * pitch, [1, 2.13, 3.77, 5.9, 8.4], [.5, .34, .22, .14, .09],
                      gen, .012)
        tap = drive(band(noise(secs(0.09), gen), 1200, 7000) * env(secs(0.09), 0.0004, 0), 3)
        out = anvil * env(n, 0.002, 0, curve=1.5)
        out[:len(tap)] += tap * 0.6
        return out

    def stretch(gen):
        n = secs(0.66)
        scrape = band(noise(n, gen, 'pink'), 600, 4500)
        return sweep_band(scrape, ramp(n, 900, 3200, 1.2), 'bandpass', 3) * ramp(n, 0.25, 1.0)

    opening(m, g, drop, stretch, 0.9)
    m.place(band(noise(secs(HANDOFF), g, 'brown'), 25, 120)
            * ramp(secs(HANDOFF), 0.4, 1.0), 0, 0.4)
    n = secs(1.8)
    m.place(metal(n, 92, [1, 2.13, 3.77, 5.9], [1.4, .9, .6, .4], g, .008), HANDOFF, 0.45)
    m.place(band(noise(secs(0.3), g), 60, 400) * env(secs(0.3), 0.001, 0, curve=1.4),
            HANDOFF, 0.5)
    n = secs(0.55)
    m.place(band(noise(n, g, 'pink'), 300, 3000) * env(n, 0.12, 0, curve=1.6), GOLD, 0.35, 0.35)
    n = secs(1.35)
    steam = band(noise(n, g, 'pink'), 600, 6000)
    m.place(sweep_band(steam, ramp(n, 900, 3400, 0.6), 'bandpass', 2)
            * ramp(n, 0.0, 1.0, 0.25) * np.exp(-np.linspace(0, 2.8, n)), GREEN, 1.1)
    m.place(sine(ramp(n, 60, 38, 0.7), n) * np.exp(-np.linspace(0, 3.0, n)), GREEN, 0.25)
    return reverb(m.stereo(), 1.4, g, 4500, 0.3)


def v_minimo(g):
    """Casi musica. La gota es una nota pulsada: discreta pero presente."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(1.2)
        f = 220.0 * pitch
        tone = sine(np.full(n, f), n) + 0.4 * sine(np.full(n, f * 2), n) \
            + 0.16 * sine(np.full(n, f * 3), n)
        return tone / 1.6 * env(n, 0.02, 0, curve=1.1)

    def stretch(gen):
        n = secs(0.66)
        return (sine(ramp(n, 220, 330, 1.3), n) + 0.4 * sine(ramp(n, 440, 660, 1.3), n)) \
            * ramp(n, 0.25, 1.0, 0.9) * 0.7

    opening(m, g, drop, stretch, 0.85)
    m.place(sine(np.full(secs(HANDOFF), 110.0), secs(HANDOFF))
            * ramp(secs(HANDOFF), 0.4, 1.0) * np.exp(-np.linspace(0, 0.8, secs(HANDOFF))),
            0, 0.35)

    def voice(f, at, dur, gain, pan=0.0, attack=0.2):
        n = secs(dur)
        tone = sine(np.full(n, float(f)), n) + 0.32 * sine(np.full(n, float(f) * 2), n)
        curve = np.minimum(ramp(n, 0, 1, 1.0) / max(attack / dur, 1e-3), 1.0)
        m.place(band(tone, hi=6000) * curve * np.exp(-np.linspace(0, 1.6, n)), at, gain, pan)

    voice(329.63, HANDOFF, 1.4, 0.34, -0.45)      # solidificar: la quinta
    voice(440, GOLD, 1.2, 0.3, 0.5)               # giro: la octava
    voice(554.37, GREEN, 1.3, 0.34, -0.25, 0.06)  # verde: resuelve
    voice(659.25, GREEN + 0.09, 1.2, 0.3, 0.3, 0.06)
    voice(880, GREEN + 0.18, 1.1, 0.22, 0.0, 0.06)
    n = secs(0.9)
    m.place(band(noise(n, g, 'pink'), 1500, 8000)
            * ramp(n, 0.0, 1.0, 0.3) * np.exp(-np.linspace(0, 3.4, n)), GREEN, 0.16)
    return reverb(m.stereo(), 1.4, g, 7000, 0.3)


def v_granular(g):
    """Glitch. La gota es una rafaga corta de granos machacados."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(0.5)
        out = np.zeros(n)
        for i in range(26):
            d = secs(gen.uniform(0.006, 0.03))
            at = int(gen.uniform(0, n - d) ** 1.0)
            f = gen.uniform(500, 3200) * pitch
            grain = crush(sine(np.full(d, f), d) * env(d, 0.001, 0, curve=2.0), 3, 4)
            out[at:at + d] += grain * gen.uniform(0.4, 1.0)
        return out * np.exp(-np.linspace(0, 2.2, n))

    def stretch(gen):
        n = secs(0.66)
        stut = noise(n, gen) * (np.arange(n) // secs(0.015) % 2)
        return crush(band(stut, 600, 7000), 4, 5) * ramp(n, 0.2, 1.0, 1.4)

    opening(m, g, drop, stretch, 0.95)
    m.place(sine(ramp(secs(VIDEO), 40, 55, 1.0), secs(VIDEO))
            * ramp(secs(VIDEO), 0.3, 1.0), 0, 0.3)
    n = secs(1.5)
    freeze = crush(saw(ramp(n, 900, 220, 0.3), n), 5, 12) * env(n, 0.001, 0, curve=1.8)
    m.place(band(freeze, hi=8000), HANDOFF, 0.4)
    m.place(sine(ramp(n, 120, 45, 0.4), n) * env(n, 0.001, 0, curve=1.4), HANDOFF, 0.42)
    n = secs(0.55)
    stutter = noise(n, g) * (np.arange(n) // secs(0.02) % 2)
    m.place(band(stutter, 800, 6000) * env(n, 0.05, 0, curve=0.9), GOLD, 1.1, 0.4)
    n = secs(1.35)
    burst = noise(n, g) * (g.random(n) > 0.93)
    m.place(crush(band(burst, 1200, 9000) * 2.4, 3, 4) * np.exp(-np.linspace(0, 3.6, n)),
            GREEN, 0.8)
    for i in range(22):
        d = secs(g.uniform(0.01, 0.04))
        f = g.uniform(1200, 5000)
        m.place(crush(sine(np.full(d, f), d) * env(d, 0.001, 0), 3, 3),
                GREEN + g.uniform(0, 1.0) ** 1.5, g.uniform(0.12, 0.26), g.uniform(-1, 1))
    return reverb(m.stereo(), 0.8, g, 8000, 0.2)


def v_aliento(g):
    """Humano. La gota es una inspiracion corta, casi un susurro con acento."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(0.62)
        air = band(noise(n, gen, 'pink'), 350, 5000)
        shaped = sweep_band(air, ramp(n, 700 * pitch, 2400 * pitch, 1.1), 'bandpass', 2)
        voiced = sine(np.full(n, 330.0 * pitch), n) * env(n, 0.05, 0, curve=1.6) * 0.25
        return shaped * env(n, 0.09, 0, curve=1.3) * 1.6 + voiced

    def stretch(gen):
        n = secs(0.66)
        air = band(noise(n, gen, 'pink'), 300, 5000)
        return sweep_band(air, ramp(n, 800, 2800, 1.2), 'bandpass', 2) * ramp(n, 0.25, 1.0, 1.3)

    opening(m, g, drop, stretch, 1.0)
    beat, gap = 0.0, 0.62
    while beat < HANDOFF:
        d = secs(0.28)
        m.place(sine(ramp(d, 62, 34, 0.5), d) * env(d, 0.004, 0, curve=1.6), beat, 0.4)
        beat += gap
        gap *= 0.86
    # Contener: el aire se corta y queda una tension con armonicos audibles.
    n = secs(1.4)
    m.place(sine(np.full(n, 73.4), n) * ramp(n, 0.6, 1.0) * np.exp(-np.linspace(0, 1.2, n)),
            HANDOFF, 0.3)
    tense = sine(np.full(n, 440.4), n) + sine(np.full(n, 587.3), n)
    m.place(tense / 2 * (0.6 + 0.4 * np.sin(np.linspace(0, 14, n)))
            * ramp(n, 0.5, 1.0) * np.exp(-np.linspace(0, 2.0, n)), HANDOFF, 0.35, -0.2)
    n = secs(0.55)
    m.place(band(noise(n, g, 'pink'), 400, 3000) * env(n, 0.25, 0, curve=1.2), GOLD, 0.3, -0.3)
    n = secs(1.35)
    out = band(noise(n, g, 'pink'), 250, 6000)
    m.place(sweep_band(out, ramp(n, 2400, 600, 0.8), 'lowpass', 2)
            * ramp(n, 0.0, 1.0, 0.2) * np.exp(-np.linspace(0, 2.4, n)), GREEN, 0.7)
    m.place(sine(ramp(n, 98, 49, 0.8), n) * np.exp(-np.linspace(0, 2.8, n)), GREEN, 0.22)
    return reverb(m.stereo(), 1.3, g, 5000, 0.3)


def v_espacio(g):
    """Ambiente. La gota es un pulso lejano con mucha sala: enorme pero nitido."""
    m = Mix()

    def drop(gen, pitch):
        n = secs(1.3)
        pulse = metal(n, 165 * pitch, [1, 1.94, 3.3], [.9, .6, .35], gen, .006)
        air = band(noise(n, gen, 'pink'), 500, 4000) * env(n, 0.01, 0, curve=2.2)
        return pulse * env(n, 0.008, 0, curve=1.2) + air * 0.5

    def stretch(gen):
        n = secs(0.66)
        swell = band(noise(n, gen, 'pink'), 400, 6000) * ramp(n, 0.1, 1.0, 1.8)
        return sweep_band(swell, ramp(n, 700, 3000, 1.3), 'bandpass', 2) \
            + sine(ramp(n, 110, 220, 1.5), n) * ramp(n, 0.2, 0.8) * 0.5

    opening(m, g, drop, stretch, 0.95)
    # El subgrave abre paso pero deja sitio: si llega entero al verde, se lo come.
    body = np.ones(N)
    body[secs(GOLD):] = np.exp(-np.linspace(0, 5.0, N - secs(GOLD)))
    m.place(sine(ramp(N, 24, 36, 1.2), N) * ramp(N, 0.3, 1.0, 0.8) * body, 0, 0.45)
    n = secs(2.2)
    groan = saw(ramp(n, 58, 31, 0.5), n)
    m.place(sweep_band(groan, ramp(n, 2600, 700, 0.7), 'lowpass', 4)
            * env(n, 0.06, 0, curve=1.1), HANDOFF, 0.55)
    m.place(metal(n, 116, [1, 2.9, 5.4], [1.4, .9, .5], g, .01)
            * env(n, 0.04, 0, curve=1.0), HANDOFF, 0.3, 0.3)
    n = secs(0.55)
    m.place(band(noise(n, g, 'pink'), 700, 5000) * env(n, 0.3, 0, curve=1.0), GOLD, 0.4)
    n = secs(1.35)
    wash = band(noise(n, g, 'pink'), 600, 8000)
    m.place(sweep_band(wash, ramp(n, 900, 3400, 0.5), 'bandpass', 2)
            * ramp(n, 0.0, 1.0, 0.3) * np.exp(-np.linspace(0, 2.6, n)), GREEN, 1.4)
    m.place(metal(n, 494, [1, 1.6, 2.7], [.7, .5, .3], g) * ramp(n, 1, 0, 1.2), GREEN, 0.4, -0.4)
    return reverb(m.stereo(), 1.7, g, 4000, 0.36)


VARIANTS = [
    ('ferrofluido', 'Humedo y metalico, escuela T2: impacto blando, burbuja y cristalizacion.', v_ferrofluido),
    ('trailer', 'Cine: tres impactos con cuerpo, estiramiento y floracion final.', v_trailer),
    ('mercurio', 'Agua y mercurio: plops resonantes, viscosidad y efervescencia.', v_mercurio),
    ('analogico', 'Sintetizador: plucks resonantes, zap al solidificar y arpegio.', v_analogico),
    ('cristal', 'Vidrio y campanas: limpio, luminoso, casi afinado.', v_cristal),
    ('fragua', 'Industrial: martillazos, retumbe, yunque y vapor.', v_fragua),
    ('minimo', 'Casi musica: notas pulsadas y un acorde que se completa.', v_minimo),
    ('granular', 'Glitch: rafagas de granos machacados y estallido de datos.', v_granular),
    ('aliento', 'Humano: tres inspiraciones, tension contenida y soltar.', v_aliento),
    ('espacio', 'Ambiente enorme: pulsos lejanos con sala y un lavado que se evapora.', v_espacio),
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


def main():
    OUT.mkdir(exist_ok=True)
    index = []
    warnings = []
    for i, (name, blurb, fn) in enumerate(VARIANTS, 1):
        filename = f'{i:02d}-{name}.mp3'
        stereo = shape(fn(rng(1000 + i)))
        levels = audible(stereo)
        size = write(filename, stereo)
        index.append({'id': i, 'name': name, 'file': filename, 'about': blurb})
        bars = ' '.join(f'{p[0][:3]} {d:5.1f}' for p, d in zip(PHASES, levels))
        print(f'{filename:<22} {size / 1024:6.1f} kB  {bars}')
        # La apertura manda: si no es de las mas fuertes, algo se ha torcido.
        if levels[0] < max(levels) - 3.0:
            warnings.append(f'  {name}: la apertura queda {max(levels) - levels[0]:.0f} dB '
                            f'por debajo de la fase mas fuerte')
    marks = {'video': VIDEO, 'handoff': HANDOFF, 'gold': GOLD, 'green': GREEN,
             'end': END, 'total': TOTAL}
    (OUT / 'index.json').write_text(
        json.dumps({'marks': marks, 'variants': index}, indent=2, ensure_ascii=False) + '\n')
    print(f'\ndB con ponderacion A por fase. marcas: {marks}')
    if warnings:
        print('\nLa apertura no manda:')
        print('\n'.join(warnings))


if __name__ == '__main__':
    main()
