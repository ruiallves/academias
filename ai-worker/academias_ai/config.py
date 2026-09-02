"""Configuração do worker — tudo vem do ambiente, com um .env opcional.

Sem biblioteca de dotenv: são quatro variáveis, e um parser de oito linhas não
diverge de ninguém.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Carrega um .env ao lado do package, sem pisar o ambiente real."""
    env = Path(__file__).resolve().parent.parent / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

API_URL = os.environ.get("ACADEMIAS_API_URL", "http://localhost:3000").rstrip("/")
TOKEN = os.environ.get("AI_WORKER_TOKEN", "")
WORKER_NAME = os.environ.get("AI_WORKER_NAME", "local-dev")
POLL_SECONDS = float(os.environ.get("AI_WORKER_POLL_SECONDS", "5"))


def validate() -> None:
    if not TOKEN or len(TOKEN) < 16:
        raise SystemExit(
            "AI_WORKER_TOKEN em falta ou demasiado curto (mínimo 16 caracteres).\n"
            "Tem de ser o mesmo valor que a API tem no ambiente dela — ver .env.example."
        )
