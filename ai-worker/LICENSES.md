# Modelos e bibliotecas — licenças

A Academias é um SaaS comercial de código fechado. A regra é simples: **nada
entra sem licença permissiva** (MIT, BSD, Apache-2.0) ou, no caso de binários
chamados por processo (FFmpeg), LGPL sem linkagem. Copyleft forte (GPL/AGPL)
está excluído — não por ser mau software, mas porque contaminaria o produto.

## Em uso

| Componente | Papel | Licença | Comercial? |
|---|---|---|---|
| OpenCV (`opencv-python`) | leitura de frames, métricas de qualidade, optical flow | Apache-2.0 | ✔ |
| NumPy | tudo | BSD-3 | ✔ |
| FFmpeg (`ffprobe`, CLI) | metadados do vídeo | LGPL-2.1+ (chamado por processo, sem linkagem) | ✔ |
| PyTorch | runtime dos modelos | BSD-3 | ✔ |
| torchvision — Faster R-CNN / RetinaNet (pesos COCO) | detecção de pessoas | BSD-3 (código e pesos) | ✔ |
| `supervision` (Roboflow) — ByteTrack | tracking multi-objecto | MIT | ✔ |
| `requests` | HTTP com a API | Apache-2.0 | ✔ |

## Avaliados e excluídos

| Componente | Licença | Porquê fora |
|---|---|---|
| **Ultralytics YOLOv8/v11** | **AGPL-3.0** | AGPL obriga a abrir o código de qualquer serviço em rede que o use. A alternativa é a licença comercial paga da Ultralytics — contra o objectivo de custo zero no MVP. |
| YOLOv9 (WongKinYiu) | GPL-3.0 | Copyleft forte. |
| YOLO-NAS (Deci) | pesos com licença própria restritiva | Restringe redistribuição/uso dos pesos. |
| PaddleDetection | Apache-2.0 | Compatível, mas traz o ecossistema Paddle inteiro; fica como opção se a precisão do torchvision não chegar. |

## Upgrades compatíveis já identificados

Quando a precisão ou a velocidade do detector deixar de chegar, os candidatos
com licença limpa são, por ordem:

1. **RF-DETR** (Roboflow) — Apache-2.0, estado da arte em tempo real.
2. **YOLOX** (Megvii) — Apache-2.0, maduro e leve.
3. **Re-identificação**: OSNet via `torchreid` — MIT.

Qualquer entrada nova nesta tabela passa pelo mesmo crivo **antes** de entrar
no `requirements.txt` — e o worker regista-a em `AIModelVersion` com a licença
escrita, para a proveniência dos números ficar na base e não na memória de
quem integrou.
