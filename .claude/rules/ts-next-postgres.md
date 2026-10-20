---
paths: ["**/*.ts", "**/*.tsx", "**/*.mjs", "**/package.json", "**/drizzle/**", "**/migrations/**"]
---
# Trampas TypeScript / Node / Next / Postgres (aprendidas en kadens 2026)
- `tsc`/eslint sin memoria pueden morir y parecer verdes: `--max-old-space-size=8192` y lee la línea de totales. Baterías grandes: por trozos, leyendo `Tests:` de cada trozo.
- Procesos lanzados desde Bash pueden quedar huérfanos: revísalos por PGID (el hook heavy-check-guard los recoge).
- Un autofix de eslint puede borrar un import añadido antes de escribir su uso.
- Error de tipos contra un paquete interno del monorepo = `dist` viejo: recompila antes de tocar código.
- Permisos dentro de la función de una caché `getOrSet` se saltan con la caché caliente. Si cambia la forma de lo cacheado, versiona la clave.
- Filtrar por el id de la URL no basta: una FK opcional en el body puede mover el recurso a otro tenant.
- UNIQUE con una columna NULL no evita duplicados en Postgres.
- En un esquema de respuesta, lo que puede ser `null` va con `.nullable()`, no `.optional()`.
- Un `loading.tsx` por encima fija el 200 y anula `notFound()`/`redirect()`: compruébalo con `curl -I`. Un layout que devuelve pronto `children` sigue ejecutando sus hooks. Un diálogo siempre montado dispara fetches cerrado: condiciona a `open`.
- `pg` Pool parsea `timestamp` en zona local y drizzle en UTC: no mezcles oráculos.
- Overrides en el lockfile: parte del lockfile de la rama principal y `--lockfile-only`.
- `browser_batch` admite 25 acciones como máximo. Un panel de navegador oculto congela rAF y falsea fps.
- Next 16: rutas nuevas dan TS2344 hasta `npx next typegen`. `next/og`: Satori no acepta componentes dentro de `<svg>`; usa `<img>` con data URI.
