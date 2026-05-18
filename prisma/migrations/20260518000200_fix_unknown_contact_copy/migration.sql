UPDATE "UnknownContact"
SET "displayName" = REPLACE("displayName", 'NÃºmero', 'Número')
WHERE "displayName" LIKE '%NÃºmero%';

UPDATE "Notification"
SET
  "title" = REPLACE("title", 'nÃºmero', 'número'),
  "body" = REPLACE(REPLACE("body", 'enviÃ³', 'envió'), 'nÃºmero', 'número')
WHERE "type" IN ('WHATSAPP_CLIENT_MESSAGE', 'WHATSAPP_UNKNOWN_CONTACT');
