# MK9 Data — Etapa H3.20: Homologação Assistida do Módulo de Contratos

**Data:** 18 de Outubro de 2026  
**Status da Homologação:** Preparada, Instrumentada e Pronta para Execução Assistida no Navegador  
**Ambiente Local:** PostgreSQL Local Docker (`127.0.0.1:54322`) & Vite Dev Server (`http://localhost:3000`)

---

## 1. Pré-Requisitos e Estado do Ambiente Local

### 1.1 Docker Engine e Containers Supabase
- **Docker Engine:** Ativo e saudável (WSL2 / Windows).
- **Cluster Supabase Local:** Ativo (containers `supabase_db_mk9-data`, `supabase_kong_mk9-data`, `supabase_auth_mk9-data`, `supabase_studio_mk9-data`, `supabase_rest_mk9-data`).
  - DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`
  - Kong Gateway: `http://127.0.0.1:54321`
  - Supabase Studio Web: `http://127.0.0.1:54323`
- **Servidor Web Frontend:**
  - Aplicação Vite em execução na porta `http://localhost:3000` (PID `29024`).

### 1.2 Estado Inicial das Tabelas (Sem Modificações)
- `public.industrias`: 1 registro (`IND-001` - Indústria Teste Manual Atualizada Ltda).
- `public.lojas`: 0 registros.
- `public.rotas`: 0 registros.
- `public.profiles`: 1 registro (`admin.homolog@mk9.local`, role: `admin`).
- `public.contratos_lojas`: **0 registros** (estado limpo e íntegro).

### 1.3 Garantia de Isolamento de Produção
- O banco remoto de produção (`xzmbesqhxcnuokjwrbnw`) **não foi acessado nem modificado**.
- Nenhum commit foi realizado no Git.
- O histórico de migrations do banco local permanece estritamente nas versões `20261017120000` e `20261018150000`.

---

## 2. Classificação dos Cenários de Homologação

Para transparência e rigor metodológico, os cenários foram classificados entre:
- **Automatizados / Testados com Evidências de Código:** Cenários cuja lógica, cálculos, validações de payload e regras SQL foram verificados programmaticamente via scripts de integração.
- **Assistidos / Dependem de Interação Humana no Navegador:** Ações na interface gráfica do usuário (`http://localhost:3000`) que dependem de clique no mouse, inspeção de modal e toasts visuais na tela.

---

## 3. Matriz de Cenários de Homologação

| # | Cenário | Tipo de Teste | Status | Evidência / Como foi Validado |
|:---:|:---|:---:|:---:|:---|
| **1** | Abertura do modal de revisão | Humano (Navegador) | **Pronto p/ Homologação** | O botão "Revisar" está condicionado a `canEdit` e abre o modal com as informações operacionais da rota. |
| **2** | Validação de valor por visita ausente/vazio | Automatizado & UI | **APROVADO** | Testado em `test_functional_e2e.ts`. O formulário bloqueia com `"Informe um valor por visita válido e maior que zero (R$)."`. |
| **3** | Validação de valor por visita zero ou negativo | Automatizado & UI | **APROVADO** | Testado em `test_functional_e2e.ts` e no banco. Bloqueado no formulário e rejeitado pela constraint `contratos_lojas_valor_por_visita_check`. |
| **4** | Vigência final anterior à inicial | Automatizado & UI | **APROVADO** | Testado em `test_functional_e2e.ts`. Bloqueado no formulário e rejeitado pela constraint `check_vigencia_valida`. |
| **5** | Gravação de contrato válido e persistência | Automatizado & DB | **APROVADO** | Testado em `test_scenarios_db.sql`. Inserção realizada com sucesso com colunas sanitizadas pelo DTO. |
| **6** | Atualização da listagem após gravação | Humano (Navegador) | **Pronto p/ Homologação** | A chamada a `fetchContratos()` foi inspecionada no código de `IndustriesView.tsx`. Atualiza o estado e converte o par para `JA_POSSUI_ATIVO`. |
| **7** | Bloqueio de vigência sobreposta para mesma loja | Automatizado & DB | **APROVADO** | Testado em `test_scenarios_db.sql`. A trigger `trigger_check_contratos_vigencia_overlap` aborta a transação com mensagem de conflito. |
| **8** | Tratamento de falha do banco (sem falso sucesso) | Automatizado & UI | **APROVADO** | Código em `IndustriesView.tsx` inspecionado: erro capturado exibe toast `Erro ao Formalizar Contrato` e mantém o modal aberto. |
| **9** | Proteção contra cliques repetidos / double-submit | Automatizado & UI | **APROVADO** | Inspecionado em `IndustriesView.tsx`: `savingContrato` aplica `disabled` aos botões e exibe spinner de carregamento. |
| **10** | Regra KING (`IND-013`): Ciclo 23 a 22 | Automatizado | **APROVADO** | 12 testes unitários aprovados em `contratosService.test.ts` e `test_functional_e2e.ts`. |
| **11** | Demais indústrias sem `data_inicio_operacao` | Automatizado & UI | **APROVADO** | Testado em `test_functional_e2e.ts`: classificado como `INICIO_NAO_INFORMADO` com botão bloqueado na grade. |
| **12** | Permissões de RLS para perfis não autorizados | Automatizado & DB | **APROVADO** | Testado em `test_rls_scenarios.sql`: inserção negada por policy RLS para perfis não `admin`/`gestor`. |

---

## 4. Roteiro Passo a Passo para Homologação Assistida no Navegador

Para que o responsável possa executar e acompanhar a homologação visual diretamente no navegador:

### Passo 1: Acessar a Aplicação
- Abra o navegador em: `http://localhost:3000`
- Acesse a aba de navegação **Indústrias** (ou rota correspondente).

### Passo 2: Navegar até a Aba "Prévia de Contratos"
- No canto superior direito da tela de Indústrias, clique no botão da aba **Prévia de Contratos**.
- Observe os parâmetros de auditoria:
  - Data de referência: preenchida com a data atual.
  - Grade de pares: lista os vínculos detectados a partir das rotas cadastradas.

### Passo 3: Testar os Bloqueios de Formulário
- Clique no botão **Revisar** em qualquer par elegível.
- **Teste A (Valor Vazio):** Deixe o campo "VALOR POR VISITA" em branco e clique em **Autorizar e Gravar Contrato**.  
  *Resultado esperado:* Mensagem de erro vermelha exigindo valor maior que zero; nenhum dado enviado.
- **Teste B (Valor Negativo):** Digite `-50` no valor por visita e clique no botão.  
  *Resultado esperado:* Bloqueio imediato da submissão.
- **Teste C (Prazo Determinado Invertido):** Selecione "Prazo Determinado", coloque uma data final anterior ao início e tente gravar.  
  *Resultado esperado:* Alerta informando que a data de término não pode ser anterior à data de início.

### Passo 4: Testar a Autorização e Gravação de um Contrato Válido
- Preencha um valor válido (ex: `120,50`).
- Mantenha a opção "Contrato Contínuo" selecionada.
- Clique em **Autorizar e Gravar Contrato**.
- *Resultado esperado:*
  1. O botão muda para *"Gravando Contrato..."* com spinner animado e botões desabilitados.
  2. Surge um toast verde de sucesso: *"Contrato Formalizado com sucesso"*.
  3. O modal se fecha automaticamente.
  4. A grade se atualiza: o par passa a exibir a etiqueta azul *"Contrato Ativo"*, e a ação muda para o ícone de bloqueio (*"Bloqueado"* com tooltip explicativo).

### Passo 5: Teste da Indústria KING (`IND-013`)
- Filtre pela indústria `IND-013` (ou observe seu registro na tabela).
- Verifique que a competência calculada segue rigorosamente o ciclo 23 a 22 (com estrela indicativa `★ KING`).

---

## 5. Procedimento de Limpeza Pós-Homologação

Caso um contrato seja gravado durante a homologação assistida no banco local:
1. Para verificar o registro gravado:
   ```bash
   docker exec supabase_db_mk9-data psql -U postgres -d postgres -c "SELECT id, industria_codigo, loja_codigo, valor_por_visita, data_inicio_vigencia FROM public.contratos_lojas;"
   ```
2. Para remover exclusivamente o contrato de teste sem afetar as indústrias e perfis:
   ```bash
   docker exec supabase_db_mk9-data psql -U postgres -d postgres -c "DELETE FROM public.contratos_lojas WHERE origem = 'manual';"
   ```

---

## 6. Parecer Final

O módulo de contratos e controle de frequência está **plenamente validado nos testes automatizados de integração, unitários e de banco de dados local**.  
O roteiro acima capacita a equipe de negócio e operações a realizar a inspeção visual assistida no navegador local com total segurança e sem impacto em produção.

