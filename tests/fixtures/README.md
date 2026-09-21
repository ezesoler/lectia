# Fixtures de importación

- **Sintéticos** (versionados): `clippings-*.txt` y `kobo-*.sqlite`. Reproducen las rarezas de
  los archivos reales (p. ej. `"La subrayado en la página"`, autores con `;` sin espacio,
  `ContentType` como texto en Kobo) pero **no contienen lecturas de nadie**. Los `.sqlite` se
  generan con `npm run fixtures:kobo` (`build-kobo.ts`).
- **Reales** (no versionados): `docs/files imports/My Clippings.txt` y
  `docs/files imports/KoboReader.sqlite`. Las pruebas `*.real.test.ts` los leen y se omiten
  (`describe.skipIf`) si no existen, como en CI.
