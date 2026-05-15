import { formatClinicDate, formatClinicDateTime } from "@/lib/timezone";

export function formatDateTime(date: Date) {
  return formatClinicDateTime(date);
}

export function formatDate(date: Date) {
  return formatClinicDate(date);
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
