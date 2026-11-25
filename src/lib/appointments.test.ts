import { appointmentsOverlap, getAppointmentEnd } from "./appointments";

const at = (hora: string) => new Date(`2026-03-10T${hora}:00`);

describe("getAppointmentEnd", () => {
  it("suma la duración en minutos", () => {
    expect(getAppointmentEnd(at("09:00"), 30)).toEqual(at("09:30"));
  });
});

describe("appointmentsOverlap", () => {
  it("detecta empalme cuando una empieza dentro de la otra", () => {
    expect(appointmentsOverlap(at("09:00"), 30, at("09:15"), 30)).toBe(true);
  });

  it("permite citas consecutivas exactas", () => {
    expect(appointmentsOverlap(at("09:00"), 30, at("09:30"), 30)).toBe(false);
  });

  it("no marca empalme en citas separadas", () => {
    expect(appointmentsOverlap(at("09:00"), 30, at("11:00"), 30)).toBe(false);
  });

  it("detecta cuando una cita larga contiene a una corta", () => {
    expect(appointmentsOverlap(at("09:00"), 120, at("09:30"), 15)).toBe(true);
  });

  it("detecta citas idénticas", () => {
    expect(appointmentsOverlap(at("09:00"), 30, at("09:00"), 30)).toBe(true);
  });

  it("da el mismo resultado sin importar el orden de los argumentos", () => {
    expect(appointmentsOverlap(at("09:15"), 30, at("09:00"), 30)).toBe(true);
  });
});