import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import Home from "@/routes/Home";
import Software from "@/routes/Software";
import Planos from "@/routes/Planos";
import Contactos from "@/routes/Contactos";
import Legal, { LegacyLegal } from "@/routes/Legal";

/**
 * Mudar de página põe a leitura no topo — excepto quando há uma âncora, que é
 * quando a pessoa pediu explicitamente para ir a um sítio a meio.
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
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/software" element={<Software />} />
          <Route path="/planos" element={<Planos />} />
          <Route path="/contactos" element={<Contactos />} />
          {/* Os documentos legais vêm da API, com versão. Os caminhos antigos redireccionam. */}
          <Route path="/legal" element={<Legal />} />
          <Route path="/legal/:slug" element={<Legal />} />
          <Route path="/legal/:slug/:version" element={<Legal />} />
          <Route path="/termos" element={<LegacyLegal to="termos-de-servico" />} />
          <Route path="/privacidade" element={<LegacyLegal to="privacidade" />} />
          <Route path="/cookies" element={<LegacyLegal to="cookies" />} />
          <Route path="/dpa" element={<LegacyLegal to="dpa" />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
