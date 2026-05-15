# Vincular WhatsApp con n8n y Evolution API

No se creo nada dentro de n8n automaticamente porque esta app no tiene acceso a tu cuenta o servidor de n8n. Lo que si queda listo es el payload, el secreto y una plantilla importable.

## 1. Importar plantilla

En n8n:

1. Entra a `Workflows`.
2. Selecciona `Import from file`.
3. Importa `docs/n8n-evolution-whatsapp-workflow.json`.
4. Abre el nodo `Validar secreto` y cambia `cambia-este-secreto` por el mismo valor de `N8N_WEBHOOK_SECRET`.
5. Abre el nodo `Enviar WhatsApp - Evolution API`.
6. Cambia:
   - `https://TU_EVOLUTION_API_URL`
   - `TU_INSTANCIA`
   - `TU_API_KEY_EVOLUTION`

## 2. Copiar URL del webhook

En el nodo `Webhook - Sistema de citas`, copia la Production URL. Debe verse parecido a:

```text
https://n8n.hiworkflow.mx/webhook/recordatorio-cita
```

Pega esa URL en `.env`:

```env
N8N_REMINDER_WEBHOOK_URL="https://n8n.hiworkflow.mx/webhook/recordatorio-cita"
N8N_WEBHOOK_SECRET="cambia-este-secreto"
```

## 3. Activar workflow

Activa el workflow en n8n. Si usas la URL de prueba, solo funcionara mientras n8n este escuchando el test. Para uso real usa la Production URL.

## 4. Probar desde el sistema

1. Entra al sistema.
2. Crea un cliente con numero en formato internacional, por ejemplo `5216141234567`.
3. Crea una cita.
4. Presiona el boton de WhatsApp en la tabla de citas.
5. Revisa el historial WhatsApp en el sistema.

## 5. Automatizar recordatorios

Para que salgan solos, crea otro workflow en n8n con:

1. `Schedule Trigger` cada 15 minutos.
2. `HTTP Request` con metodo `POST`.
3. URL:

```text
https://consultorio.hiworkflow.mx/api/reminders/due
```

Cuando publiques el sistema, cambia esa URL por tu dominio:

```text
https://consultorio.hiworkflow.mx/api/reminders/due
```

Agrega este header:

```text
x-webhook-secret: cambia-este-secreto
```

Ese endpoint revisa citas pendientes o confirmadas y envia:

- recordatorio de 24 horas antes
- recordatorio de 1 hora antes

No duplica recordatorios automáticos ya enviados.

Tambien puedes importar la plantilla:

```text
docs/n8n-schedule-due-reminders-workflow.json
```

## 6. Respuestas del cliente por WhatsApp

Para que el sistema entienda respuestas como `confirmo` o `reprogramar`, importa:

```text
docs/n8n-inbound-whatsapp-bot-workflow.json
```

Ese workflow recibe el webhook entrante de Evolution API, normaliza el telefono y mensaje, y llama al sistema:

```text
POST https://consultorio.hiworkflow.mx/api/whatsapp/inbound
```

Mientras el sistema este local, esa URL no puede ser `localhost` desde n8n en produccion. Necesitas dominio publico o tunel temporal.

El bot entiende:

- `confirmo`, `si`, `ok`, `asisto`, `voy`: marca la cita como confirmada y responde confirmacion.
- `cancelar`, `reprogramar`, `cambiar`, `no puedo`: marca la cita como pendiente de reprogramar y pide nueva fecha.
- una fecha como `25/05/2026 16:30`: crea una nueva cita y marca la anterior como reprogramada.

Si la cita ya esta confirmada, el sistema no envia el recordatorio automatico de 1 hora.

## Payload que envia el sistema

```json
{
  "event": "appointment.reminder.requested",
  "client": {
    "fullName": "Ana Martinez",
    "phone": "5216141234567"
  },
  "whatsapp": {
    "to": "5216141234567",
    "message": "Hola Ana Martinez..."
  }
}
```
