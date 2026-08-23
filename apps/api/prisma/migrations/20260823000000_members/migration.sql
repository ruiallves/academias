-- Sócios
--
-- Um clube não é só a formação. É também quem paga a quota há trinta anos, vota
-- em assembleia e nunca aparece em folha nenhuma — e é essa metade que até aqui
-- não existia no produto.
--
-- ## Porque é que um sócio não é um `User`
--
-- Porque não precisa de entrar em lado nenhum. Criar-lhe uma conta no Supabase
-- para o registar seria fabricar credenciais que ninguém pediu, e passar a ter de
-- as proteger. Quem for **também** encarregado de educação tem as duas coisas:
-- uma `Membership` para a app da família e uma linha em `Member`. São vínculos
-- diferentes com o mesmo clube, e juntá-los obrigava a explicar porque é que
-- cancelar uma quota tirava o acesso à ficha de um filho.
--
-- ## O consentimento é um carimbo
--
-- `acceptedTermsAt`, `partnerCommsAt` e `partnerDataAt` guardam **quando**, e não
-- apenas que sim. O RGPD pede que o clube consiga demonstrar o consentimento, e
-- um booleano `true` não demonstra nada: não diz quando nem contra que versão dos
-- termos. São três carimbos e não um porque são três perguntas — consentir
-- receber comunicações não é consentir que os dados saiam do clube.

CREATE TYPE "MemberFeePeriod"    AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'ONCE');
CREATE TYPE "MemberStatus"       AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');
CREATE TYPE "MemberSex"          AS ENUM ('FEMALE', 'MALE', 'UNSPECIFIED');
CREATE TYPE "MemberDocumentKind" AS ENUM ('CC', 'PASSPORT', 'RESIDENCE', 'OTHER');

-- ---------------------------------------------------------------------------
-- Categorias
-- ---------------------------------------------------------------------------

CREATE TABLE "MemberTier" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "benefits"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "feeCents"    INTEGER,
  "period"      "MemberFeePeriod" NOT NULL DEFAULT 'ANNUAL',
  "minAge"      INTEGER,
  "maxAge"      INTEGER,
  "isPublic"    BOOLEAN NOT NULL DEFAULT true,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "archivedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MemberTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberTier_academyId_name_key" ON "MemberTier"("academyId", "name");
CREATE INDEX "MemberTier_academyId_idx" ON "MemberTier"("academyId");

-- ---------------------------------------------------------------------------
-- Sócios
-- ---------------------------------------------------------------------------

CREATE TABLE "Member" (
  "id"              TEXT NOT NULL,
  "academyId"       TEXT NOT NULL,
  "number"          INTEGER,
  "tierId"          TEXT,
  "name"            TEXT NOT NULL,
  "email"           TEXT NOT NULL,
  "birthdate"       DATE NOT NULL,
  "country"         TEXT NOT NULL DEFAULT 'PT',
  "address"         TEXT NOT NULL,
  "postalCode"      TEXT NOT NULL,
  "city"            TEXT NOT NULL,
  "phoneCountry"    TEXT NOT NULL DEFAULT '+351',
  "phone"           TEXT NOT NULL,
  "sex"             "MemberSex" NOT NULL DEFAULT 'UNSPECIFIED',
  "documentKind"    "MemberDocumentKind" NOT NULL DEFAULT 'CC',
  "documentNumber"  TEXT NOT NULL,
  "taxId"           TEXT NOT NULL,
  "status"          "MemberStatus" NOT NULL DEFAULT 'PENDING',
  "acceptedTermsAt" TIMESTAMP(3) NOT NULL,
  "partnerCommsAt"  TIMESTAMP(3),
  "partnerDataAt"   TIMESTAMP(3),
  "source"          TEXT NOT NULL DEFAULT 'site',
  "notes"           TEXT,
  "approvedAt"      TIMESTAMP(3),
  "approvedById"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- Únicos **por clube** e não globais: a mesma pessoa pode ser sócia de dois
-- clubes, e é cada clube que responde pelos seus.
CREATE UNIQUE INDEX "Member_academyId_taxId_key"  ON "Member"("academyId", "taxId");
CREATE UNIQUE INDEX "Member_academyId_number_key" ON "Member"("academyId", "number");
CREATE INDEX "Member_academyId_status_idx" ON "Member"("academyId", "status");
CREATE INDEX "Member_academyId_name_idx"   ON "Member"("academyId", "name");

ALTER TABLE "MemberTier" ADD CONSTRAINT "MemberTier_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Member" ADD CONSTRAINT "Member_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- `SET NULL`: apagar uma categoria nunca pode apagar sócios. Ficam sem categoria
-- e a direção reatribui — o contrário seria perder pessoas por causa de uma
-- arrumação.
ALTER TABLE "Member" ADD CONSTRAINT "Member_tierId_fkey"
  FOREIGN KEY ("tierId") REFERENCES "MemberTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Member" ADD CONSTRAINT "Member_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento
-- ---------------------------------------------------------------------------
--
-- A inscrição pública escreve aqui **sem sessão**: quem preenche o formulário no
-- site do clube não tem conta nenhuma. Por isso o serviço resolve o clube pelo
-- slug e abre o contexto de tenant antes de escrever — a política abaixo continua
-- a valer, e uma inscrição sem contexto não passa. É a mesma disciplina do
-- webhook de pagamentos, que também chega de fora.

ALTER TABLE "MemberTier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemberTier" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MemberTier";
CREATE POLICY tenant_isolation ON "MemberTier"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "Member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Member" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Member";
CREATE POLICY tenant_isolation ON "Member"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "MemberTier", "Member" TO academia_app;
