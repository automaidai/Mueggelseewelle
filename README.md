# Müggelseewelle – Player-Test

Stündlicher Funktionstest für die sieben Radio-Player. Der Test klickt auf Wiedergabe und prüft kurz den Fortschritt des Mediaplayers. Es wird kein Audio aufgenommen.

Ergebnisse werden gesammelt an Make übermittelt. Die Empfangsadresse wird ausschließlich als GitHub Actions Secret `MAKE_WEBHOOK_URL` hinterlegt.

Status: Einrichtung und Erstprüfung laufen. Die einzelnen Plattformen können Browser-Automation blockieren; das wird als `BLOCKIERT` oder `UNGEPRUEFT` ausgewiesen und nicht als Senderausfall.
