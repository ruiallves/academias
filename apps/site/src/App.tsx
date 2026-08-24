import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import Home from "@/routes/Home";
import Software from "@/routes/Software";
import Planos from "@/routes/Planos";
import Contactos from "@/routes/Contactos";
import Legal from "@/routes/Legal";

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
          {/* Os quatro documentos partilham a mesma página. */}
          <Route path="/termos" element={<Legal />} />
          <Route path="/privacidade" element={<Legal />} />
          <Route path="/cookies" element={<Legal />} />
          <Route path="/dpa" element={<Legal />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
