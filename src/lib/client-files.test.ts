import { sanitizeFilename, getExtension } from "./client-files";

describe("sanitizeFilename", () => {
  it("quita acentos", () => {
    expect(sanitizeFilename("análisis.pdf")).toBe("analisis.pdf");
  });

  it("reemplaza espacios y símbolos con guiones", () => {
    expect(sanitizeFilename("mi archivo (1).pdf")).toBe("mi-archivo-1-.pdf");
  });

  it("devuelve 'archivo' si no queda nada usable", () => {
    expect(sanitizeFilename("!!!")).toBe("archivo");
  });
});

describe("getExtension", () => {
  it("usa la extensión del nombre cuando existe", () => {
    expect(getExtension("reporte.PDF", "image/png")).toBe(".pdf");
  });

  it("cae al mimeType cuando el nombre no tiene extensión", () => {
    expect(getExtension("reporte", "image/png")).toBe(".png");
  });
});