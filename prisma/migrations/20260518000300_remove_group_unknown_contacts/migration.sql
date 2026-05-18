DELETE FROM "Notification"
WHERE "type" = 'WHATSAPP_UNKNOWN_CONTACT'
  AND LENGTH(SPLIT_PART("body", ' ', 1)) > 15;

DELETE FROM "UnknownContact"
WHERE LENGTH("phone") > 15;
