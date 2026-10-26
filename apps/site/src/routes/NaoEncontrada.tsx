import { Link } from "react-router-dom";
import { Seta } from "@/components/marca";

/**
 * Um endereço que não existe.
 *
 * Antes caía na página inicial com "200 OK", e o Google via o mesmo conteúdo em
 * infinitos endereços. No build esta página vira o `404.html`, que o Vercel
 * serve com o código 404.
 */
export default function NaoEncontrada() {
  return (
    <div className="palco-cal">
      <div className="wrap sob-o-topo faixa-curta">
        <p className="rotulo text-texto-3">Erro 404</p>
        <h1 className="titulo t2 mt-5 max-w-[16ch]">Esta página não existe<span className="ponto">.</span></h1>
        <p className="lede mt-6">O endereço pode ter mudado ou ter sido escrito com um erro.</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link to="/" className="btn btn-cheio">
            Ir para o início
            <Seta />
          </Link>
          <Link to="/produto" className="btn btn-fio">
            Ver o produto
          </Link>
        </div>
      </div>
    </div>
  );
}
