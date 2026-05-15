import { format } from "date-fns";

export function formatDateTime(date: Date) {
  return format(date, "dd/MM/yyyy HH:mm");
}

export function formatDate(date: Date) {
  return format(date, "dd/MM/yyyy");
}

export function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PENDING: "Pendiente",
    CONFIRMED: "Confirmada",
    CANCELLED: "Cancelada",
    ATTENDED: "Asistió",
    MISSED: "No asistió",
    REPROGRAM_PENDING: "Pospuesta",
    REPROGRAMMED: "Reprogramada",
    PRESENT: "Presente",
    ABSENT: "Ausente",
    LATE: "Tarde",
    SENT: "Enviado",
    FAILED: "Fallido"
  };

  return labels[status] ?? status;
}
