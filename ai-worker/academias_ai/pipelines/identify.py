"""identify — dos tracks às pessoas.

O `detect_track` devolve centenas de tracks para vinte e dois jogadores: cada
oclusão, saída de enquadramento ou salto da câmara abre um novo. Esta etapa
junta-os em **identidades** — "este conjunto de tracks é a mesma pessoa" — e,
para cada identidade, propõe quem é, com a confiança medida. O treinador
confirma pessoas; nunca tracks.

## O que se usa, e o que não se usa

- **Aparência de corpo inteiro**: um embedding por recorte (ResNet-50 do
  torchvision, pesos ImageNet, BSD-3) mais um histograma de cor do tronco — a
  camisola é o sinal mais forte que há para separar equipas e para colar
  fragmentos do mesmo jogador. Não é um modelo de re-identificação de pessoas
  treinado para isso (OSNet e família); é o que há com licença limpa e
  download fiável, e o resultado diz-o na confiança. O upgrade é apontado em
  `LICENSES.md`.
- **Número de camisola**: OCR (EasyOCR, Apache-2.0) sobre o tronco de cada
  recorte, só dígitos. Num vídeo filmado de longe o número tem oito píxeis e
  não se lê — e o resultado diz "sem leitura", não inventa.
- **Tempo**: dois tracks que existem ao mesmo tempo não são a mesma pessoa.
  É a única regra dura, e é a que impede a aparência de colar dois colegas com
  a mesma camisola.
- **O plantel confirmado**: "#10 = Rui Alves" transforma a pergunta aberta
  "quem é?" na fechada "qual destes?". Uma leitura de número só vira proposta
  se houver exactamente um atleta do plantel com esse número.
- **Confirmações humanas** (`params.confirmed`): uma identidade confirmada é
  uma âncora. Na passagem seguinte, o que se parecer com ela ganha proposta —
  é assim que confirmar um jogador propaga aos fragmentos que ficaram soltos.
- **Nada de reconhecimento facial.** São menores. Não entra e não vai entrar
  por aqui.

## O que NÃO faz, e diz que não faz

Não decide qual das equipas é "a nossa": agrupa por cor e guarda o grupo; o
lado só se atribui quando uma confirmação humana diz de que cor somos nós.
Não inventa propostas: sem número lido e sem âncora parecida, a identidade
fica "unknown" e pede um humano — com a imagem à frente.
"""

from __future__ import annotations

import gzip
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

from .. import api, config

try:
    import torch
    import torchvision

    _DEPS = True
except ImportError:
    _DEPS = False

try:
    import easyocr

    _OCR = True
except ImportError:
    _OCR = False

CROPS_INDEX_KEY = "crops/index.json.gz"
EMBEDDINGS_KEY = "identities/embeddings.json.gz"

# --- Agrupamento ---------------------------------------------------------------
#
# Distância combinada entre dois tracks: 0 = iguais, 1 = nada a ver. A
# aparência (ResNet) pesa mais; a cor do tronco desempata equipas.
W_APPEARANCE = 0.6
W_COLOUR = 0.4
# Abaixo disto, dois tracks colam-se na mesma identidade. Conservador de
# propósito: uma identidade a mais pede uma confirmação a mais; uma a menos
# põe dois jogadores no mesmo nome, que é o erro que não se pode cometer.
CLUSTER_THRESHOLD = 0.32
# Dois tracks vivos ao mesmo tempo por mais do que isto são duas pessoas.
OVERLAP_MS = 1000
# A distância que "não pode ser a mesma pessoa" ganha na matriz.
CANNOT_LINK = 10.0
# Abaixo disto uma identidade nova parece-se o suficiente com uma confirmada
# para se propor o mesmo atleta.
ANCHOR_THRESHOLD = 0.28

# --- OCR ------------------------------------------------------------------------
# Só vale a pena tentar ler onde há píxeis: abaixo disto o número é um borrão.
OCR_MIN_BOX_HEIGHT = 48
OCR_MIN_CONF = 0.35


def dependencies_ok() -> bool:
    return _DEPS


MODELS: list[dict[str, str]] = (
    [
        {
            "task": "reid",
            "name": "torchvision-resnet50-appearance",
            "version": torchvision.__version__,
            "license": "BSD-3-Clause",
            "source": "https://pytorch.org/vision",
            "notes": "Embedding genérico de aparência (ImageNet) + histograma de cor do tronco. Não é um modelo de re-ID de pessoas.",
        }
    ]
    + (
        [
            {
                "task": "ocr",
                "name": "easyocr",
                "version": getattr(easyocr, "__version__", "?"),
                "license": "Apache-2.0",
                "source": "https://github.com/JaidedAI/EasyOCR",
            }
        ]
        if _OCR
        else []
    )
    if _DEPS
    else []
)


# ---------------------------------------------------------------------------
# A etapa
# ---------------------------------------------------------------------------


def run(job: dict[str, Any], video_path: Path | None, progress: Callable[[int], None]) -> dict[str, Any]:
    """Não lê o vídeo: trabalha sobre os recortes e os tracks que o `detect_track` deixou."""
    ident = job.get("identify") or {}
    tracks: list[dict[str, Any]] = ident.get("tracks") or []
    confirmed: list[dict[str, Any]] = ident.get("confirmed") or []
    squad: list[dict[str, Any]] = job.get("analysis", {}).get("squad") or []
    if not tracks:
        raise RuntimeError("A análise não tem tracks — o detect_track tem de correr primeiro")

    progress(2)
    indice = _download_json_gz(job["id"], CROPS_INDEX_KEY)
    if not indice or not indice.get("tracks"):
        raise RuntimeError("A análise não tem recortes — foi processada antes desta etapa existir; volta a carregar o vídeo")

    device = "cuda" if torch.cuda.is_available() else "cpu"

    # ── 1. Recortes por track ─────────────────────────────────────────────
    folhas = _download_sheets(job["id"], indice)
    tiles_por_track: dict[int, list[np.ndarray]] = {}
    boxes_por_track: dict[int, list[list[int]]] = {}
    tw, th = indice["tile"]
    cols = indice["cols"]
    for tid_str, refs in indice["tracks"].items():
        tid = int(tid_str)
        for r in refs:
            folha = folhas.get(r["s"])
            if folha is None:
                continue
            c, lin = r["i"] % cols, r["i"] // cols
            tile = folha[lin * th : (lin + 1) * th, c * tw : (c + 1) * tw]
            tiles_por_track.setdefault(tid, []).append(tile)
            boxes_por_track.setdefault(tid, []).append(r.get("box") or [0, 0, 0, 0])
    progress(12)

    # ── 2. Embeddings — reaproveitados quando já existem ──────────────────
    guardados = _download_json_gz(job["id"], EMBEDDINGS_KEY) if ident.get("reuseEmbeddings") else None
    if guardados and guardados.get("appearance") and guardados.get("colour"):
        aparencia = {int(k): np.asarray(v, dtype=np.float32) for k, v in guardados["appearance"].items()}
        cor = {int(k): np.asarray(v, dtype=np.float32) for k, v in guardados["colour"].items()}
        leituras = {int(k): v for k, v in (guardados.get("jersey") or {}).items()}
        progress(50)
    else:
        aparencia = _appearance_embeddings(tiles_por_track, device, lambda p: progress(12 + int(p * 0.28)))
        cor = {tid: _colour_descriptor(tiles) for tid, tiles in tiles_por_track.items()}
        progress(42)
        leituras = _read_jerseys(tiles_por_track, boxes_por_track, device, lambda p: progress(42 + int(p * 0.16)))
        progress(58)
        api.upload_json_gz(
            job["id"],
            EMBEDDINGS_KEY,
            {
                "appearance": {str(k): [round(float(x), 5) for x in v] for k, v in aparencia.items()},
                "colour": {str(k): [round(float(x), 5) for x in v] for k, v in cor.items()},
                "jersey": {str(k): v for k, v in leituras.items()},
            },
        )
        progress(60)

    # Só os tracks para os quais há embedding entram no agrupamento.
    ids = sorted(tid for tid in aparencia if tid in cor)
    por_numero = {int(t["trackNumber"]): t for t in tracks}
    ids = [tid for tid in ids if tid in por_numero]
    if not ids:
        raise RuntimeError("Nenhum track com recortes utilizáveis")

    # ── 3. Grupos de cor (equipas) ────────────────────────────────────────
    grupo_cor = _colour_groups(ids, cor)

    # ── 4. Agrupar em identidades ─────────────────────────────────────────
    dist = _distance_matrix(ids, aparencia, cor, por_numero, grupo_cor)
    clusters = _cluster(ids, dist)
    progress(72)

    # ── 5. Âncoras: o que um humano já confirmou ──────────────────────────
    ancoras = _anchors(confirmed, aparencia, cor)
    lado_por_grupo = _sides_from_anchors(confirmed, por_numero, grupo_cor)

    # ── 6. Propostas ──────────────────────────────────────────────────────
    identidades = []
    for label, membros in enumerate(clusters, start=1):
        identidades.append(
            _describe_identity(label, membros, por_numero, leituras, squad, ancoras, aparencia, cor, grupo_cor, lado_por_grupo, indice),
        )
    progress(90)

    com_proposta = [i for i in identidades if i["proposedConfidence"] is not None]
    lidas = [i for i in identidades if i["jerseyNumber"] is not None]
    n_ocr_tentado = sum(1 for tid in ids if leituras.get(tid, {}).get("attempted"))
    return {
        "identities": identidades,
        "embeddingsKey": EMBEDDINGS_KEY,
        "confidence": {
            # A média das propostas que existem — e o que **não** tem proposta
            # não entra, porque não é um número, é uma pergunta a um humano.
            "player_identity": round(float(np.mean([i["proposedConfidence"] for i in com_proposta])), 2) if com_proposta else 0.0,
            "jersey_reading": round(len(lidas) / max(1, len(identidades)), 2),
        },
        "stats": {
            "tracksIn": len(tracks),
            "tracksWithCrops": len(ids),
            "identities": len(identidades),
            "withProposal": len(com_proposta),
            "withJersey": len(lidas),
            "ocrAttempted": n_ocr_tentado,
            "ocrAvailable": _OCR,
            "anchors": len(ancoras),
            "colourGroups": int(max(grupo_cor.values()) + 1) if grupo_cor else 0,
            "device": device,
            "reusedEmbeddings": bool(guardados),
        },
    }


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


def _download_json_gz(job_id: str, rel_path: str) -> dict[str, Any] | None:
    data = api.download_derived(job_id, rel_path)
    if data is None:
        return None
    return json.loads(gzip.decompress(data).decode("utf-8"))


def _download_sheets(job_id: str, indice: dict[str, Any]) -> dict[int, np.ndarray]:
    folhas: dict[int, np.ndarray] = {}
    for n in range(int(indice.get("sheets") or 0)):
        data = api.download_derived(job_id, f"crops/sheet-{n:03d}.jpg")
        if data is None:
            continue
        img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is not None:
            folhas[n] = img
    return folhas


# ---------------------------------------------------------------------------
# Aparência
# ---------------------------------------------------------------------------


def _appearance_embeddings(
    tiles_por_track: dict[int, list[np.ndarray]],
    device: str,
    progress: Callable[[int], None],
) -> dict[int, np.ndarray]:
    """Um vector por track: a média (normalizada) dos vectores dos seus recortes.

    ResNet-50 sem a última camada — 2048 números que descrevem "com o que é
    que isto se parece". Não sabe o que é um jogador; sabe que dois recortes da
    mesma camisola, mesmo calção e mesma altura se parecem mais um com o outro
    do que com um terceiro. É o que chega para colar fragmentos, e é honesto
    quanto ao que não chega — ver a confiança.
    """
    pesos = torchvision.models.ResNet50_Weights.IMAGENET1K_V2
    modelo = torchvision.models.resnet50(weights=pesos)
    modelo.fc = torch.nn.Identity()
    modelo.eval().to(device)
    media = torch.tensor([0.485, 0.456, 0.406], device=device).view(1, 3, 1, 1)
    desvio = torch.tensor([0.229, 0.224, 0.225], device=device).view(1, 3, 1, 1)

    ordem: list[tuple[int, np.ndarray]] = [(tid, t) for tid, tiles in tiles_por_track.items() for t in tiles]
    vetores: dict[int, list[np.ndarray]] = defaultdict(list)
    lote = 64
    with torch.inference_mode():
        for i in range(0, len(ordem), lote):
            parte = ordem[i : i + lote]
            x = np.stack([cv2.cvtColor(t, cv2.COLOR_BGR2RGB) for _, t in parte]).astype(np.float32) / 255.0
            xt = torch.from_numpy(x).permute(0, 3, 1, 2).to(device)
            xt = (xt - media) / desvio
            saida = modelo(xt).float().cpu().numpy()
            for (tid, _), v in zip(parte, saida):
                vetores[tid].append(v)
            progress(int(100 * (i + len(parte)) / max(1, len(ordem))))

    resultado: dict[int, np.ndarray] = {}
    for tid, vs in vetores.items():
        m = np.mean(np.stack(vs), axis=0)
        resultado[tid] = m / max(1e-6, float(np.linalg.norm(m)))
    return resultado


def _torso(tile: np.ndarray) -> np.ndarray:
    """A zona da camisola: entre os 22 % e os 55 % da altura, os 60 % centrais da largura."""
    h, w = tile.shape[:2]
    return tile[int(h * 0.22) : int(h * 0.55), int(w * 0.2) : int(w * 0.8)]


def _colour_descriptor(tiles: list[np.ndarray]) -> np.ndarray:
    """Histograma de matiz × saturação do tronco, somado sobre os recortes do track.

    Ignora píxeis quase cinzentos (o fundo neutro do azulejo, a relva pouco
    saturada) para o histograma ser da camisola e não do enquadramento.
    """
    hist = np.zeros((12, 4), dtype=np.float64)
    for t in tiles:
        hsv = cv2.cvtColor(_torso(t), cv2.COLOR_BGR2HSV)
        h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
        mascara = (s > 40) & (v > 40)
        if not mascara.any():
            continue
        hb = np.clip(h[mascara] // 15, 0, 11)
        sb = np.clip(s[mascara] // 64, 0, 3)
        np.add.at(hist, (hb, sb), 1)
    plano = hist.reshape(-1)
    total = plano.sum()
    return (plano / total).astype(np.float32) if total > 0 else plano.astype(np.float32)


def _colour_groups(ids: list[int], cor: dict[int, np.ndarray]) -> dict[int, int]:
    """Três grupos de cor — duas equipas e o resto (árbitros, treinadores).

    k-means simples sobre os histogramas, com 3 centróides. Não se dá nome
    aos grupos: saber qual é "a nossa" é uma confirmação humana, não uma
    adivinha.
    """
    if len(ids) < 3:
        return {tid: 0 for tid in ids}
    X = np.stack([cor[tid] for tid in ids])
    rng = np.random.default_rng(7)
    centros = X[rng.choice(len(X), size=3, replace=False)].copy()
    etiquetas = np.zeros(len(X), dtype=int)
    for _ in range(25):
        d = ((X[:, None, :] - centros[None, :, :]) ** 2).sum(axis=2)
        novas = d.argmin(axis=1)
        if np.array_equal(novas, etiquetas):
            break
        etiquetas = novas
        for k in range(3):
            if (etiquetas == k).any():
                centros[k] = X[etiquetas == k].mean(axis=0)
    # Os grupos ordenam-se por tamanho: 0 e 1 são as equipas, 2 é o resto.
    ordem = np.argsort([-(etiquetas == k).sum() for k in range(3)])
    remap = {int(k): int(i) for i, k in enumerate(ordem)}
    return {tid: remap[int(e)] for tid, e in zip(ids, etiquetas)}


# ---------------------------------------------------------------------------
# Números de camisola
# ---------------------------------------------------------------------------


def _read_jerseys(
    tiles_por_track: dict[int, list[np.ndarray]],
    boxes_por_track: dict[int, list[list[int]]],
    device: str,
    progress: Callable[[int], None],
) -> dict[int, dict[str, Any]]:
    """Por track: o número mais votado nos seus recortes, e a confiança.

    Só se tenta onde há píxeis (`OCR_MIN_BOX_HEIGHT` na caixa original). Nos
    outros fica `attempted: False` — não se lê, não se inventa. Sem EasyOCR
    instalado devolve tudo por tentar, e o resultado di-lo em `ocrAvailable`.
    """
    leituras: dict[int, dict[str, Any]] = {}
    if not _OCR:
        return {tid: {"attempted": False} for tid in tiles_por_track}

    leitor = easyocr.Reader(["en"], gpu=(device == "cuda"), verbose=False)
    total = len(tiles_por_track)
    for n, (tid, tiles) in enumerate(tiles_por_track.items()):
        votos: Counter[int] = Counter()
        confs: dict[int, list[float]] = defaultdict(list)
        tentou = False
        for tile, box in zip(tiles, boxes_por_track.get(tid, [])):
            if len(box) < 4 or box[3] < OCR_MIN_BOX_HEIGHT:
                continue
            tentou = True
            torso = _torso(tile)
            torso = cv2.resize(torso, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
            try:
                for _bbox, texto, conf in leitor.readtext(torso, allowlist="0123456789", detail=1, paragraph=False):
                    texto = texto.strip()
                    if not texto.isdigit() or not (1 <= len(texto) <= 2) or conf < OCR_MIN_CONF:
                        continue
                    numero = int(texto)
                    votos[numero] += 1
                    confs[numero].append(float(conf))
            except Exception:  # noqa: BLE001 — uma leitura que rebenta é uma leitura que falhou
                continue
        if votos:
            numero, n_votos = votos.most_common(1)[0]
            # Confiança: a média das leituras desse número, pesada pela unanimidade.
            unanimidade = n_votos / max(1, sum(votos.values()))
            conf = float(np.mean(confs[numero])) * (0.6 + 0.4 * unanimidade)
            leituras[tid] = {"attempted": True, "number": numero, "confidence": round(conf, 3), "votes": n_votos}
        else:
            leituras[tid] = {"attempted": tentou}
        if n % 25 == 0:
            progress(int(100 * (n + 1) / max(1, total)))
    return leituras


# ---------------------------------------------------------------------------
# Agrupamento
# ---------------------------------------------------------------------------


def _pair_distance(a: int, b: int, aparencia: dict[int, np.ndarray], cor: dict[int, np.ndarray]) -> float:
    cos = 1.0 - float(np.dot(aparencia[a], aparencia[b]))  # vectores já normalizados
    # Distância entre histogramas: metade da L1, em [0, 1].
    l1 = 0.5 * float(np.abs(cor[a] - cor[b]).sum())
    return W_APPEARANCE * cos + W_COLOUR * l1


def _distance_matrix(
    ids: list[int],
    aparencia: dict[int, np.ndarray],
    cor: dict[int, np.ndarray],
    por_numero: dict[int, dict[str, Any]],
    grupo_cor: dict[int, int],
) -> np.ndarray:
    n = len(ids)
    A = np.stack([aparencia[t] for t in ids]).astype(np.float32)
    C = np.stack([cor[t] for t in ids]).astype(np.float32)
    cos = 1.0 - A @ A.T
    l1 = 0.5 * np.abs(C[:, None, :] - C[None, :, :]).sum(axis=2)
    D = W_APPEARANCE * cos + W_COLOUR * l1
    np.fill_diagonal(D, 0.0)

    # As regras duras: ao mesmo tempo ⇒ pessoas diferentes; grupos de cor
    # diferentes ⇒ pessoas diferentes.
    ini = np.array([por_numero[t]["firstMs"] for t in ids])
    fim = np.array([por_numero[t]["lastMs"] for t in ids])
    sobre = np.minimum(fim[:, None], fim[None, :]) - np.maximum(ini[:, None], ini[None, :])
    D[sobre > OVERLAP_MS] = CANNOT_LINK
    g = np.array([grupo_cor.get(t, 0) for t in ids])
    D[g[:, None] != g[None, :]] = CANNOT_LINK
    np.fill_diagonal(D, 0.0)
    return np.maximum(D, 0.0)


def _cluster(ids: list[int], D: np.ndarray) -> list[list[int]]:
    """Agrupamento hierárquico com ligação **completa**.

    Completa e não média de propósito: com a média, dois grupos grandes podiam
    fundir-se apesar de um par lá dentro ser impossível (ao mesmo tempo em
    campo). Com a completa, basta um par impossível para a fusão não acontecer
    — é a regra dura a ser dura.
    """
    if len(ids) == 1:
        return [[ids[0]]]
    condensada = squareform(D, checks=False)
    Z = linkage(condensada, method="complete")
    etiquetas = fcluster(Z, t=CLUSTER_THRESHOLD, criterion="distance")
    grupos: dict[int, list[int]] = defaultdict(list)
    for tid, e in zip(ids, etiquetas):
        grupos[int(e)].append(tid)
    # Por ordem de entrada em campo, para o "Jogador 1" ser o primeiro que se vê.
    return sorted(grupos.values(), key=lambda m: min(m))


# ---------------------------------------------------------------------------
# Âncoras e propostas
# ---------------------------------------------------------------------------


def _anchors(
    confirmed: list[dict[str, Any]],
    aparencia: dict[int, np.ndarray],
    cor: dict[int, np.ndarray],
) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """Por atleta confirmado: o vector médio dos tracks que um humano lhe deu."""
    ancoras: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for c in confirmed:
        tids = [int(t) for t in c.get("trackNumbers") or [] if int(t) in aparencia and int(t) in cor]
        if not tids or not c.get("athleteId"):
            continue
        a = np.mean(np.stack([aparencia[t] for t in tids]), axis=0)
        a = a / max(1e-6, float(np.linalg.norm(a)))
        k = np.mean(np.stack([cor[t] for t in tids]), axis=0)
        ancoras[c["athleteId"]] = (a.astype(np.float32), k.astype(np.float32))
    return ancoras


def _sides_from_anchors(
    confirmed: list[dict[str, Any]],
    por_numero: dict[int, dict[str, Any]],
    grupo_cor: dict[int, int],
) -> dict[int, str]:
    """De que cor somos nós — só se alguém já o disse.

    Uma identidade confirmada como atleta do plantel pertence a um grupo de
    cor; esse grupo passa a "ours" e o outro grupo grande a "theirs". Sem
    confirmação nenhuma, ninguém tem lado — inventar um seria pior.
    """
    votos: Counter[int] = Counter()
    for c in confirmed:
        if not c.get("athleteId"):
            continue
        for t in c.get("trackNumbers") or []:
            g = grupo_cor.get(int(t))
            if g is not None and g in (0, 1):
                votos[g] += 1
    if not votos:
        return {}
    nosso = votos.most_common(1)[0][0]
    return {nosso: "ours", 1 - nosso: "theirs", 2: "unknown"}


def _describe_identity(
    label: int,
    membros: list[int],
    por_numero: dict[int, dict[str, Any]],
    leituras: dict[int, dict[str, Any]],
    squad: list[dict[str, Any]],
    ancoras: dict[str, tuple[np.ndarray, np.ndarray]],
    aparencia: dict[int, np.ndarray],
    cor: dict[int, np.ndarray],
    grupo_cor: dict[int, int],
    lado_por_grupo: dict[int, str],
    indice: dict[str, Any],
) -> dict[str, Any]:
    tracks = [por_numero[t] for t in membros]
    first_ms = min(t["firstMs"] for t in tracks)
    last_ms = max(t["lastMs"] for t in tracks)
    presenca = sum(max(0, t["lastMs"] - t["firstMs"]) for t in tracks)
    grupo = Counter(grupo_cor.get(t, 0) for t in membros).most_common(1)[0][0]
    lado = lado_por_grupo.get(grupo, "unknown")

    # Número de camisola: votação entre os tracks, pesada pela confiança.
    votos: dict[int, float] = defaultdict(float)
    contagem: Counter[int] = Counter()
    for t in membros:
        l = leituras.get(t) or {}
        if l.get("number") is not None:
            votos[l["number"]] += l.get("confidence", 0.0)
            contagem[l["number"]] += 1
    numero, numero_conf = None, None
    if votos:
        numero = max(votos, key=lambda n: votos[n])
        numero_conf = round(min(1.0, votos[numero] / max(1, contagem[numero]) * (0.7 + 0.3 * contagem[numero] / max(1, sum(contagem.values())))), 3)

    # Âncora mais parecida.
    a = np.mean(np.stack([aparencia[t] for t in membros]), axis=0)
    a = a / max(1e-6, float(np.linalg.norm(a)))
    k = np.mean(np.stack([cor[t] for t in membros]), axis=0)
    melhor_ancora, melhor_d = None, None
    for atleta, (va, vk) in ancoras.items():
        d = W_APPEARANCE * (1.0 - float(np.dot(a, va))) + W_COLOUR * 0.5 * float(np.abs(k - vk).sum())
        if melhor_d is None or d < melhor_d:
            melhor_ancora, melhor_d = atleta, d

    # Este grupo já contém tracks confirmados de alguém? Então **é** essa pessoa.
    confirmado_dentro = None
    for t in membros:
        if por_numero[t].get("confirmedAthleteId"):
            confirmado_dentro = por_numero[t]["confirmedAthleteId"]
            break

    sinais: dict[str, Any] = {"colourGroup": grupo}
    proposta, confianca = None, None

    if confirmado_dentro:
        proposta, confianca = confirmado_dentro, 1.0
        sinais["anchorInside"] = True
    else:
        # Sinal 1: o número, se houver exactamente um atleta do plantel com ele —
        # e se não estivermos a olhar para a outra equipa.
        candidatos_num = [s for s in squad if numero is not None and s.get("jerseyNumber") == numero]
        if numero is not None and len(candidatos_num) == 1 and lado != "theirs":
            proposta, confianca = candidatos_num[0]["athleteId"], numero_conf
            sinais["jersey"] = {"number": numero, "confidence": numero_conf}
        # Sinal 2: parece-se com alguém confirmado.
        if melhor_ancora is not None and melhor_d is not None and melhor_d < ANCHOR_THRESHOLD:
            conf_ancora = round(max(0.0, 1.0 - melhor_d / ANCHOR_THRESHOLD) * 0.9, 3)
            sinais["anchor"] = {"athleteId": melhor_ancora, "distance": round(melhor_d, 3), "confidence": conf_ancora}
            if proposta is None:
                proposta, confianca = melhor_ancora, conf_ancora
            elif proposta == melhor_ancora:
                confianca = round(min(0.98, max(confianca or 0, conf_ancora) + 0.1), 3)
            else:
                # Dois sinais em desacordo: não se escolhe por eles — pede-se a um humano.
                confianca = round(min(confianca or 0, conf_ancora) * 0.5, 3)
                sinais["conflict"] = True

    # Os recortes que o treinador vai ver: até três, espalhados pelos tracks.
    recortes: list[dict[str, Any]] = []
    for t in sorted(membros, key=lambda x: por_numero[x]["firstMs"]):
        for r in indice["tracks"].get(str(t), []):
            recortes.append({"s": r["s"], "i": r["i"], "ts": r["ts"], "track": t})
    if len(recortes) > 3:
        passo = len(recortes) / 3
        recortes = [recortes[int(i * passo)] for i in range(3)]

    return {
        "label": label,
        "trackNumbers": sorted(membros),
        "firstMs": int(first_ms),
        "lastMs": int(last_ms),
        "presenceMs": int(presenca),
        "jerseyNumber": numero,
        "jerseyConfidence": numero_conf,
        "proposedAthleteId": proposta,
        "proposedConfidence": confianca,
        "anchorAthleteId": confirmado_dentro,
        "side": lado,
        "summary": {"crops": recortes, "signals": sinais},
    }
