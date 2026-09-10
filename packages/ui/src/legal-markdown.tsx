import { Fragment, type ReactNode } from "react";

/**
 * O Markdown dos documentos legais, em React.
 *
 * ## Porque não uma biblioteca
 *
 * O texto vem da base de dados, escrito por um administrador da plataforma —
 * gente nossa, mas ainda assim texto que atravessa a rede e acaba no DOM de
 * quatro aplicações. Um renderizador de Markdown completo traz HTML embutido,
 * imagens, e um perímetro de segurança que ninguém aqui quer manter. Este
 * conhece **só** o que um documento legal precisa: títulos, parágrafos, listas,
 * negrito, itálico e ligações. Nunca produz HTML a partir do texto; tudo é
 * texto de React, e uma tag escrita no documento aparece como texto.
 *
 * ## O que suporta
 *
 *   `# `, `## `, `### `   títulos (o `#` de topo é rebaixado para h2: o h1 é da página)
 *   `- ` / `* `           lista
 *   `1. `                 lista numerada
 *   `**negrito**`, `*itálico*`
 *   `[texto](https://…)`  ligações — só http(s), mailto e caminhos relativos
 *   linha em branco       separa parágrafos
 *
 * É a mesma peça nas quatro apps — site, consola, app do clube, plataforma —
 * para o mesmo documento ler igual em todo o lado. A tipografia é de quem o
 * inclui, através de `className`; aqui só há estrutura.
 */
export function LegalMarkdown({ content, className }: { content: string; className?: string }) {
  return <div className={className}>{render(content)}</div>;
}

type Block =
  | { kind: "h"; level: 2 | 3 | 4; text: string; id: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

/** Os títulos, para um índice lateral. */
export function legalHeadings(content: string): { id: string; text: string; level: number }[] {
  return blocks(content)
    .filter((b): b is Extract<Block, { kind: "h" }> => b.kind === "h")
    .map((b) => ({ id: b.id, text: b.text, level: b.level }));
}

function blocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const seen = new Map<string, number>();

  const flushPara = () => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list) out.push(list);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      const level = Math.min(4, Math.max(2, h[1].length + 1)) as 2 | 3 | 4;
      const text = h[2].trim();
      let id = slug(text);
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n > 0) id = `${id}-${n + 1}`;
      out.push({ kind: "h", level, text, id });
      continue;
    }
    const ul = /^[-*]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (!list || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(ul[1]);
      continue;
    }
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (!list || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(ol[1]);
      continue;
    }
    // Continuação de um item de lista, indentada.
    if (list && /^\s{2,}\S/.test(raw)) {
      list.items[list.items.length - 1] += " " + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return out;
}

function render(src: string): ReactNode {
  return blocks(src).map((b, i) => {
    switch (b.kind) {
      case "h": {
        const Tag = `h${b.level}` as "h2" | "h3" | "h4";
        return (
          <Tag key={i} id={b.id}>
            {inline(b.text)}
          </Tag>
        );
      }
      case "p":
        return <p key={i}>{inline(b.text)}</p>;
      case "ul":
        return (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ul>
        );
      case "ol":
        return (
          <ol key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it)}</li>
            ))}
          </ol>
        );
    }
  });
}

/** Negrito, itálico e ligações. Uma passagem só, da esquerda para a direita. */
function inline(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={k++}>{m[4]}</em>);
    else if (m[5]) {
      const href = m[7];
      if (safeHref(href)) {
        const external = /^https?:/i.test(href);
        parts.push(
          <a key={k++} href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>
            {m[6]}
          </a>,
        );
      } else {
        parts.push(m[6]);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}

function safeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href) && !/[<>"']/.test(href);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "seccao";
}
