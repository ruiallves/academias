#!/usr/bin/env node
/**
 * A biblioteca de arranque — os exercícios clássicos, para nenhum treinador
 * começar com uma biblioteca vazia.
 *
 * ## O que aqui vive
 *
 * Os exercícios que qualquer curso de treinadores ensina, de futebol e de
 * futsal: rondos, jogos posicionais, ondas de transição, Y de passe, rotações
 * de 4-0, paralela e diagonal. Cada um com ficha completa (regras, correções,
 * progressões) e desenho com frames — servem como treino e como demonstração
 * do editor.
 *
 * ## Como se comporta
 *
 * Idempotente por nome e por academia: correr duas vezes não duplica nada.
 * Um exercício **arquivado** conta como existente — um clube que arquivou um
 * destes decidiu não o querer, e a semente respeita isso. (Um apagado a sério
 * volta na próxima corrida; quem não os quer, arquiva.)
 *
 * Sem autor (`createdById` nulo): são do clube, não de uma pessoa — e é também
 * o que faz com que só a direção/coordenação os possa editar ou apagar.
 *
 * Uso:
 *   node scripts/seed-exercises.mjs            # todas as academias
 *   node scripts/seed-exercises.mjs life-club  # uma só, pelo slug
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

/* -------------------------------------------------------------------------- */
/* Peças de desenho                                                            */
/* -------------------------------------------------------------------------- */

const id = () => randomBytes(6).toString("hex");
const item = (kind, x, y, label, extra = {}) => ({ id: id(), kind, x, y, ...(label ? { label } : {}), ...extra });
const P = (x, y, n) => item("player", x, y, String(n));
const PB = (x, y, n) => item("playerBall", x, y, String(n));
const O = (x, y, n) => item("opponent", x, y, String(n));
const GK = (x, y) => item("gk", x, y, "GR");
const BALL = (x, y) => item("ball", x, y);
const CONE = (x, y) => item("cone", x, y);
const MINI = (x, y) => item("miniGoal", x, y);
const ZONE = (x, y, w, h, label) => item("zone", x, y, label, { w, h });
const arrow = (kind, x1, y1, x2, y2) => ({ id: id(), kind, x1, y1, x2, y2 });
const pass = (...a) => arrow("pass", ...a);
const run = (...a) => arrow("run", ...a);
const dribble = (...a) => arrow("dribble", ...a);
const shot = (...a) => arrow("shot", ...a);
const press = (...a) => arrow("press", ...a);
const cross = (...a) => arrow("cross", ...a);
const frame = (items, arrows = [], durationMs = 1500) => ({ id: id(), durationMs, items, arrows });

/** Reposiciona uma lista de elementos (cópia com novos x/y por id de índice). */
const move = (items, changes) => items.map((it, i) => (changes[i] ? { ...it, ...changes[i] } : { ...it }));

/* -------------------------------------------------------------------------- */
/* Futebol                                                                     */
/* -------------------------------------------------------------------------- */

function rondo5v2() {
  // Um octógono de 8×8 ao centro; 5 de fora, 2 dentro.
  const z = ZONE(52.5, 34, 10, 10);
  const f1i = [z, PB(47.5, 34, 1), P(52.5, 29, 2), P(57.5, 34, 3), P(52.5, 39, 4), P(49, 30.5, 5), O(51, 33, "A"), O(54, 35, "B")];
  const f1a = [pass(48.5, 34, 51.5, 29.5)];
  const f2i = move(f1i, { 1: { kind: "player" }, 2: { kind: "playerBall" }, 6: { x: 51.5, y: 31 }, 7: { x: 53, y: 33.5 } });
  const f2a = [pass(53, 29.5, 56.5, 33.5)];
  const f3i = move(f2i, { 2: { kind: "player" }, 3: { kind: "playerBall" }, 6: { x: 53, y: 32.5 }, 7: { x: 55, y: 34 } });
  const f3a = [pass(56.5, 34.5, 53, 38.5), run(51, 33, 52.5, 35.5)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function rondo4v2() {
  const z = ZONE(52.5, 34, 8, 8);
  const f1i = [z, PB(48.5, 34, 1), P(52.5, 30, 2), P(56.5, 34, 3), P(52.5, 38, 4), O(51.5, 33, "A"), O(53.5, 35, "B")];
  const f1a = [pass(49.5, 33.5, 51.5, 30.5)];
  const f2i = move(f1i, { 1: { kind: "player" }, 2: { kind: "playerBall" }, 5: { x: 52, y: 31.5 } });
  const f2a = [pass(53.5, 30.5, 55.5, 33.5)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a)] };
}

function posse443() {
  const z = ZONE(52.5, 34, 22, 22);
  const f1i = [
    z,
    PB(43, 28, 4), P(46, 42, 6), P(58, 26, 7), P(60, 40, 8),
    P(52.5, 34, 10), P(43, 34, 5), P(62, 34, 11),
    O(49, 31, "A"), O(55, 31, "B"), O(50, 38, "C"), O(56, 38, "D"),
  ];
  const f1a = [pass(44, 29, 51, 33), run(58, 27, 55, 30)];
  const f2i = move(f1i, { 1: { kind: "player" }, 5: { kind: "playerBall" }, 8: { x: 50.5, y: 33 }, 9: { x: 54, y: 33.5 } });
  const f2a = [pass(53.5, 34.5, 59.5, 39), pass(53.5, 33.5, 61, 34)];
  const f3i = move(f2i, { 5: { kind: "player" }, 4: { kind: "playerBall", x: 60, y: 40 }, 10: { x: 53, y: 37 } });
  const f3a = [pass(60.5, 39, 57.5, 27), run(52.5, 34, 56, 31)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function posse6v4() {
  const z = ZONE(38, 34, 26, 30);
  const f1i = [
    z,
    GK(6, 34), PB(28, 24, 2), P(26, 44, 3), P(38, 20, 6), P(38, 48, 8), P(46, 30, 10), P(46, 40, 5),
    O(33, 28, "A"), O(33, 40, "B"), O(41, 26, "C"), O(41, 42, "D"),
  ];
  const f1a = [pass(29, 25, 37, 21), press(33.5, 28.5, 30, 25)];
  const f2i = move(f1i, { 2: { kind: "player" }, 4: { kind: "playerBall" }, 8: { x: 36, y: 24 }, 10: { x: 41, y: 23 } });
  const f2a = [pass(39, 21, 45, 29), run(46, 40, 49, 36)];
  const f3i = move(f2i, { 4: { kind: "player" }, 6: { kind: "playerBall" }, 9: { x: 38, y: 36 } });
  const f3a = [dribble(47, 30, 54, 32)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function yPasse() {
  const f1i = [
    CONE(40, 34), CONE(52, 34), CONE(60, 26), CONE(60, 42),
    PB(38, 34, 1), P(52, 34, 2), P(60, 26, 3), P(60, 42, 4),
  ];
  const f1a = [pass(39.5, 34, 50.5, 34)];
  const f2i = move(f1i, { 4: { kind: "player" }, 5: { kind: "playerBall" } });
  const f2a = [pass(53, 33, 59, 27), run(52, 35, 56, 39)];
  const f3i = move(f2i, { 5: { kind: "player", x: 56, y: 38 }, 6: { kind: "playerBall" } });
  const f3a = [pass(60, 27.5, 57, 36.5), run(60, 41, 63, 36)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function terceiroHomem() {
  const f1i = [CONE(42, 26), CONE(42, 42), CONE(56, 34), PB(40, 26, 1), P(40, 42, 2), P(55, 34, 3)];
  const f1a = [pass(41.5, 27, 53.5, 33)];
  const f2i = move(f1i, { 3: { kind: "player" }, 5: { kind: "playerBall" } });
  const f2a = [pass(54, 34.5, 42, 41), run(40, 27, 46, 30)];
  const f3i = move(f2i, { 5: { kind: "player" }, 4: { kind: "playerBall", x: 41, y: 41 }, 3: { x: 46, y: 30 } });
  const f3a = [pass(42.5, 40.5, 46, 31.5)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function cruzamentos() {
  const f1i = [GK(101, 34), PB(70, 10, 7), P(72, 30, 9), P(74, 42, 10), P(66, 24, 8), O(90, 30, "2"), O(90, 38, "5")];
  const f1a = [dribble(71, 11, 84, 8)];
  const f2i = move(f1i, { 1: { x: 84, y: 8 }, 2: { x: 86, y: 30 }, 3: { x: 88, y: 40 }, 4: { x: 78, y: 26 } });
  const f2a = [cross(85, 9, 95, 30), run(80, 30, 92, 30), run(82, 41, 94, 38)];
  const f3i = move(f2i, { 1: { kind: "player" }, 2: { kind: "playerBall", x: 93, y: 30 } });
  const f3a = [shot(94, 31, 103, 34)];
  return { field: "f11-half", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function umContraUm() {
  const f1i = [MINI(76, 24), MINI(76, 44), PB(56, 34, 1), O(66, 34, "A"), CONE(56, 28), CONE(56, 40)];
  const f1a = [dribble(57, 34, 63, 31)];
  const f2i = move(f1i, { 2: { x: 63, y: 31 }, 3: { x: 66, y: 32 } });
  const f2a = [dribble(64, 31, 71, 27), press(66, 32.5, 68, 30)];
  const f3i = move(f2i, { 2: { x: 71, y: 27 } });
  const f3a = [shot(72, 26.5, 75.5, 24.5)];
  return { field: "f11-half", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function ondas3v2() {
  const f1i = [GK(101, 34), PB(56, 34, 8), P(58, 22, 7), P(58, 46, 11), O(80, 28, "4"), O(80, 40, "5")];
  const f1a = [dribble(57, 34, 66, 34), run(60, 23, 72, 24), run(60, 45, 72, 44)];
  const f2i = move(f1i, { 1: { x: 68, y: 34 }, 2: { x: 74, y: 24 }, 3: { x: 74, y: 44 }, 4: { x: 82, y: 30 }, 5: { x: 82, y: 38 } });
  const f2a = [pass(69.5, 33, 73.5, 26), run(69, 36, 76, 38)];
  const f3i = move(f2i, { 1: { kind: "player", x: 76, y: 37 }, 2: { kind: "playerBall", x: 76, y: 25 } });
  const f3a = [shot(77.5, 25.5, 100, 32)];
  return { field: "f11-half", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function reacaoAPerda() {
  const z = ZONE(52.5, 34, 20, 20);
  const f1i = [
    z,
    P(44, 28, 1), P(44, 40, 2), PB(52, 26, 3), P(52, 42, 4), P(59, 34, 5),
    O(50, 32, "A"), O(54, 36, "B"), O(48, 38, "C"),
  ];
  const f1a = [pass(52.5, 27.5, 57.5, 33)];
  // A bola perde-se: o "B" intercepta — e os cinco reagem em cima.
  const f2i = move(f1i, { 3: { kind: "player" }, 7: { kind: "opponent", x: 55.5, y: 34.5 } });
  const f2a = [press(52.5, 27.5, 54.5, 33), press(58, 34, 56.5, 34.5), press(52.5, 41, 55, 36.5)];
  const f3i = move(f2i, { 5: { x: 56.5, y: 33.5 }, 3: { x: 54, y: 31 }, 4: { x: 54.5, y: 38 } });
  const f3a = [press(54.5, 31.5, 55.5, 33.5)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a, 1800), frame(f3i, f3a)] };
}

function jogo4v4Coberturas() {
  const f1i = [
    MINI(36, 20), MINI(36, 48), MINI(69, 20), MINI(69, 48),
    P(48, 24, 2), P(46, 34, 4), P(48, 44, 3), P(53, 34, 6),
    O(58, 24, "A"), O(60, 34, "B"), O(58, 44, "C"), item("opponent", 55, 30, "D"),
    BALL(56, 30),
  ];
  const f1a = [press(49, 25, 54, 29), run(47, 34, 50, 30)];
  const f2i = move(f1i, { 4: { x: 52, y: 27 }, 5: { x: 50, y: 31 }, 6: { x: 49, y: 41 }, 7: { x: 54, y: 36 } });
  const f2a = [press(52.5, 28, 54.5, 29.5), run(50, 32, 52, 33)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a)] };
}

function posicional3Corredores() {
  const f1i = [
    ZONE(52.5, 12, 60, 16, "Corredor direito"), ZONE(52.5, 34, 60, 20), ZONE(52.5, 56, 60, 16, "Corredor esquerdo"),
    GK(8, 34), PB(30, 34, 5), P(40, 14, 2), P(42, 34, 6), P(40, 54, 3), P(56, 24, 8), P(56, 44, 10), P(66, 34, 9),
    O(48, 28, "A"), O(48, 40, "B"), O(58, 34, "C"),
  ];
  const f1a = [pass(31.5, 33, 39, 15.5), run(55, 25, 50, 22)];
  const f2i = move(f1i, { 4: { kind: "player" }, 5: { kind: "playerBall" }, 8: { x: 50, y: 21 } });
  const f2a = [pass(41, 15, 49, 20), run(56, 44, 60, 38)];
  const f3i = move(f2i, { 5: { kind: "player" }, 8: { kind: "playerBall" } });
  const f3a = [pass(51, 21.5, 65, 32), run(66, 35, 70, 30)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function circuitoVelocidade() {
  const f1i = [
    item("ladder", 40, 26), CONE(46, 26), CONE(50, 26), item("pole", 54, 26), item("pole", 58, 26),
    MINI(72, 26), P(36, 26, 1), P(36, 32, 2), GK(70, 30),
    BALL(62, 26),
  ];
  const f1a = [run(37.5, 26, 39, 26)];
  const f2i = move(f1i, { 6: { x: 52, y: 26 } });
  const f2a = [run(44, 26, 51, 26), run(53, 26, 60, 26)];
  const f3i = move(f2i, { 6: { x: 61, y: 26 } });
  const f3a = [shot(62.5, 26, 71, 26)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function ativacaoComBola() {
  const f1i = [
    ZONE(52.5, 34, 24, 18),
    PB(44, 28, 1), PB(48, 40, 2), PB(56, 26, 3), PB(60, 38, 4), P(52, 33, 5), P(46, 34, 6),
  ];
  const f1a = [dribble(45, 29, 50, 31), dribble(57, 27, 54, 30)];
  const f2i = move(f1i, { 1: { x: 50, y: 31 }, 3: { x: 54, y: 30 }, 5: { x: 49, y: 37 } });
  const f2a = [dribble(49, 39, 45, 35), dribble(59, 37, 56, 33)];
  return { field: "f11", frames: [frame(f1i, f1a), frame(f2i, f2a)] };
}

/* -------------------------------------------------------------------------- */
/* Futebol 7 e 9                                                               */
/* -------------------------------------------------------------------------- */
//
// Os escaloes que jogam a 7 e a 9 nao treinam num campo de onze encolhido: as
// distancias sao outras, e um exercicio desenhado a 105x68 mostrado num campo
// de 55x37 poe toda a gente fora das linhas. Estes vivem no terreno deles.

function f7Posse4v2() {
  const z = ZONE(27.5, 18.5, 16, 14);
  const f1i = [z, PB(21, 13, 4), P(21, 24, 3), P(34, 13, 7), P(34, 24, 8), O(26, 17, "A"), O(29, 20, "B")];
  const f1a = [pass(22, 13.5, 33, 13.5)];
  const f2i = move(f1i, { 1: { kind: "player" }, 3: { kind: "playerBall" }, 5: { x: 29, y: 15 } });
  const f2a = [pass(34, 14.5, 34.5, 23), run(21, 24, 26, 26)];
  return { field: "f7", frames: [frame(f1i, f1a), frame(f2i, f2a)] };
}

function f7SaidaGR() {
  const f1i = [
    GK(4, 18.5), PB(12, 9, 2), P(12, 28, 3), P(24, 18.5, 4), P(38, 8, 7), P(38, 29, 11),
    O(20, 12, "A"), O(20, 25, "B"), O(30, 18.5, "C"),
  ];
  const f1a = [pass(5, 18, 11, 9.5), press(20, 12.5, 14, 10)];
  const f2i = move(f1i, { 1: { kind: "player" }, 2: { kind: "playerBall", x: 12, y: 9 }, 6: { x: 16, y: 10 } });
  const f2a = [pass(13, 10, 23, 18), run(24, 18.5, 28, 15)];
  const f3i = move(f2i, { 2: { kind: "player" }, 3: { kind: "playerBall", x: 27, y: 16 } });
  const f3a = [pass(28, 15.5, 37, 8.5)];
  return { field: "f7", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function f7Finalizacao() {
  const f1i = [GK(51, 18.5), PB(30, 8, 7), P(32, 18.5, 9), P(30, 29, 11), CONE(30, 13), CONE(30, 24)];
  const f1a = [dribble(31, 8.5, 38, 8), run(33, 18, 42, 16)];
  const f2i = move(f1i, { 1: { x: 38, y: 8 }, 2: { x: 42, y: 16 }, 3: { x: 40, y: 26 } });
  const f2a = [cross(39, 8.5, 44, 16)];
  const f3i = move(f2i, { 1: { kind: "player" }, 2: { kind: "playerBall", x: 44, y: 16 } });
  const f3a = [shot(45, 16.5, 53, 18)];
  return { field: "f7", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function f7Pressao() {
  const f1i = [
    MINI(6, 13), MINI(6, 24), MINI(49, 13), MINI(49, 24),
    P(20, 12, 2), P(20, 25, 3), P(28, 18.5, 4),
    O(34, 12, "A"), O(34, 25, "B"), O(40, 18.5, "C"), BALL(35, 12.5),
  ];
  const f1a = [press(21, 12, 32, 12), run(28, 18.5, 33, 17)];
  const f2i = move(f1i, { 4: { x: 31, y: 12.5 }, 6: { x: 33, y: 17 } });
  const f2a = [press(32, 13, 33.5, 12.5)];
  return { field: "f7", frames: [frame(f1i, f1a), frame(f2i, f2a)] };
}

function f9Construcao() {
  const f1i = [
    GK(5, 25), PB(16, 10, 2), P(13, 25, 4), P(16, 40, 3), P(32, 25, 6), P(45, 12, 7), P(45, 38, 11), P(55, 25, 9),
    O(24, 18, "A"), O(24, 32, "B"), O(38, 25, "C"),
  ];
  const f1a = [pass(17, 10.5, 31, 24), run(45, 12, 40, 16)];
  const f2i = move(f1i, { 1: { kind: "player" }, 4: { kind: "playerBall" }, 5: { x: 40, y: 16 }, 8: { x: 28, y: 20 } });
  const f2a = [pass(33, 24, 39.5, 16.5), run(55, 25, 58, 20)];
  const f3i = move(f2i, { 4: { kind: "player" }, 5: { kind: "playerBall" } });
  const f3a = [pass(41, 16.5, 57, 21)];
  return { field: "f9", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function f9Transicao() {
  const f1i = [GK(67, 25), PB(30, 25, 6), P(33, 13, 7), P(33, 37, 11), O(50, 19, "4"), O(50, 31, "5")];
  const f1a = [dribble(31, 25, 40, 25), run(35, 14, 46, 15), run(35, 36, 46, 35)];
  const f2i = move(f1i, { 1: { x: 42, y: 25 }, 2: { x: 47, y: 15 }, 3: { x: 47, y: 35 }, 4: { x: 52, y: 21 }, 5: { x: 52, y: 29 } });
  const f2a = [pass(43, 24, 46, 17)];
  const f3i = move(f2i, { 1: { kind: "player" }, 2: { kind: "playerBall", x: 49, y: 16 } });
  const f3a = [shot(50, 17, 66, 23)];
  return { field: "f9", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function f9Bloco() {
  const f1i = [
    GK(5, 25), P(16, 12, 2), P(14, 25, 4), P(16, 38, 3), P(28, 15, 6), P(26, 25, 8), P(28, 35, 10),
    O(40, 12, "A"), O(38, 25, "B"), O(40, 38, "C"), BALL(41, 12.5),
    ZONE(22, 25, 22, 30, "Bloco medio"),
  ];
  const f1a = [press(29, 15, 38, 13), run(26, 25, 31, 19)];
  const f2i = move(f1i, { 4: { x: 36, y: 13.5 }, 5: { x: 31, y: 19 }, 1: { x: 20, y: 14 } });
  const f2a = [press(37, 13.5, 39.5, 12.8)];
  return { field: "f9", frames: [frame(f1i, f1a), frame(f2i, f2a)] };
}

/* -------------------------------------------------------------------------- */
/* Futsal                                                                      */
/* -------------------------------------------------------------------------- */

function rotacao40() {
  const f1i = [GK(3, 10), PB(16, 4, 2), P(14, 9, 3), P(14, 12, 4), P(16, 16, 5)];
  const f1a = [pass(16.5, 5, 15, 8.5), run(16, 4.5, 22, 6)];
  const f2i = move(f1i, { 1: { kind: "player", x: 22, y: 6 }, 2: { kind: "playerBall" } });
  const f2a = [pass(15, 9.5, 14.5, 11.5), run(14, 9, 16, 4)];
  const f3i = move(f2i, { 2: { kind: "player", x: 16, y: 4 }, 3: { kind: "playerBall" } });
  const f3a = [pass(15, 12.5, 15.5, 15.5), run(14, 12, 22, 14)];
  return { field: "futsal", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function paralelaDiagonal() {
  const f1i = [GK(38.5, 10), PB(24, 3, 7), P(22, 16, 10), O(30, 6, "2")];
  const f1a = [run(25, 4, 33, 3.5), dribble(24.5, 3.5, 27, 4)];
  // Paralela: a bola segue a linha; diagonal: o outro ataca o segundo poste.
  const f2i = move(f1i, { 1: { kind: "player", x: 27, y: 4 }, 2: { x: 26, y: 13 } });
  const f2a = [pass(28, 4.5, 34, 3.5), run(27, 13, 34, 12)];
  const f3i = move(f2i, { 2: { x: 34, y: 12, kind: "playerBall" }, 1: { x: 34, y: 4 } });
  const f3a = [shot(35, 11.5, 38.5, 9.5)];
  return { field: "futsal", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function jogoComPivo() {
  const f1i = [GK(3, 10), PB(15, 10, 4), P(22, 4, 7), P(22, 16, 10), P(31, 10, 9), O(27, 10, "F"), O(24, 6, "A")];
  const f1a = [pass(16.5, 10, 29.5, 10)];
  const f2i = move(f1i, { 1: { kind: "player" }, 4: { kind: "playerBall" }, 2: { x: 26, y: 5 } });
  const f2a = [run(23, 15, 28, 14), pass(30.5, 11, 28.5, 13.5)];
  const f3i = move(f2i, { 4: { kind: "player" }, 3: { kind: "playerBall", x: 28.5, y: 14 } });
  const f3a = [shot(29.5, 13.5, 38, 10.5)];
  return { field: "futsal", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function posse3v3mais1() {
  const z = ZONE(30, 10, 16, 14);
  const f1i = [z, PB(24, 5, 1), P(24, 15, 2), P(36, 5, 3), item("player", 30, 10, "J"), O(28, 7, "A"), O(31, 12, "B"), O(27, 13, "C")];
  const f1a = [pass(25, 6, 29, 9.5)];
  const f2i = move(f1i, { 1: { kind: "player" }, 4: { kind: "playerBall" }, 5: { x: 29, y: 9 } });
  const f2a = [pass(31, 10.5, 35, 6), run(24, 14, 27, 16)];
  return { field: "futsal", frames: [frame(f1i, f1a), frame(f2i, f2a)] };
}

function transicao2v1() {
  const f1i = [GK(38.5, 10), PB(18, 7, 7), P(19, 14, 9), O(29, 10, "D")];
  const f1a = [dribble(19, 7.5, 25, 8), run(21, 14, 28, 15)];
  const f2i = move(f1i, { 1: { x: 25, y: 8 }, 2: { x: 28, y: 15 }, 3: { x: 31, y: 11 } });
  const f2a = [pass(26.5, 8.5, 28.5, 13.5)];
  const f3i = move(f2i, { 1: { kind: "player" }, 2: { kind: "playerBall", x: 30, y: 14 } });
  const f3a = [shot(31, 13.5, 38, 10.5)];
  return { field: "futsal", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function defesa1v1() {
  const f1i = [GK(3, 10), O(20, 10, "A"), P(15, 10, 1), BALL(21.2, 10), CONE(24, 5), CONE(24, 15)];
  const f1a = [press(14.5, 10, 17.5, 10)];
  const f2i = move(f1i, { 1: { x: 17, y: 7 }, 2: { x: 14, y: 8.5 }, 3: { x: 18.2, y: 7 } });
  const f2a = [run(16.5, 7.5, 12, 6.5), press(14, 9, 15.5, 7.8)];
  return { field: "futsal", frames: [frame(f1i, f1a), frame(f2i, f2a)] };
}

function saidaPressao3() {
  const f1i = [GK(3, 10), P(8, 5, 2), P(8, 15, 3), P(14, 10, 4), O(11, 7, "A"), O(11, 13, "B")];
  const f1a = [pass(4.5, 9.5, 7, 6), run(13, 10, 9, 10)];
  const f2i = move(f1i, { 1: { kind: "playerBall", x: 8, y: 5 }, 3: { x: 9, y: 10 } });
  const f2a = [pass(9, 6, 9, 9), press(11, 7.5, 9.5, 6)];
  const f3i = move(f2i, { 1: { kind: "player" }, 3: { kind: "playerBall" } });
  const f3a = [pass(10, 10.5, 20, 14), run(8, 14.5, 20, 15)];
  return { field: "futsal", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

function powerPlay() {
  const f1i = [item("player", 16, 10, "GRJ"), P(24, 3.5, 7), P(24, 16.5, 10), P(30, 7, 9), PB(30, 13, 8), O(33, 8, "A"), O(33, 12, "B"), O(29, 10, "C"), O(35, 10, "D"), GK(38.7, 10)];
  const f1a = [pass(29, 13, 25.5, 16)];
  const f2i = move(f1i, { 4: { kind: "player" }, 2: { kind: "playerBall" }, 7: { x: 31, y: 13 } });
  const f2a = [pass(24.5, 15.5, 24.5, 5), run(30, 7, 34, 4)];
  const f3i = move(f2i, { 2: { kind: "player" }, 1: { kind: "playerBall" }, 3: { x: 34, y: 4 } });
  const f3a = [pass(25, 4.5, 33, 4.5), shot(35, 5, 38.3, 8.8)];
  return { field: "futsal", frames: [frame(f1i, f1a), frame(f2i, f2a), frame(f3i, f3a)] };
}

/* -------------------------------------------------------------------------- */
/* As fichas                                                                   */
/* -------------------------------------------------------------------------- */

const EXERCISES = [
  /* ---- Futebol -------------------------------------------------------- */
  {
    name: "Rondo 5v2",
    category: "Técnico",
    objectives: ["Passe", "Receção"],
    type: "Rondo",
    intensity: 5, players: "5v2", durationMin: 12, space: "8×8 m", complexity: 1,
    ageMin: 8, ageMax: 99,
    material: "1 bola (2 de reserva), 8 cones",
    description: "Cinco de fora mantêm a posse num quadrado pequeno; dois no meio tentam recuperar. Quem perde a bola troca com quem a recuperou.",
    rules: "1–2 toques consoante o nível. Passe entre os dois do meio vale ponto extra. Recuperou, troca com quem perdeu.",
    coachingPoints: "Receção orientada para o próximo passe; corpo aberto para o jogo; o passe forte no chão; procurar a linha de passe antes de a bola chegar.",
    commonErrors: "Receber de costas para metade do quadrado; passe picado sem necessidade; apoios parados à espera da bola.",
    progressions: "Reduzir para 1 toque; diminuir o quadrado; juntar terceiro defensor.",
    regressions: "Aumentar o espaço; permitir 3 toques.",
    diagram: rondo5v2,
  },
  {
    name: "Rondo 4v2",
    category: "Técnico",
    objectives: ["Passe", "Receção"],
    type: "Rondo",
    intensity: 5, players: "4v2", durationMin: 10, space: "6×6 m", complexity: 1,
    ageMin: 7, ageMax: 99,
    material: "1 bola, 4 cones",
    description: "Quatro de fora, dois dentro. O rondo mais simples — a porta de entrada para o jogo de posição.",
    rules: "2 toques. Dez passes seguidos valem um ponto. Quem perde entra no meio.",
    coachingPoints: "Distância certa entre apoios: nem colados ao cone, nem fora da linha de passe. Enganar com o olhar antes do passe.",
    commonErrors: "Os quatro em linha reta uns com os outros — perde-se a diagonal de passe.",
    progressions: "1 toque; passe só com o pé fraco.",
    regressions: "Toques livres.",
    diagram: rondo4v2,
  },
  {
    name: "Posse 4v4+3 (jokers)",
    category: "Organização ofensiva",
    objectives: ["Construção", "Ataque posicional"],
    type: "Posse",
    intensity: 7, players: "4v4+3", durationMin: 18, space: "22×22 m", complexity: 3,
    ageMin: 11, ageMax: 99,
    material: "Coletes de 3 cores, 8 cones, bolas de reserva",
    description: "Duas equipas de quatro disputam a posse; três jokers jogam sempre com quem tem a bola. Superioridade permanente de 7v4 para quem ataca.",
    rules: "Jokers com 2 toques e sem poderem ser desarmados dentro da zona deles. Dez passes = 1 ponto.",
    coachingPoints: "Procurar o homem livre — está sempre lá; o joker interior recebe entre linhas; mudar o lado da posse antes de pressionados.",
    commonErrors: "Jogar sempre no mesmo corredor; joker central de costas para o jogo.",
    progressions: "Reduzir jokers para 2; limitar toques dos jokers a 1.",
    regressions: "Espaço maior; 4v4+4.",
    diagram: posse443,
  },
  {
    name: "Posse 6v4 — saída sob pressão",
    category: "Organização ofensiva",
    objectives: ["Construção", "Progressão"],
    type: "Posse",
    intensity: 7, players: "6v4+GR", durationMin: 20, space: "30×26 m", complexity: 3,
    ageMin: 12, ageMax: 99,
    material: "Coletes, cones para a zona, bolas no GR",
    description: "Seis (com GR) constroem desde trás contra quatro que pressionam alto. O objetivo é sair da zona com a bola controlada.",
    rules: "A jogada começa sempre no GR. Sair da zona pela frente com passe ou condução vale ponto; recuperação dos quatro vale contra-golo em mini-baliza.",
    coachingPoints: "Largura máxima dos centrais; o médio pede entre os dois primeiros pressionantes; olhar antes de receber — a pressão diz para onde sair.",
    commonErrors: "Centrais estreitos; passe ao médio pressionado de costas; GR a chutar comprido ao primeiro sinal de pressão.",
    progressions: "Reduzir para 5v4; limitar toques a 2.",
    regressions: "6v3; zona maior.",
    diagram: posse6v4,
  },
  {
    name: "Y de passe",
    category: "Técnico",
    objectives: ["Passe", "Receção", "Condução"],
    type: "Circuito",
    intensity: 4, players: "6–12", durationMin: 12, space: "20×16 m", complexity: 2,
    ageMin: 9, ageMax: 99,
    material: "4 cones, 2 bolas",
    description: "Combinação em Y: passe ao vértice, apoio, abertura para uma das pontas. Roda-se no sentido do passe.",
    rules: "Máximo 2 toques. Trocar o lado de saída a cada série. Depois da ação, cada um segue para a posição seguinte.",
    coachingPoints: "Receção orientada no vértice; o passe de saída na direção da corrida, não no pé parado; timing do apoio.",
    commonErrors: "Vértice de costas; passes moles que matam o ritmo.",
    progressions: "1 toque no vértice; terminar com finalização.",
    regressions: "Sem limite de toques; distâncias mais curtas.",
    diagram: yPasse,
  },
  {
    name: "Terceiro homem",
    category: "Técnico",
    objectives: ["Passe", "Jogo entre linhas"],
    type: "Circuito",
    intensity: 5, players: "3–9", durationMin: 12, space: "18×18 m", complexity: 3,
    ageMin: 11, ageMax: 99,
    material: "3 cones, 1 bola",
    description: "A → C, C devolve a B, B encontra A já lançado. O passe que o marcador direto nunca vê.",
    rules: "2 toques máximo; A parte no momento do primeiro passe, nunca antes.",
    coachingPoints: "O terceiro homem parte **enquanto** a bola viaja; C protege a bola no apoio; comunicação — o passe pede-se com a corrida.",
    commonErrors: "A arranca cedo de mais e fica em fora-de-jogo real; a devolução de C forte de mais.",
    progressions: "Juntar defensor passivo no vértice; terminar em finalização.",
    regressions: "Caminhar a jogada antes de a fazer a ritmo.",
    diagram: terceiroHomem,
  },
  {
    name: "Cruzamento e finalização em ondas",
    category: "Técnico",
    objectives: ["Cruzamento", "Finalização"],
    type: "Finalização",
    intensity: 7, players: "8–14+GR", durationMin: 18, space: "Meio campo", complexity: 2,
    ageMin: 10, ageMax: 99,
    material: "Bolas nos dois flancos, baliza com GR",
    description: "O ala conduz e cruza; três atacam a área — primeiro poste, segundo poste, entrada da área. Alternar flancos a cada onda.",
    rules: "O cruzamento sai antes da linha final. Ataques à área em movimento, nunca parados. 2 defensores passivos → ativos na progressão.",
    coachingPoints: "Atacar o espaço, não a bola; o segundo poste nunca desiste; cruzamento tenso entre GR e defesa.",
    commonErrors: "Os três a atacar o mesmo poste; cruzamento alto e lento para o GR.",
    progressions: "Defensores ativos; limitar a 1 toque na finalização.",
    regressions: "Sem defensores; bola parada no cruzamento.",
    diagram: cruzamentos,
  },
  {
    name: "1v1 com finalização em mini-balizas",
    category: "Técnico",
    objectives: ["Drible", "Finalização"],
    type: "Jogo reduzido",
    intensity: 8, players: "2 por estação", durationMin: 12, space: "20×20 m", complexity: 1,
    ageMin: 7, ageMax: 99,
    material: "2 mini-balizas, cones, bolas",
    description: "Frente a frente: o atacante tenta bater o defensor e finalizar numa das duas mini-balizas. Séries curtas, intensidade máxima.",
    rules: "Máximo 8 segundos por duelo. Defensor recupera → ataca ele. Trocar de par a cada série.",
    coachingPoints: "Mudança de ritmo depois da finta — a finta sem aceleração não bate ninguém; atacar o pé de apoio do defensor.",
    commonErrors: "Driblar sem levantar a cabeça; finta a 5 metros do defensor.",
    progressions: "1v1 com apoio (2v1); reduzir o tempo.",
    regressions: "Defensor passivo nas primeiras séries.",
    diagram: umContraUm,
  },
  {
    name: "Transição 3v2 em ondas contínuas",
    category: "Transições",
    objectives: ["Transição ofensiva", "Reação à recuperação"],
    type: "Onda/Transição",
    intensity: 8, players: "3v2 contínuo", durationMin: 16, space: "Meio campo", complexity: 3,
    ageMin: 11, ageMax: 99,
    material: "Bolas ao meio-campo, baliza com GR, coletes",
    description: "Três atacam dois em direção à baliza. Terminada a jogada, dois dos atacantes recuperam para defender a onda seguinte — o treino não pára.",
    rules: "Máximo 10 segundos por ataque. Golo só dentro da área. Quem defende sai a jogar se recuperar.",
    coachingPoints: "Verticalidade imediata — a superioridade morre em três segundos; fixar um defensor antes de passar; decisões simples a alta velocidade.",
    commonErrors: "Passes horizontais que deixam a defesa recuperar; o portador não fixa ninguém.",
    progressions: "3v2+1 recuperador a chegar por trás; 2v1.",
    regressions: "Sem limite de tempo; 4v2.",
    diagram: ondas3v2,
  },
  {
    name: "Rondo de transição — reação à perda 5v3",
    category: "Transições",
    objectives: ["Reação à perda", "Pressão"],
    type: "Rondo",
    intensity: 8, players: "5v3", durationMin: 14, space: "20×20 m", complexity: 3,
    ageMin: 12, ageMax: 99,
    material: "Coletes, cones, bolas de reserva à mão",
    description: "Posse 5v3; à perda, os cinco têm cinco segundos para recuperar antes que os três liguem duas estações de fuga. O gegenpressing em ponto pequeno.",
    rules: "Recuperar em 5 segundos devolve a posse; os três pontuam se saírem da zona com bola controlada.",
    coachingPoints: "O mais próximo salta **no momento** da perda; os outros fecham as linhas de passe, não correm atrás da bola; agressividade com os apoios certos.",
    commonErrors: "Olhar para o árbitro imaginário depois da perda; dois a saltar ao mesmo portador.",
    progressions: "Reduzir para 4v4; contar recuperações em zonas altas.",
    regressions: "5v2; mais segundos para recuperar.",
    diagram: reacaoAPerda,
  },
  {
    name: "Jogo 4v4 — bloco e coberturas (4 mini-balizas)",
    category: "Organização defensiva",
    objectives: ["Coberturas", "Contenção", "Bloco médio"],
    type: "Jogo condicionado",
    intensity: 7, players: "4v4", durationMin: 18, space: "33×28 m", complexity: 3,
    ageMin: 10, ageMax: 99,
    material: "4 mini-balizas, coletes, cones",
    description: "Cada equipa defende duas mini-balizas afastadas. Defender as duas obriga ao básico da zona: contenção no portador, cobertura atrás, basculação quando a bola muda de lado.",
    rules: "Golo só de dentro do meio-campo ofensivo. Defesa sempre em zona — sem perseguições individuais.",
    coachingPoints: "Um pressiona, um cobre — sempre; a linha bascula com a bola, não com o adversário; fechar dentro, dar fora.",
    commonErrors: "Dois no portador e a segunda baliza aberta; cobertura à mesma altura do primeiro defensor.",
    progressions: "5v5 com balizas mais afastadas; limitar toques do ataque.",
    regressions: "4v3; balizas mais próximas.",
    diagram: jogo4v4Coberturas,
  },
  {
    name: "Jogo posicional em 3 corredores",
    category: "Organização ofensiva",
    objectives: ["Progressão", "Jogo entre linhas", "Ataque posicional"],
    type: "Jogo condicionado",
    intensity: 7, players: "7v5+GR", durationMin: 20, space: "60×52 m", complexity: 4,
    ageMin: 13, ageMax: 99,
    material: "Cones para os corredores, coletes, baliza",
    description: "Campo dividido em três corredores. A equipa em posse procura progredir mudando de corredor — a bola entra num corredor lateral para atrair, e sai para o outro para atacar.",
    rules: "Máximo 3 jogadores da equipa em posse por corredor. Golo depois de a bola passar pelos três corredores vale a dobrar.",
    coachingPoints: "Atrair para um lado, atacar pelo outro; o médio interior mostra-se **entre** linhas, não em cima delas; olhar para o corredor longe antes de receber.",
    commonErrors: "Todos no corredor da bola; mudanças de flanco lentas, por três passes curtos, quando um longo resolvia.",
    progressions: "Igualdade numérica; contar só golos após mudança de corredor.",
    regressions: "Mais um joker; corredores mais largos.",
    diagram: posicional3Corredores,
  },
  {
    name: "Circuito de velocidade — escada, slalom e finalização",
    category: "Físico",
    objectives: ["Velocidade", "Aceleração"],
    type: "Circuito",
    intensity: 8, players: "Grupos de 4–6", durationMin: 12, space: "30×10 m", complexity: 1,
    ageMin: 8, ageMax: 99,
    material: "Escada de agilidade, 2 cones, 2 estacas, mini-baliza, bolas",
    description: "Escada de coordenação → slalom entre estacas → sprint → finalização. Recuperação completa entre repetições: velocidade treina-se fresco.",
    rules: "Um de cada vez; a repetição seguinte parte quando o anterior finaliza. 4–6 repetições por jogador.",
    coachingPoints: "Braços a acompanhar a frequência na escada; passada curta no slalom, passada larga no sprint; qualidade acima de quantidade — parar antes de degradar.",
    commonErrors: "Olhar para os pés na escada; transformar o circuito em resistência com filas curtas.",
    progressions: "Partida de costas; estímulo de reação (cor/som) antes do sprint.",
    regressions: "Sem bola no final; menos estações.",
    diagram: circuitoVelocidade,
  },
  {
    name: "Ativação com bola — mobilidade e condução",
    category: "Físico",
    objectives: ["Mobilidade", "Recuperação"],
    type: "Analítico",
    intensity: 3, players: "Grupo inteiro", durationMin: 10, space: "24×18 m", complexity: 1,
    ageMin: 6, ageMax: 99,
    material: "1 bola por jogador, cones para a zona",
    description: "Todos com bola dentro da zona: condução livre, mudanças de direção ao sinal, skills à chamada do treinador, mobilidade articular intercalada.",
    rules: "Cabeça levantada — quem chocar 'paga' cinco polichinelos. Variar o pé e a superfície de contacto ao sinal.",
    coachingPoints: "Progressão calma de intensidade; usar as duas pernas desde o primeiro minuto; terminar já com ritmo de treino.",
    commonErrors: "Começar a ativação a sprintar; conduzir sempre com o pé forte.",
    progressions: "Juntar 'caça' (2 sem bola tentam roubar).",
    regressions: "Só mobilidade sem bola para os mais novos.",
    diagram: ativacaoComBola,
  },

  /* ---- Futebol 7 e 9 ---------------------------------------------------- */
  {
    name: "Posse 4v2 em quadrado (F7)",
    category: "Organização ofensiva",
    objectives: ["Construção"],
    type: "Posse",
    intensity: 6, players: "4v2", durationMin: 12, space: "16×14 m", complexity: 2,
    ageMin: 8, ageMax: 12,
    material: "Coletes, 4 cones, bolas",
    description: "O rondo do futebol 7: quatro por fora do quadrado, dois a pressionar. As distâncias são as do jogo deles, não as de um campo de onze encolhido.",
    rules: "2 toques. Oito passes seguidos valem ponto. Quem perde entra no meio.",
    coachingPoints: "Abrir o corpo antes de receber; procurar o companheiro do lado oposto ao pressionante; passe forte e no chão.",
    commonErrors: "Ficar em linha com quem tem a bola — sem ângulo, não há passe.",
    progressions: "1 toque; quadrado mais pequeno.",
    regressions: "4v1; toques livres.",
    diagram: f7Posse4v2,
  },
  {
    name: "Saída de bola do guarda-redes (F7)",
    category: "Organização ofensiva",
    objectives: ["Construção", "Progressão"],
    type: "Jogo condicionado",
    intensity: 6, players: "5+GR v3", durationMin: 16, space: "Meio campo de F7", complexity: 3,
    ageMin: 9, ageMax: 12,
    material: "Bolas no GR, coletes",
    description: "Sair a jogar de trás no futebol 7: os dois defesas abrem, o médio mostra-se entre os pressionantes, e a bola procura o ala do lado contrário à pressão.",
    rules: "Começa sempre no GR, com a bola no chão. Passar a linha do meio-campo com bola controlada vale ponto.",
    coachingPoints: "Os defesas abrem **antes** de o GR ter a bola; o médio oferece-se de perfil; se fecham por dentro, joga-se por fora.",
    commonErrors: "Defesas colados à área; o médio de costas para o jogo; pontapé comprido ao primeiro susto.",
    progressions: "Pressão a quatro; limitar toques.",
    regressions: "Pressão passiva nas primeiras séries.",
    diagram: f7SaidaGR,
  },
  {
    name: "Ala, cruzamento e finalização (F7)",
    category: "Técnico",
    objectives: ["Cruzamento", "Finalização"],
    type: "Finalização",
    intensity: 7, players: "3+GR", durationMin: 14, space: "Meio campo de F7", complexity: 2,
    ageMin: 8, ageMax: 12,
    material: "Bolas, baliza com GR, 2 cones",
    description: "O ala conduz pela linha e cruza; dois atacam a área — um ao primeiro poste, outro ao segundo. Alterna-se o flanco a cada série.",
    rules: "Cruzar antes da linha de fundo. Finalizar de primeira sempre que a bola o permita.",
    coachingPoints: "Atacar o espaço em movimento, nunca à espera; cruzamento tenso e rasteiro nestes escalões, que é o que eles alcançam.",
    commonErrors: "Os dois a atacar o mesmo poste; parar para receber em vez de finalizar em movimento.",
    progressions: "Juntar um defensor; 1 toque na finalização.",
    regressions: "Cruzamento com a bola parada.",
    diagram: f7Finalizacao,
  },
  {
    name: "Pressão e coberturas 3v3 (F7)",
    category: "Organização defensiva",
    objectives: ["Pressão", "Coberturas"],
    type: "Jogo condicionado",
    intensity: 7, players: "3v3", durationMin: 14, space: "30×25 m", complexity: 2,
    ageMin: 9, ageMax: 12,
    material: "4 mini-balizas, coletes",
    description: "Duas mini-balizas de cada lado obrigam a defender em zona: um vai ao portador, outro cobre, o terceiro fecha o lado contrário.",
    rules: "Defesa sempre em zona. Golo só do meio-campo ofensivo.",
    coachingPoints: "Quem pressiona corre a fechar um lado, nunca de frente; a cobertura fica um passo atrás e por dentro.",
    commonErrors: "Dois no portador e a segunda baliza aberta.",
    progressions: "4v4; balizas mais afastadas.",
    regressions: "3v2.",
    diagram: f7Pressao,
  },
  {
    name: "Construção a partir de trás (F9)",
    category: "Organização ofensiva",
    objectives: ["Construção", "Progressão"],
    type: "Jogo condicionado",
    intensity: 7, players: "7+GR v3", durationMin: 18, space: "Campo de F9", complexity: 3,
    ageMin: 12, ageMax: 14,
    material: "Bolas no GR, coletes",
    description: "O escalão da passagem para o campo grande: três defesas, médio a receber entre linhas, alas a dar largura. Prepara o que aí vem no futebol 11.",
    rules: "A jogada nasce no GR. Ponto quando a bola chega ao avançado com a equipa organizada.",
    coachingPoints: "O médio recebe **de perfil**, a ver as duas balizas; os alas colam-se à linha para alargar o campo; mudar de lado quando a pressão se concentra.",
    commonErrors: "Alas por dentro a tirar espaço ao médio; passe ao avançado de costas sem apoio.",
    progressions: "Pressão a quatro ou cinco; limitar a 2 toques.",
    regressions: "Menos pressionantes.",
    diagram: f9Construcao,
  },
  {
    name: "Transição rápida 3v2 (F9)",
    category: "Transições",
    objectives: ["Transição ofensiva"],
    type: "Onda/Transição",
    intensity: 8, players: "3v2+GR", durationMin: 14, space: "Meio campo de F9", complexity: 3,
    ageMin: 12, ageMax: 14,
    material: "Bolas, baliza com GR, coletes",
    description: "Três a atacar dois em campo de futebol 9. Máxima verticalidade nos primeiros segundos, antes de a defesa recompor.",
    rules: "Oito segundos por ataque. Quem defende, ao recuperar, sai a jogar.",
    coachingPoints: "Conduzir para fixar um defensor antes de passar; os apoios correm à frente da bola, não atrás.",
    commonErrors: "Passe cedo de mais, que devolve os dois defensores ao jogo.",
    progressions: "3v2 com recuperador a chegar por trás.",
    regressions: "3v1.",
    diagram: f9Transicao,
  },
  {
    name: "Bloco médio e basculação (F9)",
    category: "Organização defensiva",
    objectives: ["Bloco médio", "Coberturas"],
    type: "Jogo condicionado",
    intensity: 7, players: "6v3", durationMin: 16, space: "Campo de F9", complexity: 3,
    ageMin: 12, ageMax: 14,
    material: "Cones para a zona, coletes",
    description: "A equipa mantém a forma dentro da zona marcada e bascula com a bola; quando ela entra no corredor, salta-se ao portador em conjunto.",
    rules: "Ninguém sai da zona. A equipa em posse tenta atravessá-la.",
    coachingPoints: "Basculação **com** a bola, não atrás dela; distâncias curtas entre linhas; quem salta vai fechar, não a adivinhar.",
    commonErrors: "Um a saltar sozinho e a linha a ficar aberta; bloco a alongar-se ao primeiro passe longo.",
    progressions: "Reduzir a zona; 6v4.",
    regressions: "Adversário a meia velocidade.",
    diagram: f9Bloco,
  },

  /* ---- Futsal ---------------------------------------------------------- */
  {
    name: "Rotação 4-0 — oitos com bola",
    category: "Organização ofensiva",
    objectives: ["Ataque posicional", "Construção"],
    type: "Posse",
    intensity: 6, players: "4+GR", durationMin: 15, space: "Campo de futsal", complexity: 3,
    ageMin: 10, ageMax: 99,
    material: "Bolas, coletes",
    description: "Os quatro de campo em linha, sem pivô fixo: passe e desmarque em 'oito', com o corredor central sempre a ser atacado por quem vem de trás. A base do 4-0.",
    rules: "Depois do passe, corta sempre para a frente ou troca com o companheiro do lado — ficar parado é proibido. Máximo 2 toques.",
    coachingPoints: "O corte ao espaço faz-se a acelerar, não a trote; quem recebe de costas devolve de primeira; a largura mantém-se — os oitos não podem estreitar o campo.",
    commonErrors: "Cortes lentos que congestionam o meio; dois a cortar ao mesmo tempo para o mesmo espaço.",
    progressions: "Com dois defensores passivos → ativos; terminar cada rotação com finalização.",
    regressions: "Caminhar o padrão antes de o fazer a ritmo.",
    diagram: rotacao40,
  },
  {
    name: "Paralela e diagonal — finalização a pares",
    category: "Técnico",
    objectives: ["Finalização", "Passe"],
    type: "Finalização",
    intensity: 7, players: "Pares +GR", durationMin: 14, space: "Meio campo de futsal", complexity: 2,
    ageMin: 9, ageMax: 99,
    material: "Bolas, baliza com GR",
    description: "Os dois movimentos que definem o futsal ofensivo: a paralela (bola pela linha, para a corrida do ala) e a diagonal (corte para dentro, ao segundo poste). Alternar a cada repetição.",
    rules: "Finalização a 1 toque sempre que possível. Trocar de lado e de papel a cada série.",
    coachingPoints: "A paralela pede o passe **à frente** do companheiro, na linha; a diagonal ataca o espaço às costas do defensor; finalizar rasteiro ao poste longe.",
    commonErrors: "Passe da paralela para o pé, parado; diagonal iniciada cedo de mais, a cair em fora de posição.",
    progressions: "Juntar defensor ativo; decidir paralela/diagonal por sinal do portador.",
    regressions: "Sem GR; caminhar o movimento primeiro.",
    diagram: paralelaDiagonal,
  },
  {
    name: "Jogo com pivô — apoio e porta atrás",
    category: "Organização ofensiva",
    objectives: ["Criação", "Jogo entre linhas"],
    type: "Jogo condicionado",
    intensity: 7, players: "4v3+GR", durationMin: 16, space: "Meio campo de futsal", complexity: 3,
    ageMin: 11, ageMax: 99,
    material: "Bolas, coletes, baliza",
    description: "O pivô de costas para a baliza recebe, segura e decide: devolve para remate, roda, ou liberta o ala que faz a 'porta atrás'. O 3-1 em ponto pequeno.",
    rules: "Todo o ataque passa pelo pivô. O golo depois de apoio do pivô vale a dobrar.",
    coachingPoints: "O pivô protege a bola com o corpo inteiro, não só com o pé; os alas mexem-se **quando a bola entra** no pivô, não antes; devolver à melhor linha, não à mais próxima.",
    commonErrors: "Pivô a rodar às cegas para o lado do defensor; alas parados a ver o pivô sofrer.",
    progressions: "4v4; pivô limitado a 2 toques.",
    regressions: "Defensor do pivô passivo.",
    diagram: jogoComPivo,
  },
  {
    name: "Posse 3v3+1 em meio campo",
    category: "Organização ofensiva",
    objectives: ["Construção", "Ataque posicional"],
    type: "Posse",
    intensity: 7, players: "3v3+1", durationMin: 14, space: "16×14 m", complexity: 2,
    ageMin: 9, ageMax: 99,
    material: "Coletes de 3 cores, cones",
    description: "Três contra três com um joker que joga sempre com a posse. O 4v3 permanente ensina a jogar com o homem a mais — que no futsal existe sempre que o GR sai a jogar.",
    rules: "2 toques; joker sem poder finalizar. Oito passes seguidos = 1 ponto.",
    coachingPoints: "Procurar o joker quando a pressão aperta — está sempre livre; apoios curtos e constantes; a bola anda mais rápido que o defensor.",
    commonErrors: "Esconder-se atrás do marcador; joker parado no mesmo sítio.",
    progressions: "1 toque; joker limitado a meio espaço.",
    regressions: "Espaço maior; toques livres.",
    diagram: posse3v3mais1,
  },
  {
    name: "Transição 2v1 contínua",
    category: "Transições",
    objectives: ["Transição ofensiva", "Transição defensiva"],
    type: "Onda/Transição",
    intensity: 9, players: "2v1 contínuo +GR", durationMin: 12, space: "Campo de futsal", complexity: 2,
    ageMin: 9, ageMax: 99,
    material: "Bolas nas duas balizas, coletes",
    description: "Dois atacam um. Terminada a jogada, quem defendeu sai a atacar com um companheiro contra um dos anteriores — a onda inverte-se sem parar. O ritmo do futsal real.",
    rules: "Máximo 6 segundos por ataque. A bola seguinte sai do GR no instante em que a anterior morre.",
    coachingPoints: "Fixar o defensor antes de dar — o passe cedo devolve-lhe os dois; na defesa, temporizar e empurrar para longe da baliza; a transição começa na cabeça, antes da bola.",
    commonErrors: "Passe atrasado à chegada da área; defensor a atacar a bola no 2v1 e a morrer no primeiro passe.",
    progressions: "3v2 contínuo; limitar a finalização a 1 toque.",
    regressions: "Pausar entre ondas.",
    diagram: transicao2v1,
  },
  {
    name: "1v1 defensivo — orientar para a linha",
    category: "Organização defensiva",
    objectives: ["Contenção", "Pressão"],
    type: "Jogo reduzido",
    intensity: 8, players: "Pares", durationMin: 10, space: "12×10 m", complexity: 2,
    ageMin: 8, ageMax: 99,
    material: "Cones, coletes, bolas",
    description: "Duelo defensivo puro: o defensor aprende a orientar o portador para a linha lateral — a melhor 'cobertura' do futsal — e a escolher o momento do desarme.",
    rules: "O atacante pontua se cruzar a linha de fundo com bola controlada; o defensor, se roubar ou empurrar para fora. 6 duelos e troca.",
    coachingPoints: "Perfil lateral, nunca de frente; distância de um braço; mostrar a linha, fechar o meio; desarmar quando a bola sai do pé, não antes.",
    commonErrors: "Defender de peito aberto — o atacante escolhe o lado; entrada precipitada ao primeiro drible.",
    progressions: "1v1 com apoio ofensivo (2v1); começar o duelo de costas e reagir.",
    regressions: "Atacante a meia velocidade.",
    diagram: defesa1v1,
  },
  {
    name: "Saída de pressão a 3 (quinas)",
    category: "Organização ofensiva",
    objectives: ["Construção", "Progressão"],
    type: "Jogo condicionado",
    intensity: 7, players: "3+GR v2", durationMin: 14, space: "Meio campo defensivo", complexity: 3,
    ageMin: 11, ageMax: 99,
    material: "Bolas no GR, coletes",
    description: "Sair a jogar contra pressão alta de dois: GR abre nos fixos às quinas, o terceiro homem oferece linha interior. Se a pressão fecha dentro, sai pela linha; se fecha fora, entra no meio.",
    rules: "A jogada começa sempre no GR com a bola no chão. Atravessar o meio-campo com bola controlada = ponto.",
    coachingPoints: "Os apoios às quinas **antes** de o GR ter a bola; receber de perfil, a ver o campo inteiro; o GR é o primeiro jogador — usa-lo para voltar atrás não é recuar, é recomeçar.",
    commonErrors: "Apoios em cima da área, sem ângulo; pânico ao primeiro salto da pressão e bola comprida.",
    progressions: "v3 pressionantes; limitar toques.",
    regressions: "Pressão passiva nas primeiras séries.",
    diagram: saidaPressao3,
  },
  {
    name: "Power play 5v4 — circular para finalizar",
    category: "Organização ofensiva",
    objectives: ["Ataque posicional", "Finalização"],
    type: "Jogo condicionado",
    intensity: 6, players: "5v4+GR", durationMin: 12, space: "Meio campo de futsal", complexity: 4,
    ageMin: 13, ageMax: 99,
    material: "Coletes, bolas, baliza",
    description: "Ataque de cinco (GR-jogador) contra bloco de quatro: circulação paciente até abrir a linha de remate ou o corte ao segundo poste. Treina também a defesa em inferioridade.",
    rules: "Perda de bola = golo sofrido (o risco real do power play). O ataque tem 30 segundos por posse.",
    coachingPoints: "A bola circula mais rápido do que o bloco bascula — é essa a vantagem; o remate só quando a defesa está a bascular; alguém **sempre** ao segundo poste.",
    commonErrors: "Remates forçados contra bloco montado; GR-jogador exposto a interceção curta.",
    progressions: "Limitar a 2 toques; defender com losango e depois com quadrado.",
    regressions: "Sem limite de tempo por posse.",
    diagram: powerPlay,
  },
];

/* -------------------------------------------------------------------------- */

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const onlySlug = process.argv[2];
const academies = (
  await db.query(
    onlySlug ? `SELECT id, slug FROM "Academy" WHERE slug = $1` : `SELECT id, slug FROM "Academy"`,
    onlySlug ? [onlySlug] : [],
  )
).rows;

if (academies.length === 0) {
  console.log(onlySlug ? `Academia "${onlySlug}" não existe.` : "Sem academias.");
  process.exit(1);
}

let inserted = 0;
let skipped = 0;

for (const academy of academies) {
  for (const ex of EXERCISES) {
    const exists = await db.query(`SELECT 1 FROM "Exercise" WHERE "academyId" = $1 AND name = $2`, [
      academy.id,
      ex.name,
    ]);
    if (exists.rowCount > 0) {
      skipped++;
      continue;
    }

    await db.query(
      `INSERT INTO "Exercise" (
         id, "academyId", "createdById", visibility, name, description, category,
         objectives, type, intensity, players, "durationMin", space, material,
         "ageMin", "ageMax", complexity, rules, progressions, regressions,
         "coachingPoints", "commonErrors", diagram, "updatedAt"
       ) VALUES ($1,$2,NULL,'CLUB',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,now())`,
      [
        "seed" + randomBytes(10).toString("hex"),
        academy.id,
        ex.name,
        ex.description,
        ex.category,
        ex.objectives,
        ex.type,
        ex.intensity,
        ex.players,
        ex.durationMin,
        ex.space,
        ex.material,
        ex.ageMin,
        ex.ageMax,
        ex.complexity,
        ex.rules,
        ex.progressions ?? null,
        ex.regressions ?? null,
        ex.coachingPoints,
        ex.commonErrors ?? null,
        JSON.stringify(ex.diagram()),
      ],
    );
    inserted++;
  }
  console.log(`  ${academy.slug}: pronto`);
}

console.log(`\n${inserted} exercícios inseridos, ${skipped} já existiam (${academies.length} academia(s)).`);
await db.end();
