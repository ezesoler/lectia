// Uso: npm run fixtures:kobo  → escribe los .sqlite sintéticos en tests/fixtures/
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildKoboCorrupt, buildKoboDb, buildKoboEmpty, buildKoboNoSchema } from "./kobo-builder";

const out = (name: string) => resolve(__dirname, name);

async function main() {
  writeFileSync(out("kobo-valid.sqlite"), await buildKoboDb());
  writeFileSync(out("kobo-empty.sqlite"), await buildKoboEmpty());
  writeFileSync(out("kobo-noschema.sqlite"), await buildKoboNoSchema());
  writeFileSync(out("kobo-corrupt.sqlite"), await buildKoboCorrupt());
  console.log("Fixtures de Kobo escritos en tests/fixtures/");
}

void main();
