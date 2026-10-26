import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import Home from "@/routes/Home";
import Produto from "@/routes/Produto";
import Planos from "@/routes/Planos";
import Contactos from "@/routes/Contactos";
import Legal, { LegacyLegal } from "@/routes/Legal";
import NaoEncontrada from "@/routes/NaoEncontrada";
import Solucao, { SOLUCOES } from "@/routes/Solucao";
import { SITE_URL, paginaDe } from "@/lib/seo";

/**
 * Ao mudar de página no navegador, o título, a descrição e o endereço canónico
 * mudam com ela. No primeiro carregamento já vêm certos do build.
 */
function Cabeca() {
  const { pathname } = useLocation();

  useEffect(() => {
    const p = paginaDe(pathname);
    // Os documentos legais põem o título deles quando chegam da API.
    if (p.path !== "/legal") document.title = p.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", p.description);
    const canonico = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonico) canonico.href = SITE_URL + (pathname.replace(/\/+$/, "") || "/");
  }, [pathname]);

  return null;
}

/**
 * Mudar de página põe a leitura no topo. A exceção é quando há uma âncora, que
 * é quando a pessoa pediu para ir a um sítio a meio.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    window.scrollTo({ top: 0 });
  }, [pathname, hash]);

  return null;
}

export default function App() {
  return (
    <>
      <ScrollToTop />
      <Cabeca />
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/produto" element={<Produto />} />
          {/* O endereço antigo da página de produto, para nenhum link já enviado deixar de abrir. */}
          <Route path="/software" element={<Navigate to="/produto" replace />} />
          <Route path="/planos" element={<Planos />} />
          <Route path="/contactos" element={<Contactos />} />
          {SOLUCOES.map((s) => (
            <Route key={s.path} path={s.path} element={<Solucao s={s} />} />
          ))}
          {/* Os documentos legais vêm da API, com versão. Os caminhos antigos redirecionam. */}
          <Route path="/legal" element={<Legal />} />
          <Route path="/legal/:slug" element={<Legal />} />
          <Route path="/legal/:slug/:version" element={<Legal />} />
          <Route path="/termos" element={<LegacyLegal to="termos-de-servico" />} />
          <Route path="/privacidade" element={<LegacyLegal to="privacidade" />} />
          <Route path="/cookies" element={<LegacyLegal to="cookies" />} />
          <Route path="/dpa" element={<LegacyLegal to="dpa" />} />
          <Route path="*" element={<NaoEncontrada />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
