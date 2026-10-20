# parking-occupancy-monitor

Demo de portfolio: subes una foto aérea de un parking y un detector de Azure Custom Vision (clases `car` y `free`) calcula ocupación (% lleno, ocupadas/libres) con historial en el navegador. Desplegada en Azure App Service F1.

## Stack
Next 14.2.35 (App Router, `output: "standalone"`), React 18, TypeScript 5 strict, Tailwind 3 + shadcn, Recharts, Vitest 3 (jsdom), Playwright, Node 24, npm (package-lock.json).

## Comandos (package.json)
- dev: `npm run dev` (puerto habitual 3480: `npm run dev -- -p 3480`) · build: `npm run build`
- lint: `npm run lint` · tipos: `npm run typecheck`
- test: `npm test` · un fichero: `npx vitest run tests/<fichero>.test.ts` · cobertura (umbral 100/100/100/98 ramas): `npm run test:coverage`
- e2e (Chromium, :3495, API simulada, sin Azure): `npm run test:e2e`
- paquete Azure: `npm run package` → `deploy.zip` (borra `.next`: para antes el dev server)

## Despliegue
Web app `parking-occupancy-monitor`, RG `IA`, plan F1 `plan-parking-monitor`, spaincentral. Lo lanza el usuario (su `az login`):
`npm run package && az webapp deploy --name parking-occupancy-monitor --resource-group IA --src-path deploy.zip --type zip`
Las app settings con claves las pone él. El CI (`.github/workflows/ci.yml`) no despliega. Ver memoria global: `azure-ia-lecciones`, `azure-suscripcion-portfolio`, `demo-next-azure-estructura`.

## Verificar una entrega
`npm run lint && npm run typecheck && npm run test:coverage`, con cifras (N tests, cobertura vs umbral). Cambio de UI o flujo: además `npm run test:e2e` y verlo en el navegador. Un guard nuevo se enseña en rojo mutando lo que impide. Los tests nunca llaman a Azure: lo que dependa del endpoint publicado o de App Service va en "Qué NO se ha verificado".

## No tocar
- `.env.local` (claves de Custom Vision: no copiarlas ni imprimirlas; plantilla `.env.example`), `deploy.zip`, `.next/`, `test-results/`.
- Recursos Azure `DevJokes` y `ASP-DevJokesgroup-b293` (otro proyecto en la misma suscripción).
- `lib/tiling.ts` (rejilla 3×3, solape 25 %, `DUPLICATE_COVERAGE` 0,4) y umbral 0,3: calibrados con una sola foto; no cambiarlos sin pedirlo.
- Dataset de `~/Downloads/parking lot/`: fotogramas de iStock con marca de agua, no publicarlos.

## Convenciones
- Código, tests y README en inglés; CLAUDE.md y conversación en español. Commits sin atribución a Claude.
- `lib/server/` es la única que lee variables de entorno; `lib/client/` y `lib/server/` no se importan entre sí (`tests/structure.test.ts`). Lo compartido, en la raíz de `lib/`.
- Cobertura 100 %: toda rama nueva lleva test. `git add` con rutas explícitas.
- Trampas del stack: `.claude/rules/ts-next-postgres.md` (se carga por `paths:`).

@docs/claude-memoria.md
