import type { ImportSource } from "@/lib/import/types";

/** Ayuda de ubicación del archivo en el lector ("Dónde está el archivo"). */
export function WhereIsFile({ source, id }: { source: ImportSource; id: string }) {
  return (
    <div className="lec-imp-help" id={id}>
      {source === "kindle" ? (
        <>
          <p>
            Conectá el Kindle a la computadora con el cable USB y abrí la unidad. El archivo se
            llama <strong>My Clippings.txt</strong> y está dentro de la carpeta{" "}
            <strong>documents</strong>.
          </p>
          <p>No hace falta abrirlo ni editarlo: subilo tal cual está.</p>
        </>
      ) : (
        <>
          <p>
            Conectá el Kobo con el cable USB y abrí la unidad. El archivo se llama{" "}
            <strong>KoboReader.sqlite</strong> y está dentro de la carpeta oculta{" "}
            <strong>.kobo</strong>.
          </p>
          <p>
            En Windows activá <strong>Ver → Elementos ocultos</strong>; en macOS presioná{" "}
            <strong>Cmd + Shift + .</strong> para mostrar las carpetas ocultas.
          </p>
        </>
      )}
    </div>
  );
}
