# -*- coding: utf-8 -*-
"""
Fotografa as peças do carrossel.

Uma por uma, a 2× (2160×2700), e depois reduzidas a 1080×1350 com LANCZOS. O
Instagram recomprime tudo o que recebe, e texto reduzido a partir do dobro
aguenta essa recompressão muito melhor do que texto desenhado directamente ao
tamanho final — é supersampling, não é superstição: compara-se abrindo as duas
versões lado a lado a 100%.

Usa o chrome-headless-shell que o Playwright já tem em cache. Não instala nada.

    python -X utf8 render.py

As peças ficam em `out/`. O `--virtual-time-budget` existe para dar tempo às
letras do Google Fonts: sem ele, a captura sai em Georgia e ninguém percebe
porquê.
"""
import glob
import os
import subprocess
import sys
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(AQUI, "out")
PECAS = 8

NOMES = {
    1: "capa",
    2: "gestao",
    3: "area-tecnica",
    4: "app-do-clube",
    5: "pagamentos",
    6: "socios",
    7: "seguranca",
    8: "planos",
}


def chrome():
    """O chrome-headless-shell da cache do Playwright."""
    raiz = os.path.expanduser(r"~\AppData\Local\ms-playwright")
    achados = glob.glob(os.path.join(raiz, "chromium_headless_shell-*", "*", "chrome-headless-shell.exe"))
    if not achados:
        sys.exit("Não encontrei o chrome-headless-shell em %s" % raiz)
    return achados[0]


def main():
    os.makedirs(OUT, exist_ok=True)
    exe = chrome()
    html = os.path.join(AQUI, "carrossel.html").replace("\\", "/")

    for n in range(1, PECAS + 1):
        bruto = os.path.join(OUT, "_bruto.png")
        subprocess.run(
            [
                exe,
                "--headless",
                "--disable-gpu",
                "--hide-scrollbars",
                "--force-prefers-reduced-motion",
                "--force-device-scale-factor=2",
                "--window-size=1080,1350",
                "--virtual-time-budget=8000",
                "--screenshot=" + bruto,
                f"file:///{html}?s={n}",
            ],
            check=True,
            capture_output=True,
        )

        im = Image.open(bruto).convert("RGB")
        if im.size != (2160, 2700):
            print(f"  aviso: a peça {n} saiu a {im.size}, e não a (2160, 2700)")
        im = im.resize((1080, 1350), Image.LANCZOS)
        destino = os.path.join(OUT, f"{n:02d}-{NOMES[n]}.jpg")
        # JPEG a 95: é o que o Instagram aceita sem voltar a estragar, e um PNG
        # de 3 MB por peça não traz um pixel a mais de qualidade nesta cadeia.
        im.save(destino, quality=95, subsampling=0, optimize=True)
        print(f"  {n:02d}  {os.path.basename(destino)}  {os.path.getsize(destino) // 1024} KB")

    os.remove(os.path.join(OUT, "_bruto.png"))
    print("\nfeito:", OUT)


if __name__ == "__main__":
    main()
