import { CalendarDays, Mail, Newspaper, Shield, ShoppingBag, Ticket, Users } from "lucide-react";

/** Por onde se anda. Partilhado pelos dois layouts, pelo menu móvel e pelo rodapé. */
export const NAV = [
  { href: "/noticias", label: "Notícias", Icone: Newspaper },
  { href: "/equipas", label: "Equipas", Icone: Users },
  { href: "/calendario", label: "Calendário", Icone: CalendarDays },
  { href: "/clube", label: "Clube", Icone: Shield },
  { href: "/contactos", label: "Contactos", Icone: Mail },
];

/** O que se faz: a faixa de cima, a barra lateral e o fim do menu móvel. */
export const ATALHOS = [
  { href: "/bilheteira", label: "Bilheteira", Icone: Ticket },
  { href: "/loja", label: "Loja", Icone: ShoppingBag },
];
